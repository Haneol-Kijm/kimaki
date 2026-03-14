import { type ThreadChannel } from 'discord.js'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { store } from '../store.js'
import {
  buildExecArgs,
  buildResumeArgs,
  CodexThreadRuntime,
  formatCodexAssistantText,
  formatCommandStarted,
  formatCommandExecution,
  formatFileChanges,
  isReadOnlyCommand,
} from './codex-thread-runtime.js'
import type { EnqueueResult } from './thread-session-runtime.js'
import * as threadState from './thread-runtime-state.js'
import type { QueuedMessage } from './thread-runtime-state.js'

type CodexRuntimeInternals = {
  blockedAfterAbort: boolean
  enqueueResolvedInput(input: QueuedMessage): Promise<EnqueueResult>
  startDrainLoop(): void
}

function createRuntime(threadId: string): CodexThreadRuntime {
  threadState.ensureThread(threadId)

  const thread = {
    id: threadId,
    sendTyping: vi.fn().mockResolvedValue(undefined),
  } as unknown as ThreadChannel

  return new CodexThreadRuntime({
    threadId,
    thread,
    projectDirectory: '/tmp/project',
    sdkDirectory: '/tmp/project',
  })
}

describe('CodexThreadRuntime abort recovery', () => {
  beforeEach(() => {
    store.setState((state) => ({
      ...state,
      threads: new Map(),
    }))
  })

  test('first explicit message after abort restarts the drain loop immediately when idle', async () => {
    const runtime = createRuntime('thread-abort-recovery')
    const runtimeInternals = runtime as unknown as CodexRuntimeInternals
    runtimeInternals.blockedAfterAbort = true

    const startDrainLoop = vi
      .spyOn(runtimeInternals, 'startDrainLoop')
      .mockImplementation(() => {})

    const result = await runtimeInternals.enqueueResolvedInput({
      prompt: 'resume after abort',
      userId: 'user-1',
      username: 'Kimaki Tester',
    })

    expect(result).toEqual({ queued: false })
    expect(runtimeInternals.blockedAfterAbort).toBe(false)
    expect(startDrainLoop).toHaveBeenCalledOnce()
    expect(
      threadState.getThreadState('thread-abort-recovery')?.queueItems,
    ).toHaveLength(1)
  })
})

describe('Codex command rendering', () => {
  test('treats common inspection commands as read-only', () => {
    expect(isReadOnlyCommand('/bin/bash -lc pwd')).toBe(true)
    expect(isReadOnlyCommand("/bin/bash -lc 'find /tmp -maxdepth 1 | sort | head -n 5'")).toBe(true)
    expect(isReadOnlyCommand("/bin/bash -lc 'touch foo.txt'")).toBe(false)
  })

  test('hides successful read-only command output from Discord', () => {
    expect(
      formatCommandExecution({
        command: '/bin/bash -lc pwd',
        output: '/tmp/project',
        exitCode: 0,
      }),
    ).toBeUndefined()
  })

  test('does not show bash token-count summaries for large successful output', () => {
    expect(
      formatCommandExecution({
        command: '/bin/bash -lc cat big.txt',
        output: 'a'.repeat(20_000),
        exitCode: 0,
      }),
    ).toBeUndefined()
  })

  test('keeps failed command output visible', () => {
    expect(
      formatCommandExecution({
        command: "/bin/bash -lc 'cat missing.txt'",
        output: 'cat: missing.txt: No such file or directory',
        exitCode: 1,
      }),
    ).toContain('Command failed:')
  })

  test('formats assistant progress text in Kimaki style', () => {
    expect(
      formatCodexAssistantText('현재 작업 디렉터리를 바로 확인합니다.'),
    ).toBe('⬥ 현재 작업 디렉터리를 바로 확인합니다.')
  })

  test('converts markdown links into plain text before sending to Discord', () => {
    expect(
      formatCodexAssistantText(
        '핵심 파일은 [codex-prompt.ts](/home/haneol/kimaki/discord/src/codex/codex-prompt.ts) 야.',
      ),
    ).toBe(
      '⬥ 핵심 파일은 codex-prompt.ts: /home/haneol/kimaki/discord/src/codex/codex-prompt.ts 야.',
    )
  })

  test('formats command starts as compact bash progress lines', () => {
    expect(formatCommandStarted('/bin/bash -lc pwd')).toBe('┣ bash _pwd_')
  })

  test('summarizes file deletions instead of showing raw shell verification', () => {
    expect(formatFileChanges([
      {
        path: '/tmp/codex-probe.txt',
        kind: 'delete',
      },
    ])).toBe('┣ deleted *codex-probe.txt*')
  })

  test('passes sandbox mode on resume when not using full access', () => {
    expect(buildResumeArgs({
      sessionId: 'session-1',
      promptText: 'retry',
      sandboxMode: 'workspace-write',
      imagePaths: [],
    })).toContain('--sandbox')
  })

  test('forces supported reasoning effort when an explicit model is selected', () => {
    expect(buildExecArgs({
      promptText: 'retry',
      model: 'gpt-5',
      sandboxMode: 'danger-full-access',
      imagePaths: [],
      cwd: '/tmp/project',
    })).toContain('model_reasoning_effort="high"')
  })

  test('uses the selected reasoning effort when provided', () => {
    expect(buildResumeArgs({
      sessionId: 'session-1',
      promptText: 'retry',
      model: 'gpt-5.4',
      reasoningEffort: 'xhigh',
      sandboxMode: 'danger-full-access',
      imagePaths: [],
    })).toContain('model_reasoning_effort="xhigh"')
  })
})
