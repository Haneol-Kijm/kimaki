# Codex-Only Porting TODO

This file tracks the remaining work for the `port/codex-only-upstream` branch.
It is intentionally narrower than the historical fork. The goal is to make
Kimaki's Discord text-thread UX work well with Codex first, while keeping
OpenCode and gateway code present but out of the critical path.

## Current Direction

- Default execution model: Codex-only
- Default sandbox expectation: no approval UI in normal use
- Keep OpenCode and gateway code in the repo, but do not treat them as the
  primary path for this port
- Voice is deferred
- Screenshare is deferred

## Already Landed

- Codex-backed text thread runtime
- Codex session lifecycle commands for new session, resume, and session id
- Codex model command surface
- Codex retry and upload guidance in prompt/CLI
- Codex sandbox retry fallback with escalation coverage for restricted modes
- Test stabilization for core thread queue flows using a mock Codex CLI

## Next Priority

### Interrupt and Queue Behavior

These affect normal Discord use and should be treated as first-class:

- interrupt while a run is typing or streaming
- queue drain after interrupt
- typing indicator lifecycle during interrupt and resume
- model-switch interrupt behavior, if still user-visible in Codex-only mode

## Keep, But As Fallback

### Permission UI

- Normal path should assume approval-free operation
- Permission UI can remain as a fallback for future restricted modes or retry
  escalation flows
- Do not make approval prompts part of the default mobile UX

## Deferred

### Question UI

Current upstream question handling is an OpenCode capability plus a Kimaki
Discord adapter. It is not a direct Codex feature.

Short-term plan:

- no direct port yet
- plain text question/answer is acceptable for now

If revisited later:

- treat it as a Kimaki-native adapter for Codex, not as a direct port of the
  OpenCode question primitive
- the existing Discord select-menu UX is good reference material
- Codex plan-mode style interactions are a conceptual reference, not a
  protocol we can directly reuse

### Agent Model Surface

- upstream "agent" behavior is mostly tied to OpenCode concepts
- keep `/agent` and quick `*-agent` commands disabled on the active Codex-only
  branch until profiles/CODEX_HOME are redefined as native Codex presets
- do not force a Codex mapping in v1
- if needed later, redefine "agent" as a preset of prompt/model/reasoning
  behavior instead of copying OpenCode semantics

### Voice

- keep as TODO
- do not block text-thread usability work on Gemini Live integration

### Screenshare

- keep as TODO
- useful later for browser/computer-use flows, but not required for the first
  Codex-only usable build

## Leave Present But De-Emphasized

- OpenCode plugin loading
- external OpenCode sync
- gateway/self-hosted infrastructure

These should remain in the repository for now, but they are not the first thing
to port or validate for Codex-only usage.

## Validation Policy

- after code changes, run `pnpm tsc --pretty false` in `discord`
- for queueing/message-handling changes, run `pnpm test -u --run` in `discord`
- treat targeted e2e tests as a fast gate, but do not confuse them with the
  final real Codex CLI validation

## Open Questions

- how much of the old permission flow is still worth preserving once Codex is
  the default and sandbox escalation is explicit
- whether `/model` should fully subsume the old Codex-specific model UX
- what the minimum useful interrupt contract is for day-to-day mobile usage
