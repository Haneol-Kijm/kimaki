# Codex App-Server Spike TODO

## Goal

Explore whether Kimaki should migrate the Codex runtime from local
`exec/resume` calls to a Codex `app-server` / `remote` transport.

## Immediate Tasks

- Build a tiny `codex app-server` probe and confirm transport shape in practice
- Verify whether `--remote` and websocket auth are sufficient for Kimaki
- Map current `cli/src/session-handler/thread-session-runtime.ts` expectations
  onto app-server protocol notifications
- Identify which Discord UX surfaces become thinner adapters instead of
  transport-specific implementations

## Reuse Early

- dedicated Codex settings defaults
- persona/developer instruction layer
- model/effort UI
- retry button UX
- `/restart`
- Korean first-turn prompt behavior

## Redesign Early

- runtime/session driver
- event normalization
- `/session`, `/resume`, `/session-id`
- `/compact`
- interrupt lifecycle
- typing lifecycle

## Do Not Port Blindly

- local `CODEX_HOME` bootstrap assumptions
- local auth bootstrap assumptions
- mock CLI harness
- disabled `/agent` legacy surface

## Investigation Questions

- Does app-server expose a stable event stream suitable for Discord rendering?
- Can Kimaki still own queue ordering cleanly?
- What becomes the source of truth for session state?
- Can remote transport make plan/question UI simpler?
- Can remote transport eventually subsume screenshare/browser-control flows?
- Can `thread/compact/start` replace Kimaki-managed summarization?
- Can `item/tool/requestUserInput` replace the current OpenCode-only question
  contract?
- Can `thread/tokenUsage/updated` replace local footer heuristics?

## Confirmed Protocol Signals

Already confirmed from generated app-server schema/types:

- `thread/compact/start`
- `thread/compacted`
- `turn/interrupt`
- `turn/plan/updated`
- `item/plan/delta`
- `item/tool/requestUserInput`
- `thread/tokenUsage/updated`
- realtime notifications under `thread/realtime/*`

This means compact, plan-mode style UI, question UI, and context usage are no
longer speculative benefits. They are real protocol candidates for the spike.

## Confirmed Runtime Signals

Already observed through `codex debug app-server send-message-v2 ...`:

- real lifecycle:
  - `initialize`
  - `thread/start`
  - `turn/start`
  - `thread/status/changed`
  - `turn/started`
  - `item/started`
  - `item/completed`
  - `thread/tokenUsage/updated`
  - `turn/completed`
- startup noise:
  - `mcpServer/startupStatus/updated`
- runtime thread metadata includes:
  - `serviceTier`
  - `reasoningEffort`
  - `approvalPolicy`
  - `sandbox`
  - `instructionSources`
- `thread/tokenUsage/updated` is emitted in practice, not just schema
- `turn/plan/updated` is emitted in practice
- `request_user_input` exists in practice but is rejected in Default mode

Already observed through a direct stdio JSON-RPC probe against
`codex app-server --listen stdio://`:

- `turn/start.collaborationMode = { mode: \"plan\", settings: ... }` unlocks
  real `item/tool/requestUserInput`
- the request includes a server request `id` plus:
  - `threadId`
  - `turnId`
  - `itemId`
  - structured `questions[]`
- replying to that same JSON-RPC request id with:
  - `result.answers.<question_id>.answers = [ ... ]`
  resumes the turn successfully
- after the response:
  - `waitingOnUserInput` clears
  - token usage updates continue
  - final assistant output arrives
  - `turn/completed` fires

## Immediate Follow-Up Questions

- Which turns should Kimaki run in `plan` mode vs `default` mode?
- Can Kimaki set that mode per turn without breaking normal chat behavior?
- Can `turn/plan/updated` alone already power a partial plan UI before full
  structured input support?
- What is the right server-request-id mapping layer for Discord interactions?

## Exit Criteria

Keep the migration if the spike proves:

- better session continuity than local `exec/resume`
- no regression in interrupt behavior
- a realistic path for `/compact`
- a realistic path for plan/question UI

Otherwise, keep the current `exec/resume` branch as primary and treat app-server
as deferred research.
