/**
 * In-memory per-session runtime state.
 *
 * Intentionally ephemeral. Persisted remote compaction artifacts live in Pi
 * session entries; this module only caches the reconstructed replay state and
 * the last observed request shape for the running process.
 */
import type {
  RemoteCompactionSessionState,
  ResponsesReasoningConfig,
  ResponsesTextConfig,
} from "./compaction.ts";

export type ResponsesRequestShapeState = {
  reasoning?: ResponsesReasoningConfig;
  text?: ResponsesTextConfig;
};

const remoteCompactionBySessionId = new Map<string, RemoteCompactionSessionState>();
const requestShapeBySessionId = new Map<string, ResponsesRequestShapeState>();

export function getRemoteCompactionState(
  sessionId: string,
): RemoteCompactionSessionState | undefined {
  return remoteCompactionBySessionId.get(sessionId);
}

export function setRemoteCompactionState(
  sessionId: string,
  state: RemoteCompactionSessionState,
): void {
  remoteCompactionBySessionId.set(sessionId, state);
}

export function clearRemoteCompactionState(sessionId: string | undefined): void {
  if (!sessionId) return;
  remoteCompactionBySessionId.delete(sessionId);
}

export function getRequestShapeState(
  sessionId: string,
): ResponsesRequestShapeState | undefined {
  return requestShapeBySessionId.get(sessionId);
}

export function setRequestShapeState(
  sessionId: string,
  state: ResponsesRequestShapeState,
): void {
  requestShapeBySessionId.set(sessionId, state);
}

export function clearRequestShapeState(sessionId: string | undefined): void {
  if (!sessionId) return;
  requestShapeBySessionId.delete(sessionId);
}

export function clearAllState(): void {
  remoteCompactionBySessionId.clear();
  requestShapeBySessionId.clear();
}
