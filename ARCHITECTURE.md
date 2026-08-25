# Architecture

A compact map of how the extension works.

## Design goal

Add Codex-style server-side compaction to Pi for OpenAI Responses models while
leaving everything else about Pi alone. Two representations of context are
kept alive at once:

1. **Portable Pi representation** — normal session JSONL entries plus a
   readable text compaction summary. Used for resume, branch/tree operations,
   model switching, and non-OpenAI replay. Always authoritative.
2. **OpenAI-native representation** — the opaque replacement history returned
   by Responses compaction v2. Used only for compatible future OpenAI /
   OpenAI Codex turns.

The extension registers no provider override and replaces no transport. Its
only request mutation is swapping `input` for the replacement history after a
compaction boundary.

## Control flow

### Compaction turn

1. Pi fires `session_before_compact`.
2. `src/index.ts` runs two tasks in parallel:
   - a portable local summary (`generateBestEffortLocalSummary`)
   - a Responses compaction request (`callRemoteCompactionEndpoint`): Pi
     messages are converted to Responses `input` items, a trailing
     `compaction_trigger` is appended, and the SSE stream is parsed for
     exactly one `compaction` item.
3. On success, retained recent user messages (Codex's 20K-token budget shape)
   plus the opaque item are stored in
   `CompactionEntry.details.remoteCompaction`, alongside the text summary.
4. On remote failure, the local summary is used and a warning is shown.

### Post-compaction turn

1. Pi fires `before_provider_request`.
2. If the in-memory replay state matches the active model, the payload's
   `input` is replaced with the explicit history (replacement history plus
   every post-compaction message, normalized: orphan tool outputs repaired,
   unsupported images stripped).
3. Otherwise the request passes through untouched and Pi's text summary
   carries the context.

`message_end` appends each new message to the explicit history so the replay
input stays current between compactions.

## State

- **Persisted** (session JSONL, survives reloads):
  `compaction.details.remoteCompaction` — version 2, same shape as upstream.
- **Runtime-only** (`src/state.ts`): the reconstructed replay state for the
  active session, and the last observed request shape (reasoning/text config)
  so the compaction request mirrors normal requests.

Runtime state is cleared on session switch/fork/tree and shutdown, and
rebuilt from the branch on session start, tree navigation, and compaction
completion. Reconstruction only replays post-compaction turns whose assistant
completions match the compaction model, preventing cross-model pollution
after resume or tree navigation.

## Modules

| Module              | Responsibility                                                          |
|---------------------|-------------------------------------------------------------------------|
| `src/index.ts`      | Lifecycle wiring, the compaction hook, and the replay payload patch     |
| `src/compaction.ts` | Message conversion, the compaction request, history normalization, state reconstruction |
| `src/openai.ts`     | Model detection, model keys, request-shape extraction                   |
| `src/config.ts`     | `enabled`/`notify` from JSON config and env, cached per cwd             |
| `src/state.ts`      | Ephemeral per-session maps                                              |

## Testing

- `npm run smoke` — offline; verifies imports and the key pure algorithms
  (state reconstruction, request building, SSE parsing, normalization).
- `npm run test:live` — black-box test driving real `pi --mode rpc` sessions:
  continuity after compaction, model switch away and back, fork after
  compaction, resume/reload after compaction.
