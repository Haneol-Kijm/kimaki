import { describe, expect, test } from 'vitest'
import {
  setupQueueAdvancedSuite,
  TEST_USER_ID,
} from './queue-advanced-e2e-setup.js'
import { getRuntime } from './session-handler/thread-session-runtime.js'
import {
  waitForBotMessageContaining,
  waitForFooterMessage,
  waitForMessageById,
} from './test-utils.js'

const TEXT_CHANNEL_ID = '200000000000001009'

type RetryPrompt = {
  messageId: string
  serializedComponents: string
}

function normalizeTimelineSnapshot(text: string): string {
  return text.replace(/\b\d+(?:\.\d+)?(?:ms|s|m)\b/g, 'Ns')
}

async function waitForRetryPrompt({
  discord,
  threadId,
  timeoutMs,
}: {
  discord: ReturnType<typeof setupQueueAdvancedSuite>['discord']
  threadId: string
  timeoutMs: number
}): Promise<RetryPrompt> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const messages = await discord.thread(threadId).getMessages()
    const match = messages.find((message) => {
      return message.content.includes('Choose how to retry the last prompt.')
    })
    if (match) {
      const serializedComponents = JSON.stringify(match.components)
      if (serializedComponents.includes('codex_retry:')) {
        return {
          messageId: match.id,
          serializedComponents,
        }
      }
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100)
    })
  }

  throw new Error(`Timed out waiting for Codex retry prompt in thread ${threadId}`)
}

async function assertNoBotMessageContaining({
  discord,
  threadId,
  text,
  timeoutMs,
}: {
  discord: ReturnType<typeof setupQueueAdvancedSuite>['discord']
  threadId: string
  text: string
  timeoutMs: number
}): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const messages = await discord.thread(threadId).getMessages()
    const match = messages.find((message) => {
      return (
        message.author.id === discord.botUserId &&
        message.content.includes(text)
      )
    })
    if (match) {
      throw new Error(`Unexpected bot message containing "${text}"`)
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 20)
    })
  }
}

describe('codex retry fallback', () => {
  const ctx = setupQueueAdvancedSuite({
    channelId: TEXT_CHANNEL_ID,
    channelName: 'codex-retry-e2e',
    dirName: 'codex-retry-e2e',
    username: 'queue-codex-retry-tester',
  })

  test(
    'read-only sandbox denial offers escalation buttons and retry continues the thread',
    async () => {
      await ctx.discord.channel(TEXT_CHANNEL_ID).user(TEST_USER_ID).sendMessage({
        content: 'Reply with exactly: codex-retry-setup',
      })

      const thread = await ctx.discord.channel(TEXT_CHANNEL_ID).waitForThread({
        timeout: 4_000,
        predicate: (candidate) => {
          return candidate.name === 'Reply with exactly: codex-retry-setup'
        },
      })
      const th = ctx.discord.thread(thread.id)

      await waitForBotMessageContaining({
        discord: ctx.discord,
        threadId: thread.id,
        userId: TEST_USER_ID,
        text: 'ok',
        timeout: 4_000,
      })

      await waitForFooterMessage({
        discord: ctx.discord,
        threadId: thread.id,
        timeout: 4_000,
        afterMessageIncludes: 'ok',
        afterAuthorId: ctx.discord.botUserId,
      })

      const runtime = getRuntime(thread.id)
      if (!runtime) {
        throw new Error('Expected runtime for Codex retry test thread')
      }

      await runtime.enqueueIncoming({
        prompt: 'CODEX_SANDBOX_RETRY_MARKER',
        sandboxMode: 'read-only',
        userId: TEST_USER_ID,
        username: 'queue-codex-retry-tester',
      })

      await waitForBotMessageContaining({
        discord: ctx.discord,
        threadId: thread.id,
        text: 'I hit a sandbox restriction.',
        timeout: 4_000,
      })

      const retryPrompt = await waitForRetryPrompt({
        discord: ctx.discord,
        threadId: thread.id,
        timeoutMs: 4_000,
      })

      expect(retryPrompt.serializedComponents).toContain(
        'codex_retry:workspace-write',
      )
      expect(retryPrompt.serializedComponents).toContain(
        'codex_retry:danger-full-access',
      )

      const interaction = await th.user(TEST_USER_ID).clickButton({
        messageId: retryPrompt.messageId,
        customId: 'codex_retry:workspace-write',
      })

      await th.waitForInteractionAck({
        interactionId: interaction.id,
        timeout: 4_000,
      })

      await waitForBotMessageContaining({
        discord: ctx.discord,
        threadId: thread.id,
        text: 'sandbox-retry-done',
        afterMessageId: retryPrompt.messageId,
        timeout: 8_000,
      })

      await waitForFooterMessage({
        discord: ctx.discord,
        threadId: thread.id,
        timeout: 8_000,
        afterMessageIncludes: 'sandbox-retry-done',
        afterAuthorId: ctx.discord.botUserId,
      })

      expect(
        normalizeTimelineSnapshot(await th.text({ showInteractions: true })),
      ).toMatchInlineSnapshot(`
        "--- from: user (queue-codex-retry-tester)
        Reply with exactly: codex-retry-setup
        --- from: assistant (TestBot)
        ⬥ ok
        *project ⋅ main ⋅ Ns ⋅ codex ⋅ gpt-5.4*
        ⬥ I hit a sandbox restriction. Permission denied while running in read-only mode.
        *project ⋅ main ⋅ Ns ⋅ codex ⋅ gpt-5.4*
        Retrying the last Codex prompt with \`workspace-write\`.
        [user clicks button]
        ⬥ sandbox-retry-done
        *project ⋅ main ⋅ Ns ⋅ codex ⋅ gpt-5.4*"
      `)
    },
    20_000,
  )

  test(
    'cancel leaves the retry prompt dismissed without starting another Codex turn',
    async () => {
      await ctx.discord.channel(TEXT_CHANNEL_ID).user(TEST_USER_ID).sendMessage({
        content: 'Reply with exactly: codex-retry-cancel-setup',
      })

      const thread = await ctx.discord.channel(TEXT_CHANNEL_ID).waitForThread({
        timeout: 4_000,
        predicate: (candidate) => {
          return candidate.name === 'Reply with exactly: codex-retry-cancel-setup'
        },
      })
      const th = ctx.discord.thread(thread.id)

      await waitForBotMessageContaining({
        discord: ctx.discord,
        threadId: thread.id,
        userId: TEST_USER_ID,
        text: 'ok',
        timeout: 4_000,
      })

      await waitForFooterMessage({
        discord: ctx.discord,
        threadId: thread.id,
        timeout: 4_000,
        afterMessageIncludes: 'ok',
        afterAuthorId: ctx.discord.botUserId,
      })

      const runtime = getRuntime(thread.id)
      if (!runtime) {
        throw new Error('Expected runtime for Codex retry cancel test thread')
      }

      await runtime.enqueueIncoming({
        prompt: 'CODEX_SANDBOX_RETRY_MARKER',
        sandboxMode: 'read-only',
        userId: TEST_USER_ID,
        username: 'queue-codex-retry-tester',
      })

      const retryPrompt = await waitForRetryPrompt({
        discord: ctx.discord,
        threadId: thread.id,
        timeoutMs: 4_000,
      })

      const interaction = await th.user(TEST_USER_ID).clickButton({
        messageId: retryPrompt.messageId,
        customId: 'codex_retry:cancel',
      })

      await th.waitForInteractionAck({
        interactionId: interaction.id,
        timeout: 4_000,
      })

      const cancelledMessage = await waitForMessageById({
        discord: ctx.discord,
        threadId: thread.id,
        messageId: retryPrompt.messageId,
        timeout: 4_000,
      })
      expect(cancelledMessage.content).toContain('Retry cancelled.')

      await assertNoBotMessageContaining({
        discord: ctx.discord,
        threadId: thread.id,
        text: 'sandbox-retry-done',
        timeoutMs: 400,
      })

      expect(
        normalizeTimelineSnapshot(await th.text({ showInteractions: true })),
      ).toMatchInlineSnapshot(`
        "--- from: user (queue-codex-retry-tester)
        Reply with exactly: codex-retry-cancel-setup
        --- from: assistant (TestBot)
        ⬥ ok
        *project ⋅ main ⋅ Ns ⋅ codex ⋅ gpt-5.4*
        ⬥ I hit a sandbox restriction. Permission denied while running in read-only mode.
        *project ⋅ main ⋅ Ns ⋅ codex ⋅ gpt-5.4*
        Retry cancelled.
        [user clicks button]"
      `)
    },
    20_000,
  )
})
