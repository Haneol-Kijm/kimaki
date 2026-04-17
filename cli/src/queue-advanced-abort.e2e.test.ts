// E2e tests for abort, model-switch, and retry scenarios.
// Split from thread-queue-advanced.e2e.test.ts for parallelization.

import { describe, test, expect } from 'vitest'
import {
  setupQueueAdvancedSuite,
  TEST_USER_ID,
} from './queue-advanced-e2e-setup.js'
import {
  getRuntime,
} from './session-handler/thread-session-runtime.js'
import { getThreadState } from './session-handler/thread-runtime-state.js'
import { setSessionModel } from './database.js'
import {
  waitForFooterMessage,
  waitForBotMessageContaining,
  waitForBotReplyAfterUserMessage,
} from './test-utils.js'

const TEXT_CHANNEL_ID = '200000000000001003'

const e2eTest = describe

e2eTest('queue advanced: abort and retry', () => {
  const ctx = setupQueueAdvancedSuite({
    channelId: TEXT_CHANNEL_ID,
    channelName: 'qa-abort-e2e',
    dirName: 'qa-abort-e2e',
    username: 'queue-advanced-tester',
  })

  test(
    'slow tool call (sleep) gets aborted by explicit abort, then queue continues',
    async () => {
      await ctx.discord.channel(TEXT_CHANNEL_ID).user(TEST_USER_ID).sendMessage({
        content: 'Reply with exactly: oscar',
      })

      const thread = await ctx.discord.channel(TEXT_CHANNEL_ID).waitForThread({
        timeout: 4_000,
        predicate: (t) => {
          return t.name === 'Reply with exactly: oscar'
        },
      })

      const th = ctx.discord.thread(thread.id)
      const firstReply = await th.waitForBotReply({ timeout: 4_000 })
      expect(firstReply.content.trim().length).toBeGreaterThan(0)

      // Wait for the first completion footer so it lands in a deterministic position
      await waitForFooterMessage({
        discord: ctx.discord,
        threadId: thread.id,
        timeout: 4_000,
      })

      const before = await th.getMessages()
      const beforeBotCount = before.filter((m) => {
        return m.author.id === ctx.discord.botUserId
      }).length

      await th.user(TEST_USER_ID).sendMessage({
        content: 'PLUGIN_TIMEOUT_SLEEP_MARKER',
      })

      // The matcher emits "starting sleep 100" text before the long delay.
      // Wait for it to land in Discord BEFORE aborting so the message is in a
      // deterministic position and the abort produces no further stray messages.
      await waitForBotMessageContaining({
        discord: ctx.discord,
        threadId: thread.id,
        userId: TEST_USER_ID,
        text: 'starting sleep',
        afterUserMessageIncludes: 'PLUGIN_TIMEOUT_SLEEP_MARKER',
        timeout: 4_000,
      })

      const runtime = getRuntime(thread.id)
      expect(runtime).toBeDefined()
      if (!runtime) {
        throw new Error('Expected runtime to exist for explicit-abort test')
      }

      runtime.abortActiveRun('test-explicit-abort')

      await th.user(TEST_USER_ID).sendMessage({
        content: 'Reply with exactly: papa',
      })

      const after = await waitForBotReplyAfterUserMessage({
        discord: ctx.discord,
        threadId: thread.id,
        userId: TEST_USER_ID,
        userMessageIncludes: 'papa',
        timeout: 8_000,
      })

      const afterBotMessages = after.filter((m) => {
        return m.author.id === ctx.discord.botUserId
      })

      await waitForFooterMessage({
        discord: ctx.discord,
        threadId: thread.id,
        timeout: 8_000,
        afterMessageIncludes: 'papa',
        afterAuthorId: TEST_USER_ID,
      })

      // Assert ordering invariants instead of exact snapshot — the papa reply
      // and footer can interleave non-deterministically.
      const timeline = await th.text()
      expect(timeline).toContain('Reply with exactly: oscar')
      expect(timeline).toContain('PLUGIN_TIMEOUT_SLEEP_MARKER')
      expect(timeline).toContain('⬥ starting sleep 100')
      expect(timeline).toContain('Reply with exactly: papa')
      expect(timeline).toContain('*project ⋅ main ⋅')
      // oscar comes before the sleep marker, sleep before papa
      const oscarIdx = timeline.indexOf('oscar')
      const sleepIdx = timeline.indexOf('PLUGIN_TIMEOUT_SLEEP_MARKER')
      const papaIdx = timeline.indexOf('papa')
      expect(oscarIdx).toBeLessThan(sleepIdx)
      expect(sleepIdx).toBeLessThan(papaIdx)
      expect(afterBotMessages.length).toBeGreaterThanOrEqual(beforeBotCount + 1)

      const sleepToolIndex = after.findIndex((m) => {
        return (
          m.author.id === TEST_USER_ID &&
          m.content.includes('PLUGIN_TIMEOUT_SLEEP_MARKER')
        )
      })
      expect(sleepToolIndex).toBeGreaterThan(-1)

      const userPapaIndex = after.findIndex((m) => {
        return m.author.id === TEST_USER_ID && m.content.includes('papa')
      })
      expect(userPapaIndex).toBeGreaterThan(-1)
      expect(sleepToolIndex).toBeLessThan(userPapaIndex)
      const lastBotIndex = after.findLastIndex((m) => {
        return m.author.id === ctx.discord.botUserId
      })
      expect(userPapaIndex).toBeLessThan(lastBotIndex)
    },
    12_000,
  )

  test(
    'explicit abort emits MessageAbortedError and does not emit footer',
    async () => {
      await ctx.discord.channel(TEXT_CHANNEL_ID).user(TEST_USER_ID).sendMessage({
        content: 'Reply with exactly: abort-no-footer-setup',
      })

      const thread = await ctx.discord.channel(TEXT_CHANNEL_ID).waitForThread({
        timeout: 4_000,
        predicate: (t) => {
          return t.name === 'Reply with exactly: abort-no-footer-setup'
        },
      })

      const th = ctx.discord.thread(thread.id)
      await th.waitForBotReply({ timeout: 4_000 })

      await waitForBotMessageContaining({
        discord: ctx.discord,
        threadId: thread.id,
        userId: TEST_USER_ID,
        text: '⋅',
        timeout: 4_000,
      })

      await th.user(TEST_USER_ID).sendMessage({
        content: 'SLOW_ABORT_MARKER run long response',
      })

      const runtime = getRuntime(thread.id)
      expect(runtime).toBeDefined()
      if (!runtime) {
        throw new Error('Expected runtime to exist for abort no-footer test')
      }

      const beforeAbortMessages = await th.getMessages()
      const baselineCount = beforeAbortMessages.length

      runtime.abortActiveRun('test-no-footer-on-abort')

      for (let i = 0; i < 10; i++) {
        await new Promise((resolve) => {
          setTimeout(resolve, 20)
        })
        const msgs = await th.getMessages()
        const newMsgs = msgs.slice(baselineCount)
        const hasFooter = newMsgs.some((m) => {
          return m.author.id === ctx.discord.botUserId
            && m.content.startsWith('*')
            && m.content.includes('⋅')
        })
        expect(hasFooter).toBe(false)
      }

      expect(await th.text()).toMatchInlineSnapshot(`
        "--- from: user (queue-advanced-tester)
        Reply with exactly: abort-no-footer-setup
        --- from: assistant (TestBot)
        ⬥ ok
        *project ⋅ main ⋅ Ns ⋅ N% ⋅ deterministic-v2*
        --- from: user (queue-advanced-tester)
        SLOW_ABORT_MARKER run long response
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
    },
    10_000,
  )

  test.skip(
    'explicit abort stale-idle window: follow-up prompt still gets assistant text',
    async () => {
      const setupPrompt = 'Reply with exactly: race-setup-1'
      const raceFinalPrompt = 'Reply with exactly: race-final-1'

      await ctx.discord.channel(TEXT_CHANNEL_ID).user(TEST_USER_ID).sendMessage({
        content: setupPrompt,
      })

      const thread = await ctx.discord.channel(TEXT_CHANNEL_ID).waitForThread({
        timeout: 4_000,
        predicate: (t) => {
          return t.name === setupPrompt
        },
      })

      const th = ctx.discord.thread(thread.id)
      const setupReply = await th.waitForBotReply({ timeout: 4_000 })
      expect(setupReply.content.trim().length).toBeGreaterThan(0)

      await th.user(TEST_USER_ID).sendMessage({
        content: 'SLOW_ABORT_MARKER run long response',
      })

      const runtime = getRuntime(thread.id)
      expect(runtime).toBeDefined()
      if (!runtime) {
        throw new Error('Expected runtime to exist for race abort scenario')
      }

      runtime.abortActiveRun('test-race-abort')

      await th.user(TEST_USER_ID).sendMessage({
        content: raceFinalPrompt,
      })

      await waitForBotReplyAfterUserMessage({
        discord: ctx.discord,
        threadId: thread.id,
        userId: TEST_USER_ID,
        userMessageIncludes: raceFinalPrompt,
        timeout: 4_000,
      })
    },
    8_000,
  )

  test(
    'model switch mid-session aborts and restarts from same session history',
    async () => {
      await ctx.discord.channel(TEXT_CHANNEL_ID).user(TEST_USER_ID).sendMessage({
        content: 'Reply with exactly: retry-setup',
      })

      const thread = await ctx.discord.channel(TEXT_CHANNEL_ID).waitForThread({
        timeout: 4_000,
        predicate: (t) => {
          return t.name === 'Reply with exactly: retry-setup'
        },
      })

      const th = ctx.discord.thread(thread.id)
      const firstReply = await th.waitForBotReply({ timeout: 4_000 })
      expect(firstReply.content.trim().length).toBeGreaterThan(0)

      await th.user(TEST_USER_ID).sendMessage({
        content: 'PLUGIN_TIMEOUT_SLEEP_MARKER',
      })

      await waitForBotMessageContaining({
        discord: ctx.discord,
        threadId: thread.id,
        userId: TEST_USER_ID,
        text: 'starting sleep',
        afterUserMessageIncludes: 'PLUGIN_TIMEOUT_SLEEP_MARKER',
        timeout: 4_000,
      })

      const sessionId = getThreadState(thread.id)?.sessionId
      expect(sessionId).toBeDefined()
      if (!sessionId) {
        throw new Error('Expected active session id for model switch test')
      }

      await setSessionModel({
        sessionId,
        modelId: 'deterministic-provider/deterministic-v3',
        variant: null,
      })

      const runtime = getRuntime(thread.id)
      expect(runtime).toBeDefined()
      if (!runtime) {
        throw new Error('Expected runtime to exist for model switch test')
      }
      const retried = await runtime.retryLastUserPrompt()
      expect(retried).toBe(true)

      await th.user(TEST_USER_ID).sendMessage({
        content: 'Reply with exactly: model-switch-followup',
      })

      await waitForBotReplyAfterUserMessage({
        discord: ctx.discord,
        threadId: thread.id,
        userId: TEST_USER_ID,
        userMessageIncludes: 'model-switch-followup',
        timeout: 4_000,
      })

      // Wait for potential footer to arrive (race between step-finish interrupt
      // and model switch settling means footer may or may not appear).
      await new Promise((resolve) => {
        setTimeout(resolve, 200)
      })

      const text = await th.text()
      // The follow-up reply ("ok") must be present with deterministic-v3
      expect(text).toContain('Reply with exactly: model-switch-followup')
      expect(text).toContain('⬥ ok')
      // The old sleep text should be visible from the first turn
      expect(text).toContain('starting sleep 100')
    },
    10_000,
  )

  test(
    'abortActiveRun settles correctly during long-running request',
    async () => {
      await ctx.discord.channel(TEXT_CHANNEL_ID).user(TEST_USER_ID).sendMessage({
        content: 'Reply with exactly: force-abort-setup',
      })

      const thread = await ctx.discord.channel(TEXT_CHANNEL_ID).waitForThread({
        timeout: 4_000,
        predicate: (t) => {
          return t.name === 'Reply with exactly: force-abort-setup'
        },
      })

      const th = ctx.discord.thread(thread.id)
      const setupReply = await th.waitForBotReply({ timeout: 4_000 })
      expect(setupReply.content.trim().length).toBeGreaterThan(0)

      await th.user(TEST_USER_ID).sendMessage({
        content: 'SLOW_ABORT_MARKER run long response',
      })

      const runtime = getRuntime(thread.id)
      expect(runtime).toBeDefined()
      if (!runtime) {
        throw new Error('Expected runtime to exist for forced-abort test')
      }

      runtime.abortActiveRun('force-abort-test')

      expect(await th.text()).toMatchInlineSnapshot(`
        "--- from: user (queue-advanced-tester)
        Reply with exactly: force-abort-setup
        --- from: assistant (TestBot)
        ⬥ ok
        --- from: user (queue-advanced-tester)
        SLOW_ABORT_MARKER run long response"
      `)
    },
    10_000,
  )
})
