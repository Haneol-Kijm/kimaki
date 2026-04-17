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

## Exit Criteria

Keep the migration if the spike proves:

- better session continuity than local `exec/resume`
- no regression in interrupt behavior
- a realistic path for `/compact`
- a realistic path for plan/question UI

Otherwise, keep the current `exec/resume` branch as primary and treat app-server
as deferred research.
