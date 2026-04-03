# Codex-Only Porting Brief

## Goal

Rebase this fork onto upstream `remorses/kimaki` while preserving only the
Codex-specific value, not the old OpenCode/Codex backend toggle.

This fork diverged from upstream at `493e02d` (`kimaki@0.4.77`), then added 8
local commits. The meaningful local work is concentrated in:

- Codex runtime support
- backend persistence / routing
- Codex model and retry UX
- a small question handoff fix
- plain URL output adjustments for Discord

For a Codex-only future, the backend-selection layer can be removed instead of
ported as-is.

## Recommended Strategy

1. Start from upstream latest, not from the current fork branch.
2. Re-implement the local intent as feature clusters, not as literal
   cherry-picks.
3. Treat backend selection as disposable infrastructure.
4. Keep SQLite compatibility in mind: prefer leaving old schema/data readable
   over deleting tables/fields immediately.

## Feature Clusters

### 1. Codex Runtime Core

Purpose:
Make Discord threads run through a Codex CLI-backed runtime.

Key files in this fork:

- `discord/src/session-handler/codex-thread-runtime.ts`
- `discord/src/session-handler/thread-session-runtime.ts`
- `discord/src/codex/codex-prompt.ts`

User-visible behavior:

- a thread can execute and continue a Codex session
- Codex gets a Discord-specific prompt wrapper
- sandbox failures can trigger a guided retry path

Important invariants:

- one runtime per thread
- thread/session mapping stays stable across replies
- typing, abort, retry, and session continuation remain thread-scoped

Codex-only conclusion:

- keep the Codex runtime concept
- drop the runtime split between OpenCode and Codex
- in a Codex-only port, `getOrCreateRuntime()` should create a Codex runtime by
  default instead of resolving a backend first

Upstream overlap:

- no equivalent Codex runtime exists upstream
- this is the main feature that must be reintroduced

### 2. Backend Persistence and Routing

Purpose:
Persist a chosen backend per channel/thread and route runtime creation
accordingly.

Key files in this fork:

- `discord/schema.prisma`
- `discord/src/database.ts`
- `discord/src/session-backend.ts`
- `discord/src/commands/backend.ts`
- `discord/src/interaction-handler.ts`

User-visible behavior:

- `/backend` can switch future threads between OpenCode and Codex
- resumed threads can preserve backend identity

Important invariants:

- channel default can differ from thread override
- known session IDs are validated against backend type

Codex-only conclusion:

- this whole cluster is mostly removable
- keep only the parts needed for session identity if they are still useful
- prefer a compatibility path over hard deletion if existing SQLite DBs may
  contain backend rows

Upstream overlap:

- no upstream equivalent
- but in a Codex-only target this should mostly be simplified away, not ported

### 3. Session Lifecycle Commands

Purpose:
Teach `/session`, `/resume`, and `/session-id` how to operate on Codex sessions.

Key files in this fork:

- `discord/src/commands/session.ts`
- `discord/src/commands/resume.ts`
- `discord/src/commands/session-id.ts`

User-visible behavior:

- new session threads can start as Codex sessions
- known Codex sessions can be resumed into a thread
- the bot can show a Codex resume command instead of an OpenCode attach command

Important invariants:

- only sessions created/known by Kimaki should be resumed automatically
- thread/session linkage must be written before the user keeps chatting

Codex-only conclusion:

- keep the Codex lifecycle behavior
- remove OpenCode-only branches, agent autocomplete, and OpenCode attach UX
- `session-id` should become Codex-native by default

Upstream overlap:

- partial overlap only
- upstream has these commands, but their behavior is OpenCode-centric

### 4. Codex Model and Retry UX

Purpose:
Expose Codex-specific model selection, reasoning effort, and sandbox retry UX.

Key files in this fork:

- `discord/src/codex/codex-models.ts`
- `discord/src/commands/codex-model.ts`
- `discord/src/codex/retry-controls.ts`
- `discord/src/commands/codex-retry.ts`

User-visible behavior:

- users can choose a Codex model and reasoning effort
- users can retry a blocked Codex prompt with broader sandbox access

Important invariants:

- model precedence should remain: session override > channel override >
  Codex CLI default
- retry should reuse the last saved user intent, not ask the user to restate it

Codex-only conclusion:

- keep this cluster
- consider merging it into upstream `/model` instead of keeping a separate
  Codex-only command surface

Upstream overlap:

- partial overlap
- upstream has richer generic `/model` flows, but no equivalent Codex model
  parser or Codex retry controls

### 5. Small UX Patches

Purpose:
Preserve small Discord-facing output decisions that make the bot easier to use.

Key files in this fork:

- `discord/src/commands/ask-question.ts`
- `discord/src/commands/diff.ts`
- `discord/src/commands/model.ts`
- `discord/src/commands/model-variant.ts`
- `discord/src/commands/permissions.ts`
- `discord/src/commands/worktrees.ts`

User-visible behavior:

- plain URLs are shown instead of markdown links in several responses
- question UI avoids an immediate follow-up handoff race after cancellation

Codex-only conclusion:

- plain URL output is still worth keeping
- the question handoff cooldown is likely unnecessary in a Codex-only target,
  because it was added around the OpenCode question tool flow

Upstream overlap:

- plain URL behavior is not fully absorbed upstream
- question flow has broader upstream queue/question work, but not this exact
  cooldown patch

## Prompt Injection Inventory

There are still explicit Kimaki-added prompt layers in this repo.

### OpenCode System Prompt

File:

- `discord/src/system-message.ts`

What it does:

- injects Discord-specific behavior into every OpenCode session
- injects critique usage guidance
- injects tunnel instructions, formatting rules, worktree guidance, and other
  Kimaki-specific operational rules

Important note:

- critique here uses `bunx critique`, not `uvx critique`
- this is controlled by `store.critiqueEnabled`
- the CLI can disable it with `--no-critique`

Relevant code paths:

- `discord/src/system-message.ts`
- `discord/src/store.ts`
- `discord/src/cli.ts`

### Codex Prompt Wrapper

Files:

- `discord/src/codex/codex-prompt.ts`
- `discord/src/session-handler/codex-thread-runtime.ts`

What it does:

- prepends a short Discord/mobile-oriented instruction block
- tells Codex to use plain paths / plain URLs
- optionally injects critique instructions
- adds slash-command context when the turn came from a queued slash command

Important note:

- critique here also uses `bunx critique --web`
- Codex runtime passes `includeCritiqueInstructions` from
  `store.getState().critiqueEnabled`

## Critique / Diff Status

Yes, the extra critique guidance is still present in the current repo.

Current facts:

- `/diff` directly runs `bunx critique --web ... --json`
- the OpenCode system prompt still tells the agent to always produce a critique
  URL after edits unless critique is disabled
- the Codex prompt wrapper also tells the agent to run `bunx critique --web`
  and share the URL directly

This means critique behavior currently exists in two places:

1. an explicit slash command implementation (`/diff`)
2. prompt-level behavioral injection for agent replies

## Codex-Only Porting Notes

For a future Codex-only port, the clean target is:

- keep Codex runtime
- keep Codex model/retry behavior
- keep the small plain-URL UX adjustments
- drop backend-selection infrastructure
- decide whether critique stays as a Codex prompt rule, a command-only feature,
  or both

If critique remains, preserve the current command style:

```bash
bunx critique --web "Short title" --filter "path/to/file"
```

The current repo does not use `uvx critique` for this path.
