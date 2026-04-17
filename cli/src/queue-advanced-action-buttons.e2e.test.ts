// E2e regression test for action button click continuation in thread sessions.
// Reproduces the bug where button click interaction acks but the session does not continue.

import { describe, test, expect } from 'vitest'
import {
  setupQueueAdvancedSuite,
  TEST_USER_ID,
} from './queue-advanced-e2e-setup.js'
import {
  waitForBotMessageContaining,
  waitForFooterMessage,
} from './test-utils.js'
import { getThreadSession } from './database.js'
import {
  pendingActionButtonContexts,
  showActionButtons,
} from './commands/action-buttons.js'

const TEXT_CHANNEL_ID = '200000000000001006'

async function waitForPendingActionButtons({
  threadId,
  timeoutMs,
}: {
  threadId: string
  timeoutMs: number
}): Promise<{ contextHash: string; messageId: string }> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const entry = [...pendingActionButtonContexts.entries()].find(([, context]) => {
      return context.thread.id === threadId && Boolean(context.messageId)
    })
    if (entry) {
      const [contextHash, context] = entry
      if (context.messageId) {
        return { contextHash, messageId: context.messageId }
      }
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100)
    })
  }
  throw new Error('Timed out waiting for pending action buttons context')
}

async function waitForNoPendingActionButtons({
  threadId,
  timeoutMs,
}: {
  threadId: string
  timeoutMs: number
}): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const stillPending = [...pendingActionButtonContexts.values()].some((context) => {
      return context.thread.id === threadId
    })
    if (!stillPending) {
      return
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100)
    })
  }
  throw new Error('Timed out waiting for action buttons cleanup')
}

describe('queue advanced: action buttons', () => {
  const ctx = setupQueueAdvancedSuite({
    channelId: TEXT_CHANNEL_ID,
    channelName: 'qa-action-buttons-e2e',
    dirName: 'qa-action-buttons-e2e',
    username: 'queue-action-tester',
  })

  test(
    'button click should continue the session with a follow-up assistant reply',
    async () => {
      await ctx.discord.channel(TEXT_CHANNEL_ID).user(TEST_USER_ID).sendMessage({
        content: 'Reply with exactly: action-button-setup',
      })

      const thread = await ctx.discord.channel(TEXT_CHANNEL_ID).waitForThread({
        timeout: 4_000,
        predicate: (t) => {
          return t.name === 'Reply with exactly: action-button-setup'
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

      const currentSessionId = await getThreadSession(thread.id)
      if (!currentSessionId) {
        throw new Error('Expected thread session id before showing action buttons')
      }

      const channel = await ctx.botClient.channels.fetch(thread.id)
      if (!channel || !channel.isThread()) {
        throw new Error('Expected Discord thread channel for action button test')
      }

      await showActionButtons({
        thread: channel,
        sessionId: currentSessionId,
        directory: ctx.directories.projectDirectory,
        buttons: [{ label: 'Continue action-buttons flow', color: 'green' }],
      })

      const action = await waitForPendingActionButtons({
        threadId: thread.id,
        timeoutMs: 12_000,
      })

      await waitForBotMessageContaining({
        discord: ctx.discord,
        threadId: thread.id,
        userId: TEST_USER_ID,
        text: 'Action Required',
        timeout: 12_000,
      })

      const interaction = await th.user(TEST_USER_ID).clickButton({
        messageId: action.messageId,
        customId: `action_button:${action.contextHash}:0`,
      })

      await th.waitForInteractionAck({
        interactionId: interaction.id,
        timeout: 4_000,
      })

      await waitForBotMessageContaining({
        discord: ctx.discord,
        threadId: thread.id,
        text: 'action-buttons-click-continued',
        timeout: 12_000,
      })

      await waitForFooterMessage({
        discord: ctx.discord,
        threadId: thread.id,
        timeout: 12_000,
        afterMessageIncludes: 'action-buttons-click-continued',
        afterAuthorId: ctx.discord.botUserId,
      })

      const timeline = await th.text({ showInteractions: true })
      expect(timeline).toMatchInlineSnapshot(`
        "--- from: user (queue-action-tester)
        Reply with exactly: action-button-setup
        --- from: assistant (TestBot)
        ⬥ ok
        *project ⋅ main ⋅ Ns ⋅ N% ⋅ deterministic-v2*
        **Action Required**
        _Selected: Continue action-buttons flow_
        [user clicks button]
        ⬥ action-buttons-click-continued
        *project ⋅ main ⋅ Ns ⋅ N% ⋅ deterministic-v2*"
      `)
      expect(timeline).toContain('action-buttons-click-continued')
    },
    20_000,
  )

  test(
    'manual thread message dismisses pending action buttons',
    async () => {
      await ctx.discord.channel(TEXT_CHANNEL_ID).user(TEST_USER_ID).sendMessage({
        content: 'Reply with exactly: action-button-dismiss-setup',
      })

      const thread = await ctx.discord.channel(TEXT_CHANNEL_ID).waitForThread({
        timeout: 4_000,
        predicate: (t) => {
          return t.name === 'Reply with exactly: action-button-dismiss-setup'
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

      const currentSessionId = await getThreadSession(thread.id)
      if (!currentSessionId) {
        throw new Error('Expected thread session id before showing action buttons')
      }

      const channel = await ctx.botClient.channels.fetch(thread.id)
      if (!channel || !channel.isThread()) {
        throw new Error('Expected Discord thread channel for action button test')
      }

      await showActionButtons({
        thread: channel,
        sessionId: currentSessionId,
        directory: ctx.directories.projectDirectory,
        buttons: [{ label: 'Dismiss me', color: 'white' }],
      })

      await waitForPendingActionButtons({
        threadId: thread.id,
        timeoutMs: 4_000,
      })

      await th.user(TEST_USER_ID).sendMessage({
        content: 'Reply with exactly: post-dismiss-user-message',
      })

      await waitForBotMessageContaining({
        discord: ctx.discord,
        threadId: thread.id,
        text: 'Buttons dismissed.',
        timeout: 4_000,
      })

      await waitForNoPendingActionButtons({
        threadId: thread.id,
        timeoutMs: 4_000,
      })

      const timeline = await th.text({ showInteractions: true })
      expect(timeline).toMatchInlineSnapshot(`
        "--- from: user (queue-action-tester)
        Reply with exactly: action-button-dismiss-setup
        --- from: assistant (TestBot)
        ⬥ ok
        *project ⋅ main ⋅ Ns ⋅ N% ⋅ deterministic-v2*
        **Action Required**
        _Buttons dismissed._
        --- from: user (queue-action-tester)
        Reply with exactly: post-dismiss-user-message
        --- from: assistant (TestBot)
        ⬦ info: Context cache discarded: system prompt changed since the previous message (+269 / -40).
        \`\`\`diff
        -You are a title generator. You output ONLY a thread title. Nothing else.
        +You are opencode, an interactive CLI tool that helps users with software engineering tasks. Use the instructions below and the tools available to you to assist the user.
         
        -<task>
        -Generate a brief title that would help the user find this conversation later.
        +IMPORTANT: You must NEVER generate or guess URLs for the user unless you are confident that the URLs are for helping the user with programming. You may use URLs provided by the user in their messages or local files.
         
        -Follow all rules in <rules>
        -Use the <examples> so you know what a good title looks like.
        -Your output must be:
        -- A single line
        -- ≤50 characters
        -- No explanations
        -</task>
        +If the user asks for help or wants to give feedback inform them of the following:
        +- /help: Get help with using opencode
        +- To give feedback, users should report the issue at https://github.com/anomalyco/opencode/issues
         
        -<rules>
        -- you MUST use the same language as the user message you are summarizing
        -- Title must be grammatically correct and read naturally - no word salad
        -- Never include tool names in the title (e.g. "read tool", "bash tool", "edit tool")
        -- Focus on the main topic or question the user needs to retrieve
        -- Vary your phrasing - avoid repetitive patterns like always starting with "Analyzing"
        -- When a file is mentioned, focus on WHAT the user wants to do WITH the file, not just that they shared it
        -- Keep exact: technical terms, numbers, filenames, HTTP codes
        -- Remove: the, this, my, a, an
        -- Never assume tech stack
        -- Never use tools
        -- NEVER respond to questions, just generate a title for the conversation
        -- The title should NEVER include "summarizing" or "generating" when generating a title
        -- DO NOT SAY YOU CANNOT GENERATE A TITLE OR COMPLAIN ABOUT THE INPUT
        -- Always output something meaningful, even if the input is minimal.
        -- If the user message is short or conversational (e.g. "hello", "lol", "what's up", "hey"):
        -  → create a title that reflects the user's tone or intent (such as Greeting, Quick check-in, Light chat, Intro message, etc.)
        -</rules>
        +When the user directly asks about opencode (eg 'can opencode do...', 'does opencode have...') or asks in second person (eg 'are you able...', 'can you do...'), first use the WebFetch tool to gather information to answer the question from opencode docs at https://opencode.ai
         
        -<examples>
        -"debug 500 errors in production" → Debugging production 500 errors
        -"refactor user service" → Refactoring user service
        -"why is app.js failing" → app.js failure investigation
        -"implement rate limiting" → Rate limiting implementation
        -"how do I connect postgres to my API" → Postgres API connection
        -"best practices for React hooks" → React hooks best practices
        -"@src/auth.ts can you add refresh token support" → Auth refresh token support
        -"@utils/parser.ts this is broken" → Parser bug fix
        -"look at @config.json" → Config review
        -"@App.tsx add dark mode toggle" → Dark mode toggle in App
        -</examples>
        +# Tone and style
        +You should be concise, direct, and to the point. When you run a non-trivial bash command, you should explain what the command does and why you are running it, to make sure the user understands what you are doing (this is especially important when you are running a command that will make changes to the user's system).
        +Remember that your output will be displayed on a command line interface. Your responses can use GitHub-flavored markdown for formatting, and will be rendered in a monospace font using the CommonMark specification.
        +Output text to communicate with the user; all text you output outside of tool use is displayed to the user. Only use tools to complete tasks. Never use tools like Bash or code comments as means to communicate with the user during the session.
        +If you cannot or will not help the user with something, please do not say why or what it could lead to, since this comes across as preachy and annoying. Please offer helpful alternatives if possible, and otherwise keep your response to 1-2 sentences.
        +Only use emojis if the user explicitly requests it. Avoid using emojis in all communication unless asked.
        +IMPORTANT: You should minimize output tokens as much as possible while maintaining helpfulness, quality, and accuracy. Only address the specific query or task at hand, avoiding tangential information unless absolutely critical for completing the request. If you can answer in 1-3 sentences or a short paragraph, please do.
        +IMPORTANT: You should NOT answer with unnecessary preamble or postamble (such as explaining your code or summarizing your action), unless the user asks you to.
        +IMPORTANT: Keep your responses short, since they will be displayed on a command line interface. You MUST answer concisely with fewer than 4 lines (not including tool use or code generation), unless user asks for detail. Answer the user's question directly, without elaboration, explanation, or details. One word answers are best. Avoid introductions, conclusions, and explanations. You MUST avoid text before/after your response, such as "The answer is <answer>.", "Here is the content of the file..." or "Based on the information provided, the answer is..." or "Here is what I will do next...". Here are some examples to demonstrate appropriate verbosity:
        +<example>
        +user: 2 + 2
        +assistant: 4
        +</example>
         
        +<example>
        +user: what is 2+2?
        +assistant: 4
        +</example>
         
        +<example>
        +user: is 11 a prime number?
        +assistant: Yes
        +</example>
        +
        +<example>
        +user: what command should I run to list files in the current directory?
        +assistant: ls
        +</example>
        +
        +<example>
        +user: what command should I run to watch files in the current directory?
        +assistant: [use the ls tool to list the files in the current directory, then read docs/commands in the relevant file to find out how to watch files]
        +npm run dev
        +</example>
        +
        +<example>
        +user: How many golf balls fit inside a jetta?
        +assistant: 150000
        +</example>
        +
        +<example>
        +user: what files are in the directory src/?
        +assistant: [runs ls and sees foo.c, bar.c, baz.c]
        +user: which file contains the implementation of foo?
        +assistant: src/foo.c
        +</example>
        +
        +<example>
        +user: write tests for new feature
        … diff truncated …
        \`\`\`"
      `)
      expect(timeline).toContain('_Buttons dismissed._')
      expect(timeline).toContain('post-dismiss-user-message')
    },
    20_000,
  )
})
