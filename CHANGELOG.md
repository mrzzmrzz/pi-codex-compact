# Changelog

## 0.3.0 - 2026-10-02

Pi 1.0.0 compatibility.

Fixed:

- `null` header-deletion markers from `ModelRegistry.getApiKeyAndHeaders()`
  (Pi 0.84+ `ProviderHeaders`) are now honored in the remote compaction
  request instead of being sent as the literal string `"null"`
- the remote compaction request uses a credential-resolved `baseUrl` when Pi
  returns one
- the portable summary now falls back to Pi's built-in summary when the model
  call ends with an error instead of storing the placeholder text

Changed:

- the portable summary and fallback summary calls go through
  `ctx.modelRegistry` (`complete` / `streamSimple`) instead of the temporary
  `@earendil-works/pi-ai/compat` entrypoint, so custom providers, resolved
  endpoints and auth `env` are preserved, and prompt caching is disabled for
  the one-off summary call
- compaction results report `usage` (local summary plus remote compaction), so
  Pi includes compaction cost in session totals
- dev dependencies pinned to Pi 1.0.0

## 0.2.0 - 2026-08-25

Focused fork of
[algal/pi-openai-server-compaction](https://github.com/algal/pi-openai-server-compaction),
renamed to **pi-codex-compact**. The extension now does one thing: Codex-style
server-side compaction plus replay of the returned history.

Removed:

- the WebSocket transport replacement (`openai-ws-stream`, `openai-ws-connection`,
  `custom-stream`, `stream-message-shared`) and the `registerProvider` override —
  Pi's own transport is used unchanged, and the `ws` dependency is gone
- `previous_response_id` live continuation, including the `store: true` and
  `context_management` request patching that came with it — normal requests are
  no longer mutated and OpenAI no longer retains them server-side
- Azure partial support (never live-tested upstream)
- legacy version 1 (`/responses/compact`) session artifact reading; the
  persisted version 2 format is unchanged and stays compatible with upstream
- dead config (`compactThreshold`, `thresholdRatio`, `usePreviousResponseId`,
  `includeAzure`) — config is now just `enabled` and `notify`
- the benchmark trees (results remain in the upstream repo, summarized in the
  README)

Changed:

- direct `openai/*` models replay remote compaction history through the same
  `before_provider_request` input replacement the Codex path already used,
  instead of a custom stream
- config files renamed to `~/.pi/agent/codex-compact.json` and
  `.pi/codex-compact.json`; env vars renamed to `PI_CODEX_COMPACT_*`; config is
  cached per process (`/reload` picks up changes)
- `notify` now defaults to on and fires once per stored compaction; remote
  compaction failures always warn instead of degrading silently
- `src/remote-compaction.ts` renamed to `src/compaction.ts`
- dropped the hard Pi peer-dependency pin (`>=0.80.9 <0.81.0` → `*`);
  0.80.9 remains the tested baseline via devDependencies

## 0.1.0 - 2026-04-09 (upstream)

Initial public release as `pi-openai-server-compaction` by Alexis Gallagher.
See the upstream repository for its full history, including the Responses
compaction v2 protocol work, the live RPC regression harness, and the
native-vs-text benchmarks.
