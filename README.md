# pi-codex-compact

A Pi extension that does one thing: on compaction, it asks OpenAI's server-side
Responses compaction protocol (the same one Codex uses) to compact the
conversation, and replays the returned opaque history on later compatible
turns.

This is a focused fork of
[algal/pi-openai-server-compaction](https://github.com/algal/pi-openai-server-compaction)
(MIT, Alexis Gallagher). The upstream project also bundled a WebSocket
transport replacement and `previous_response_id` live continuation; this fork
removes both and keeps only the compaction core, so Pi's own transport and
request semantics stay untouched.

## How it works

On a Pi compaction event for a supported model, the extension runs two things
in parallel:

1. **A portable Pi text summary** — the session JSONL stays readable, and
   resume, fork, tree navigation, exports, and model switching keep working.
2. **A Responses compaction request** — `POST /v1/responses` with the
   conversation history and a trailing `compaction_trigger`, mirroring the
   request shape Codex sends (tools, reasoning effort, text config, retained
   user messages under Codex's 20K-token budget).

The returned opaque `compaction` item is stored in
`CompactionEntry.details.remoteCompaction`. On later turns with the same
model, the extension replaces the request's `input` with that replacement
history via `before_provider_request` — no custom transport, no other request
mutation. If the model doesn't match (you switched providers, forked, or
resumed elsewhere), Pi's portable summary is used as usual.

If the remote request fails, compaction falls back to Pi's normal summary and
you get a warning. Nothing else degrades.

## Support

| Provider/model family | Remote compaction | Notes                          |
|-----------------------|-------------------|--------------------------------|
| `openai/*`            | Yes               | direct OpenAI Responses models |
| `openai-codex/*`      | Yes               | built-in transport untouched   |

Azure support from upstream was dropped (it was never live-tested there).

## Install

Project-local (recommended):

```bash
pi install -l git:github.com/mrzzmrzz/pi-codex-compact
```

Global:

```bash
pi install git:github.com/mrzzmrzz/pi-codex-compact
```

Requirements: Node >= 22, Pi, and working auth for a supported OpenAI
Responses model. Developed and tested against Pi 0.80.9; there is no hard
version pin, but the extension relies on Pi's extension events and
`pi-ai/compat` helpers, so a future Pi release could still require an update.

## Configuration

Read from `~/.pi/agent/codex-compact.json` (global) and
`.pi/codex-compact.json` (project-local, takes precedence):

```json
{
  "enabled": true,
  "notify": true
}
```

- `enabled` — turn the extension off without uninstalling.
- `notify` — show a UI notice when a remote compaction is stored (default on;
  it fires at most once per compaction). Failures always warn.

Environment overrides: `PI_CODEX_COMPACT_ENABLED`, `PI_CODEX_COMPACT_NOTIFY`.
Config is cached for the process; `/reload` picks up changes.

## Data handling

- At compaction time, the conversation (history, system prompt, tool
  definitions) is sent to OpenAI's Responses compaction endpoint with
  `store: false`.
- The returned artifact is encrypted, provider-native, and not human-readable.
  It is stored in your local session JSONL next to the readable text summary.
- Unlike upstream, this fork never sets `store: true` on your normal requests
  and never patches requests outside of post-compaction history replay.

## Is native compaction actually better?

Upstream's benchmark (retained in its repo) found the native policy recalled
much more old state than Pi's default compactor (78% vs 48% exact recall) —
but it did so by emitting ~4.6x the compaction output tokens and leaving a
~29% larger billed downstream context, with high variance on small artifacts.
In short: it preserves more, at a higher cost, rather than compressing more
cleverly at the same budget. See
[the upstream report](https://github.com/algal/pi-openai-server-compaction/tree/main/benchmarks/product-defaults)
before deciding it's worth it for your workload.

Also note both a text summary and a remote compaction are generated per
compaction, so each compaction costs roughly two LLM calls.

## Testing

```bash
npm run smoke      # offline: imports and key algorithms
npm run test:live  # end-to-end against real pi + real OpenAI auth
```

Override the live-test model with `PI_CODEX_COMPACT_TEST_MODEL=openai-codex/gpt-5.6-sol`.

## 中文简介

这是一个只做一件事的 Pi 扩展：在压缩（compaction）发生时，调用 OpenAI 服务端的
Responses 压缩协议（即 Codex 使用的协议），并在之后兼容的对话轮次中回放返回的
加密压缩产物。它同时保留 Pi 本地可读的文本摘要，因此 resume / fork / 树导航 /
切换模型等 Pi 语义完全不受影响。相比上游项目，本 fork 移除了 WebSocket 传输层
替换与 `previous_response_id` 续传（含 `store: true`），不再接管 Pi 的传输路径，
唯一的请求改动是压缩边界之后的历史替换。

## Repo layout

| File                                       | Purpose                                            |
|--------------------------------------------|----------------------------------------------------|
| `src/index.ts`                             | Extension wiring: lifecycle hooks and replay patch |
| `src/compaction.ts`                        | Responses compaction protocol and state rebuild    |
| `src/openai.ts`                            | Model detection and payload helpers                |
| `src/config.ts`                            | Configuration loading                              |
| `src/state.ts`                             | Ephemeral per-session runtime state                |
| `tests/live/openai-compaction-rpc-live.ts` | Live Pi RPC regression test                        |
| `scripts/smoke.mjs`                        | Offline smoke test                                 |
| `ARCHITECTURE.md`                          | Design and control-flow documentation              |

## License

MIT. See `LICENSE.md`. Based on
[pi-openai-server-compaction](https://github.com/algal/pi-openai-server-compaction)
by Alexis Gallagher.
