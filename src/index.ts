/**
 * Extension entrypoint.
 *
 * Hooks Pi's compaction lifecycle to request Codex-style remote compaction,
 * replays the returned opaque history on later compatible turns, and keeps
 * runtime state in sync with session lifecycle boundaries.
 *
 * Pi's transport is left untouched: the only request mutation is replacing
 * `input` with the remote replacement history after a compaction boundary.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { isRecord, loadConfig } from "./config.ts";
import {
  applyRemoteHistoryPayloadPatch,
  extractResponsesReasoningConfig,
  extractResponsesTextConfig,
  looksLikeResponsesPayload,
  messageMatchesModel,
  modelKey,
  supportsRemoteCompactionModel,
  thinkingLevelToResponsesReasoning,
} from "./openai.ts";
import {
  buildCompactionSummaryText,
  buildRemoteCompactionDetails,
  buildToolsPayload,
  callRemoteCompactionEndpoint,
  combineUsage,
  generateBestEffortLocalSummary,
  messageToResponseItems,
  messagesToResponseItems,
  normalizeResponseItemsForPrompt,
  reconstructRemoteCompactionStateFromBranch,
} from "./compaction.ts";
import {
  clearAllState,
  clearRemoteCompactionState,
  clearRequestShapeState,
  getRemoteCompactionState,
  getRequestShapeState,
  setRemoteCompactionState,
  setRequestShapeState,
} from "./state.ts";

type TargetModel = Parameters<typeof modelKey>[0];

type BranchEntry = {
  type: string;
  id: string;
  details?: unknown;
  message?: unknown;
  thinkingLevel?: unknown;
};

type SessionContextLike = {
  sessionManager: {
    getSessionId(): string;
    getBranch(): BranchEntry[];
  };
};

function getSessionId(ctx: SessionContextLike): string {
  return ctx.sessionManager.getSessionId();
}

function getBranchMessages(branchEntries: BranchEntry[]): AgentMessage[] {
  return branchEntries.flatMap((entry) =>
    entry.type === "message" && entry.message ? [entry.message as AgentMessage] : [],
  );
}

function getBranchThinkingLevel(branchEntries: BranchEntry[]): string | undefined {
  for (let index = branchEntries.length - 1; index >= 0; index--) {
    const entry = branchEntries[index];
    if (entry?.type !== "thinking_level_change") continue;
    return typeof entry.thinkingLevel === "string" ? entry.thinkingLevel : undefined;
  }
  return undefined;
}

function clearSessionRuntimeState(sessionId: string | undefined): void {
  clearRemoteCompactionState(sessionId);
  clearRequestShapeState(sessionId);
}

function syncRemoteState(ctx: SessionContextLike): void {
  const sessionId = getSessionId(ctx);
  const state = reconstructRemoteCompactionStateFromBranch({
    branchEntries: ctx.sessionManager.getBranch() as Array<{
      type: string;
      id: string;
      details?: unknown;
      message?: AgentMessage;
    }>,
  });
  if (state) {
    setRemoteCompactionState(sessionId, state);
  } else {
    clearRemoteCompactionState(sessionId);
  }
}

function getMatchingRemoteState(
  sessionId: string,
  model: TargetModel | undefined,
): ReturnType<typeof getRemoteCompactionState> {
  if (!model) return undefined;
  const remoteState = getRemoteCompactionState(sessionId);
  return remoteState && remoteState.modelKey === modelKey(model) ? remoteState : undefined;
}

function extendRemoteHistoryIfCompatible(params: {
  sessionId: string;
  model: TargetModel | undefined;
  message: AgentMessage;
}): void {
  const remoteState = getMatchingRemoteState(params.sessionId, params.model);
  if (!remoteState || !params.model) return;
  if (params.message.role === "assistant" && !messageMatchesModel(params.message, params.model)) {
    return;
  }

  const items = messageToResponseItems(params.message);
  if (items.length === 0) return;

  setRemoteCompactionState(params.sessionId, {
    ...remoteState,
    explicitHistory: [...remoteState.explicitHistory, ...items],
  });
}

export default function codexCompactExtension(pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    clearRequestShapeState(getSessionId(ctx));
    syncRemoteState(ctx);
  });

  const clearBeforeSessionChange = (_event: unknown, ctx: SessionContextLike): void => {
    clearSessionRuntimeState(getSessionId(ctx));
  };
  pi.on("session_before_switch", clearBeforeSessionChange);
  pi.on("session_before_fork", clearBeforeSessionChange);
  pi.on("session_before_tree", clearBeforeSessionChange);

  const syncAfterSessionChange = (_event: unknown, ctx: SessionContextLike): void => {
    syncRemoteState(ctx);
  };
  pi.on("session_tree", syncAfterSessionChange);
  pi.on("session_compact", syncAfterSessionChange);

  pi.on("session_shutdown", () => {
    clearAllState();
  });

  pi.on("session_before_compact", async (event, ctx) => {
    const cfg = loadConfig(ctx.cwd);
    const model = ctx.model;
    if (!cfg.enabled || !model || !supportsRemoteCompactionModel(model)) return undefined;

    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok || !auth.apiKey) return undefined;
    // Credential-resolved endpoints (e.g. models.json or login overrides) win over the catalog baseUrl.
    const requestModel = auth.baseUrl ? { ...model, baseUrl: auth.baseUrl } : model;

    const tools = buildToolsPayload(pi.getAllTools(), pi.getActiveTools());
    const sessionId = getSessionId(ctx);
    const branchEntries = event.branchEntries as BranchEntry[];
    const remoteState = getMatchingRemoteState(sessionId, model);
    const observedRequestShape = getRequestShapeState(sessionId);
    const fullBranchMessages = getBranchMessages(branchEntries);
    const responseItems = remoteState
      ? remoteState.explicitHistory
      : messagesToResponseItems(fullBranchMessages);
    const promptResponseItems = normalizeResponseItemsForPrompt(responseItems, model);
    const thinkingLevel = pi.getThinkingLevel();
    const fallbackReasoning = model.reasoning
      ? thinkingLevelToResponsesReasoning(thinkingLevel ?? getBranchThinkingLevel(branchEntries))
      : undefined;

    const [localResult, remoteResult] = await Promise.allSettled([
      generateBestEffortLocalSummary({
        preparation: event.preparation,
        messages: fullBranchMessages,
        model,
        runtime: ctx.modelRegistry,
        apiKey: auth.apiKey,
        headers: auth.headers,
        env: auth.env,
        customInstructions: event.customInstructions,
        signal: event.signal,
        thinkingLevel,
        firstKeptEntryId: event.preparation.firstKeptEntryId,
        tokensBefore: event.preparation.tokensBefore,
      }),
      callRemoteCompactionEndpoint({
        model: requestModel,
        apiKey: auth.apiKey,
        headers: auth.headers,
        sessionId,
        input: promptResponseItems,
        instructions: ctx.getSystemPrompt(),
        tools,
        parallelToolCalls: true,
        reasoning: observedRequestShape?.reasoning ?? fallbackReasoning,
        text: observedRequestShape?.text,
        signal: event.signal,
      }),
    ]);

    if (remoteResult.status !== "fulfilled") {
      if (!event.signal.aborted && ctx.hasUI) {
        const message = remoteResult.reason instanceof Error ? remoteResult.reason.message : String(remoteResult.reason);
        ctx.ui.notify(`Codex remote compaction failed; falling back to Pi's summary. ${message}`, "warning");
      }
      return localResult.status === "fulfilled" ? { compaction: localResult.value } : undefined;
    }

    if (cfg.notify && ctx.hasUI) {
      ctx.ui.notify(
        `Codex remote compaction stored for ${String(model.provider)}/${String(model.id)}`,
        "info",
      );
    }

    const remoteDetails = buildRemoteCompactionDetails(
      model,
      remoteResult.value.output,
      remoteResult.value.usage,
    );
    const localSummary =
      localResult.status === "fulfilled"
        ? localResult.value
        : {
            summary: buildCompactionSummaryText(model),
            firstKeptEntryId: event.preparation.firstKeptEntryId,
            tokensBefore: event.preparation.tokensBefore,
          };

    return {
      compaction: {
        summary: localSummary.summary,
        firstKeptEntryId: localSummary.firstKeptEntryId,
        tokensBefore: localSummary.tokensBefore,
        usage: combineUsage(localSummary.usage, remoteResult.value.usage),
        details: {
          ...(localSummary.details !== undefined ? { localSummaryDetails: localSummary.details } : {}),
          remoteCompaction: remoteDetails,
        },
      },
    };
  });

  pi.on("message_end", (event, ctx) => {
    extendRemoteHistoryIfCompatible({
      sessionId: getSessionId(ctx),
      model: ctx.model,
      message: event.message,
    });
  });

  pi.on("before_provider_request", (event, ctx) => {
    const cfg = loadConfig(ctx.cwd);
    const model = ctx.model;
    if (!cfg.enabled || !model || !supportsRemoteCompactionModel(model)) return undefined;
    if (!isRecord(event.payload) || !looksLikeResponsesPayload(event.payload)) return undefined;

    const sessionId = getSessionId(ctx);
    setRequestShapeState(sessionId, {
      reasoning: extractResponsesReasoningConfig(event.payload),
      text: extractResponsesTextConfig(event.payload),
    });

    const remoteState = getMatchingRemoteState(sessionId, model);
    if (!remoteState) return undefined;

    return applyRemoteHistoryPayloadPatch({
      payload: event.payload,
      explicitHistory: normalizeResponseItemsForPrompt(remoteState.explicitHistory, model) as unknown[],
    });
  });
}
