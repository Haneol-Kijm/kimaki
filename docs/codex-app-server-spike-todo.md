# Codex App-Server Spike TODO

## Goal

Explore whether Kimaki should migrate the Codex runtime from local
`exec/resume` calls to a Codex `app-server` / `remote` transport.

## Immediate Tasks

- Inspect the real `codex app-server` surface and protocol shape
- Inspect whether `--remote` and remote auth are sufficient for Kimaki
- Identify whether app-server exposes a true compact/session-summary primitive
- Identify whether app-server exposes session lifecycle events useful for:
  - interrupt
  - idle/completion
  - question/plan mode
  - artifacts/browser-control

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

## Exit Criteria

Keep the migration if the spike proves:

- better session continuity than local `exec/resume`
- no regression in interrupt behavior
- a realistic path for `/compact`
- a realistic path for plan/question UI

Otherwise, keep the current `exec/resume` branch as primary and treat app-server
as deferred research.
