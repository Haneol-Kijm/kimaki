# Codex App-Server Migration Brief

## Goal

Move Kimaki's Codex integration away from the current `codex exec` / `codex resume`
transport and toward a Codex `app-server` / `remote` style runtime.

This is not a small refactor. The current Codex path is a CLI-turn adapter that:

- spawns a local `codex` child process per turn
- resumes sessions via local session ids
- parses JSONL from stdout
- manages interrupt, typing, retry, and footer state in-process

The app-server migration should preserve the current Discord UX where possible,
but replace the transport/session driver layer.

## Upstream Structure Shift

Latest upstream `0.5.0` no longer uses `discord/` as the main package. The
runtime now lives under `cli/`.

This matters immediately:

- migration work should target `cli/src/...`, not `discord/src/...`
- old Codex-port files are still useful as behavior references, not as direct
  patch locations
- "carry forward" means reapplying ideas into the new `cli/` structure, not
  cherry-picking old file paths blindly

## Branch Strategy

### Stable branch to keep

- `port/codex-only-upstream`
- status: current working branch for the existing `exec/resume` port

Do not repurpose this branch for app-server work. It is the current stable
baseline and should stay usable while the new transport is explored.

### New spike branch

- branch: `port/codex-app-server-spike`
- base: `upstream/main` at `c8d8d27` (`release: kimaki@0.5.0`)
- worktree: `/home/haneol/reference/upstream/kimaki-app-server-spike`

This branch should be treated as a transport redesign spike, not an incremental
follow-up on the current `exec/resume` port.

## Current Delta Snapshot

Compared with the old Codex-only port baseline at `205ec4f`, the current
`port/codex-only-upstream` branch contains these custom commits:

1. `ab5eccb` `port: add codex-only text session runtime`
2. `a2af7b4` `feat: add codex discord upload guidance`
3. `1e397d6` `test: stabilize codex-only thread e2e flows`
4. `e055b26` `docs: add codex-only porting todo`
5. `6799fc9` `fix: restore codex interrupt queue semantics`
6. `6cf199c` `test: cover codex sandbox retry fallback`
7. `a10f848` `port: disable legacy agent surface on codex-only branch`
8. `43e6f1f` `test: add typing repulse codex mock flow`
9. `0e0f1bd` `test: narrow legacy e2e coverage for codex-only`
10. `cc70c9d` `feat: isolate kimaki codex home`
11. `e8feeb3` `feat: default kimaki codex home to fast mode`
12. `fb3f9d7` `feat: route codex persona through developer instructions`
13. `e9b3888` `fix: restart codex thread when persisted session is missing`
14. `a8abe26` `fix: bootstrap kimaki codex auth from default home`
15. `1690963` `fix: localize codex first turn and show ctx footer`
16. `b55d697` `feat: replace upgrade slash command with restart`
17. `be839c5` `fix(codex): reduce failed command verbosity`

As of this spike creation:

- current stable custom stack: `17` commits
- latest upstream beyond `205ec4f`: `176` commits

## Carry Forward vs Redesign

### Reuse as-is or nearly as-is

These are transport-agnostic or mostly UX/config concerns and should likely be
reapplied early on the new branch, but now against `cli/src/...` rather than
the old `discord/src/...` layout.

- `codex prompt/persona wrapper`
  - mobile-first Discord prompt wrapper
  - critique/upload guidance
- `Codex model defaults and discovery`
  - Codex model discovery/default model handling
- `model and reasoning effort UI`
  - model and reasoning effort UI
- `retry/escalation button UX`
  - retry/escalation UI copy and button flow
- `retry interaction handling`
  - retry interaction handling
- `queue state helpers`
  - generic queue state helpers
- `/restart`
  - restart-only command matches current deployment model
- `Korean first-turn project prompt`
  - keep the Korean first-turn prompt behavior

### Reuse conceptually, but redesign implementation

These carry valuable behavior, but the implementation is tied to the local CLI
transport and should not be cherry-picked blindly.

- `codex-thread-runtime`
  - currently owns `codex exec`/`resume`, stdout JSONL parsing, footer synthesis,
    local interrupt, typing keepalive, and retry state
- `thread-session-runtime`
  - runtime registry and lifecycle assumptions are still shaped around the
    existing process/session model
- `/session`, `/resume`, `/session-id`
- `/compact`
  - old implementation is OpenCode summarize-based today; Codex should use a
    real protocol surface if app-server exposes one
- `codex-home`
  - useful settings and persona scaffolding, but currently assumes a local
    `CODEX_HOME` and local auth bootstrap
- CLI bootstrap/auth glue
  - any bootstrap logic related to local Codex home/auth should become
    transport-aware or remote-aware

### Do not carry forward directly

These are either explicitly legacy/OpenCode leftovers or test harness artifacts
for the old local CLI path.

- `discord/src/commands/agent.ts`
  - currently disabled legacy surface; do not revive unchanged
- disabled `/agent` wiring in `discord-command-registration.ts` and `cli.ts`
- `discord/scripts/mock-codex-cli.js`
  - local harness for the `exec/resume` path only
- codex-only e2e harness files tied to local mock CLI semantics
- `docs/codex-only-porting-todo.md`
  - keep conclusions, not the file itself

## Why App-Server Is Attractive

The biggest new finding from this spike is that app-server already exposes
protocol-level surfaces for several features that are awkward or missing in the
current `exec/resume` adapter.

Confirmed protocol signals from generated app-server types/schema:

- compaction:
  - `thread/compact/start`
  - `thread/compacted`
- interrupt:
  - `turn/interrupt`
- plan updates:
  - `turn/plan/updated`
  - `item/plan/delta`
- structured user input:
  - `item/tool/requestUserInput`
  - question objects with `header`, `id`, `question`, `options`, `isOther`,
    and `isSecret`
- token usage:
  - `thread/tokenUsage/updated`
- realtime/media:
  - `thread/realtime/started`
  - `thread/realtime/transcript/delta`
  - `thread/realtime/outputAudio/delta`
  - `thread/realtime/sdp`
- config surfaces:
  - `compact_prompt`
  - `model_auto_compact_token_limit`
  - `developer_instructions`
  - `service_tier`
  - `model_reasoning_effort`

That changes the migration outlook. This is no longer just "maybe remote is a
better transport". It is also "remote may already support the exact control
surfaces Kimaki wants to expose".

Why that matters:

- better session continuity without local session-file juggling
- cleaner restart and reconnect semantics
- a real protocol place for `/compact`
- a real protocol place for plan/question style interaction UIs
- token-usage updates without log scraping or local heuristics
- a better path toward browser/computer-use artifacts and control

In other words: this is the right long-term direction if the server protocol
becomes stable enough.

## Current Unknowns / Risks

- Codex `app-server` is still experimental
- remote auth story is not yet integrated into Kimaki
- current event derivation assumes OpenCode-like message/part shapes
- current prompt/config layer assumes local `CODEX_HOME`
- the protocol has `requestUserInput`, but Kimaki still needs a Discord adapter
  and lifecycle rules around expiry, stale prompts, and interrupt
- websocket auth modes (`capability-token`, `signed-bearer-token`) exist, but
  are not yet exercised in Kimaki
- there is no evidence yet that every desired capability is stable in the same
  way the generated schema is

## Latest Upstream Runtime Map

The key runtime files in latest upstream `cli/` are:

- `cli/src/bin.ts`
- `cli/src/cli.ts`
- `cli/src/discord-bot.ts`
- `cli/src/interaction-handler.ts`
- `cli/src/opencode.ts`
- `cli/src/session-handler/thread-session-runtime.ts`
- `cli/src/session-handler/thread-runtime-state.ts`
- `cli/src/session-handler/event-stream-state.ts`
- `cli/src/store.ts`

Transport seams that would be replaced or heavily redesigned:

- `ThreadSessionRuntime.submitViaOpencodeQueue`
- `ThreadSessionRuntime.dispatchPrompt`
- `ThreadSessionRuntime.abortSessionViaApi`
- `ThreadSessionRuntime.startEventListener`
- `ThreadSessionRuntime.ensureSession`
- `cli/src/opencode-command-detection.ts`
- `cli/src/external-opencode-sync.ts`

## First Redesign Targets

These files should be treated as the initial hard boundary for the spike in the
latest `cli/` layout:

- `cli/src/session-handler/thread-session-runtime.ts`
- `cli/src/session-handler/event-stream-state.ts`
- `cli/src/interaction-handler.ts`
- `cli/src/commands/session.ts`
- `cli/src/commands/resume.ts`
- `cli/src/commands/abort.ts`
- `cli/src/commands/compact.ts`
- `cli/src/commands/ask-question.ts`
- `cli/src/opencode.ts`
- `cli/src/opencode-interrupt-plugin.ts`

These are the current transport and control-plane surface.

## Recommended Spike Sequence

1. Build a minimal local Codex app-server probe:
   - start `codex app-server`
   - inspect stdio or websocket transport
   - verify auth/session startup assumptions
2. Write a small adapter document mapping:
   - current Discord runtime events
   - app-server events
   - required state derivations
3. Decide how session identity is represented:
   - remote session id
   - local thread mapping
   - whether `CODEX_HOME` remains local-only or becomes optional
4. Probe whether `/compact` can be implemented as a true remote protocol call
   instead of a Kimaki-managed summarize-and-reopen fallback.
5. Probe whether request-user-input / plan events can drive the existing
   Discord question UI with a thinner adapter than the OpenCode path needs.
6. Build a minimal spike runtime that can:
   - start a remote-backed session
   - stream assistant output
   - interrupt
   - continue same Discord thread
7. Only after that, port higher-level UX:
   - retry buttons
   - plan/question UI
   - agent/profile ideas

## Concrete Success Criteria For The Spike

The spike is worth keeping only if it can prove all of these:

- same Discord thread can survive a server reconnect
- interrupt still works without local CLI child-process control
- footer/model/session handling still makes sense
- `/compact` is either fixed through real protocol support or replaced with a
  clearly better contract
- plan/question style UI becomes more plausible through protocol signals, not
  less

If those do not improve, the `exec/resume` path should remain the default.
