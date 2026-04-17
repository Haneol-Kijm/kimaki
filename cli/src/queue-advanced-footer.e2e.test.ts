// E2e tests for footer emission in advanced queue scenarios.
// Split from thread-queue-advanced.e2e.test.ts for parallelization.

import { describe, test, expect } from 'vitest'
import {
  setupQueueAdvancedSuite,
  TEST_USER_ID,
} from './queue-advanced-e2e-setup.js'
import {
  waitForFooterMessage,
  waitForBotMessageContaining,
  waitForBotReplyAfterUserMessage,
} from './test-utils.js'

const TEXT_CHANNEL_ID = '200000000000001001'

const e2eTest = describe

e2eTest('queue advanced: footer emission', () => {
  const ctx = setupQueueAdvancedSuite({
    channelId: TEXT_CHANNEL_ID,
    channelName: 'qa-footer-e2e',
    dirName: 'qa-footer-e2e',
    username: 'queue-advanced-tester',
  })

  test(
    'normal completion emits footer after bot reply',
    async () => {
      await ctx.discord.channel(TEXT_CHANNEL_ID).user(TEST_USER_ID).sendMessage({
        content: 'Reply with exactly: footer-check',
      })

      const thread = await ctx.discord.channel(TEXT_CHANNEL_ID).waitForThread({
        timeout: 4_000,
        predicate: (t) => {
          return t.name === 'Reply with exactly: footer-check'
        },
      })

      const th = ctx.discord.thread(thread.id)
      await th.waitForBotReply({ timeout: 4_000 })

      const footerMessages = await waitForFooterMessage({
        discord: ctx.discord,
        threadId: thread.id,
        timeout: 4_000,
      })
      expect(await th.text()).toMatchInlineSnapshot(`
        "--- from: user (queue-advanced-tester)
        Reply with exactly: footer-check
        --- from: assistant (TestBot)
        ⬥ ok
        *project ⋅ main ⋅ Ns ⋅ N% ⋅ deterministic-v2*"
      `)
      const foundFooter = footerMessages.some((m) => {
        return m.author.id === ctx.discord.botUserId
          && m.content.startsWith('*')
          && m.content.includes('⋅')
      })
      expect(foundFooter).toBe(true)
    },
    8_000,
  )

  test(
    'footer appears after second message in same session',
    async () => {
      await ctx.discord.channel(TEXT_CHANNEL_ID).user(TEST_USER_ID).sendMessage({
        content: 'Reply with exactly: footer-multi-setup',
      })

      const thread = await ctx.discord.channel(TEXT_CHANNEL_ID).waitForThread({
        timeout: 4_000,
        predicate: (t) => {
          return t.name === 'Reply with exactly: footer-multi-setup'
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
        content: 'Reply with exactly: footer-multi-second',
      })

      await waitForBotReplyAfterUserMessage({
        discord: ctx.discord,
        threadId: thread.id,
        userId: TEST_USER_ID,
        userMessageIncludes: 'footer-multi-second',
        timeout: 4_000,
      })

      await waitForFooterMessage({
        discord: ctx.discord,
        threadId: thread.id,
        timeout: 4_000,
        afterMessageIncludes: 'footer-multi-second',
        afterAuthorId: TEST_USER_ID,
      })

      const msgs = await th.getMessages()
      const footerCount = msgs.filter((m) => {
        return m.author.id === ctx.discord.botUserId
          && m.content.startsWith('*')
          && m.content.includes('⋅')
      }).length
      expect(await th.text()).toMatchInlineSnapshot(`
        "--- from: user (queue-advanced-tester)
        Reply with exactly: footer-multi-setup
        --- from: assistant (TestBot)
        ⬥ ok
        *project ⋅ main ⋅ Ns ⋅ N% ⋅ deterministic-v2*
        --- from: user (queue-advanced-tester)
        Reply with exactly: footer-multi-second
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
        \`\`\`
        ⬥ ok
        *project ⋅ main ⋅ Ns ⋅ N% ⋅ deterministic-v2*"
      `)
      if (footerCount >= 2) {
        expect(footerCount).toBeGreaterThanOrEqual(2)
        return
      }

      const pollDeadline = Date.now() + 4_000
      let found = false
      while (Date.now() < pollDeadline) {
        await new Promise((resolve) => {
          setTimeout(resolve, 100)
        })
        const latestMsgs = await th.getMessages()
        const count = latestMsgs.filter((m) => {
          return m.author.id === ctx.discord.botUserId
            && m.content.startsWith('*')
            && m.content.includes('⋅')
        }).length
        if (count >= 2) {
          found = true
          break
        }
      }
      expect(found).toBe(true)
    },
    12_000,
  )

  test(
    'interrupted run has no footer, completed follow-up has footer',
    async () => {
      await ctx.discord.channel(TEXT_CHANNEL_ID).user(TEST_USER_ID).sendMessage({
        content: 'Reply with exactly: interrupt-footer-setup',
      })

      const thread = await ctx.discord.channel(TEXT_CHANNEL_ID).waitForThread({
        timeout: 4_000,
        predicate: (t) => {
          return t.name === 'Reply with exactly: interrupt-footer-setup'
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

      const beforeInterruptMsgs = await th.getMessages()
      const baselineCount = beforeInterruptMsgs.length

      await th.user(TEST_USER_ID).sendMessage({
        content: 'PLUGIN_TIMEOUT_SLEEP_MARKER',
      })

      await waitForBotMessageContaining({
        discord: ctx.discord,
        threadId: thread.id,
        userId: TEST_USER_ID,
        text: 'starting sleep 100',
        afterUserMessageIncludes: 'PLUGIN_TIMEOUT_SLEEP_MARKER',
        timeout: 4_000,
      })

      await th.user(TEST_USER_ID).sendMessage({
        content: 'Reply with exactly: interrupt-footer-followup',
      })

      const messages = await waitForBotMessageContaining({
        discord: ctx.discord,
        threadId: thread.id,
        userId: TEST_USER_ID,
        text: 'ok',
        afterUserMessageIncludes: 'interrupt-footer-followup',
        timeout: 12_000,
      })

      const followupUserIdx = messages.findIndex((m, idx) => {
        return idx >= baselineCount
          && m.author.id === TEST_USER_ID
          && m.content.includes('interrupt-footer-followup')
      })
      const okReplyIdx = messages.findIndex((m, idx) => {
        if (idx <= followupUserIdx) {
          return false
        }
        return m.author.id === ctx.discord.botUserId && m.content.includes('ok')
      })

      await waitForFooterMessage({
        discord: ctx.discord,
        threadId: thread.id,
        timeout: 12_000,
        afterMessageIncludes: 'interrupt-footer-followup',
        afterAuthorId: TEST_USER_ID,
      })

      expect(await th.text()).toMatchInlineSnapshot(`
        "--- from: user (queue-advanced-tester)
        Reply with exactly: interrupt-footer-setup
        --- from: assistant (TestBot)
        ⬥ ok
        *project ⋅ main ⋅ Ns ⋅ N% ⋅ deterministic-v2*
        --- from: user (queue-advanced-tester)
        PLUGIN_TIMEOUT_SLEEP_MARKER
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
        \`\`\`
        ⬥ starting sleep 100
        --- from: user (queue-advanced-tester)
        Reply with exactly: interrupt-footer-followup
        --- from: assistant (TestBot)
        ⬥ ok
        *project ⋅ main ⋅ Ns ⋅ N% ⋅ deterministic-v2*"
      `)
      expect(followupUserIdx).toBeGreaterThanOrEqual(0)
      expect(okReplyIdx).toBeGreaterThan(followupUserIdx)

      const footerBetween = messages.some((m, idx) => {
        if (idx < baselineCount || idx >= okReplyIdx) {
          return false
        }
        return m.author.id === ctx.discord.botUserId
          && m.content.startsWith('*')
          && m.content.includes('⋅')
      })
      expect(footerBetween).toBe(false)
    },
    15_000,
  )

  test(
    'plugin timeout interrupt aborts slow sleep and avoids intermediate footer',
    async () => {
      await ctx.discord.channel(TEXT_CHANNEL_ID).user(TEST_USER_ID).sendMessage({
        content: 'Reply with exactly: plugin-timeout-setup',
      })

      const thread = await ctx.discord.channel(TEXT_CHANNEL_ID).waitForThread({
        timeout: 4_000,
        predicate: (t) => {
          return t.name === 'Reply with exactly: plugin-timeout-setup'
        },
      })

      const th = ctx.discord.thread(thread.id)
      await th.waitForBotReply({ timeout: 4_000 })
      await waitForBotMessageContaining({
        discord: ctx.discord,
        threadId: thread.id,
        userId: TEST_USER_ID,
        text: '*project',
        timeout: 4_000,
      })

      await th.user(TEST_USER_ID).sendMessage({
        content: 'PLUGIN_TIMEOUT_SLEEP_MARKER',
      })

      await waitForBotMessageContaining({
        discord: ctx.discord,
        threadId: thread.id,
        userId: TEST_USER_ID,
        text: 'starting sleep 100',
        afterUserMessageIncludes: 'PLUGIN_TIMEOUT_SLEEP_MARKER',
        timeout: 4_000,
      })

      await th.user(TEST_USER_ID).sendMessage({
        content: 'Reply with exactly: plugin-timeout-after',
      })

      const messages = await waitForBotMessageContaining({
        discord: ctx.discord,
        threadId: thread.id,
        userId: TEST_USER_ID,
        text: 'ok',
        afterUserMessageIncludes: 'plugin-timeout-after',
        timeout: 12_000,
      })

      const messagesWithFooter = await waitForFooterMessage({
        discord: ctx.discord,
        threadId: thread.id,
        timeout: 12_000,
        afterMessageIncludes: 'plugin-timeout-after',
        afterAuthorId: TEST_USER_ID,
      })

      const afterIndex = messagesWithFooter.findIndex((message) => {
        return (
          message.author.id === TEST_USER_ID
          && message.content.includes('plugin-timeout-after')
        )
      })
      expect(await th.text()).toMatchInlineSnapshot(`
        "--- from: user (queue-advanced-tester)
        Reply with exactly: plugin-timeout-setup
        --- from: assistant (TestBot)
        ⬥ ok
        *project ⋅ main ⋅ Ns ⋅ N% ⋅ deterministic-v2*
        --- from: user (queue-advanced-tester)
        PLUGIN_TIMEOUT_SLEEP_MARKER
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
        \`\`\`
        ⬥ starting sleep 100
        --- from: user (queue-advanced-tester)
        Reply with exactly: plugin-timeout-after
        --- from: assistant (TestBot)
        ⬥ ok
        *project ⋅ main ⋅ Ns ⋅ N% ⋅ deterministic-v2*"
      `)
      expect(afterIndex).toBeGreaterThanOrEqual(0)

      const okReplyIndex = messagesWithFooter.findIndex((message, index) => {
        if (index <= afterIndex) {
          return false
        }
        return message.author.id === ctx.discord.botUserId && message.content.includes('ok')
      })
      expect(okReplyIndex).toBeGreaterThan(afterIndex)

      const footerBeforeReply = messagesWithFooter.some((message, index) => {
        if (index <= afterIndex || index >= okReplyIndex) {
          return false
        }
        if (message.author.id !== ctx.discord.botUserId) {
          return false
        }
        return message.content.startsWith('*') && message.content.includes('⋅')
      })
      expect(footerBeforeReply).toBe(false)
    },
    15_000,
  )

  test(
    'tool-call assistant message gets footer when it completes normally',
    async () => {
      // Reproduces the bug: model responds with text + tool call,
      // finish="tool-calls", message gets completed timestamp. Then the tool
      // result triggers a follow-up text response in a second assistant message.
      // The second message gets a footer, but the first (tool-call) message
      // should ALSO get a footer since it completed normally.
      // This matches the real-world scenario where an agent calls a bash tool
      // (e.g. `kimaki send`) and then follows up with a summary text.
      const existingThreadIds = new Set(
        (await ctx.discord.channel(TEXT_CHANNEL_ID).getThreads()).map((thread) => {
          return thread.id
        }),
      )
      await ctx.discord.channel(TEXT_CHANNEL_ID).user(TEST_USER_ID).sendMessage({
        content: 'TOOL_CALL_FOOTER_MARKER',
      })

      const thread = await ctx.discord.channel(TEXT_CHANNEL_ID).waitForThread({
        timeout: 6_000,
        predicate: (t) => {
          return !existingThreadIds.has(t.id)
        },
      })

      const th = ctx.discord.thread(thread.id)

      // Wait for the follow-up text response after tool completion.
      // The tool call completes and the model follows up with a second
      // assistant message containing text.
      await waitForBotReplyAfterUserMessage({
        discord: ctx.discord,
        threadId: thread.id,
        userId: TEST_USER_ID,
        userMessageIncludes: 'TOOL_CALL_FOOTER_MARKER',
        timeout: 6_000,
      })

      // Wait for at least one footer to appear
      await waitForFooterMessage({
        discord: ctx.discord,
        threadId: thread.id,
        timeout: 4_000,
      })

      // Poll until both footers have arrived — the first footer (after the
      // tool-call step) and the second (after the text follow-up) are emitted
      // by sequential handleNaturalAssistantCompletion calls but the second
      // may not have hit the Discord thread by the time we first check.
      const deadline = Date.now() + 4_000
      let footerCount = 0
      while (Date.now() < deadline) {
        const msgs = await th.getMessages()
        footerCount = msgs.filter((m) => {
          return m.author.id === ctx.discord.botUserId
            && m.content.startsWith('*')
            && m.content.includes('⋅')
        }).length
        if (footerCount >= 2) {
          break
        }
        await new Promise((resolve) => {
          setTimeout(resolve, 100)
        })
      }

      expect(await th.text()).toMatchInlineSnapshot(`
        "--- from: user (queue-advanced-tester)
        TOOL_CALL_FOOTER_MARKER
        --- from: assistant (TestBot)
        ⬥ running tool
        ⬥ ok
        *project ⋅ main ⋅ Ns ⋅ N% ⋅ deterministic-v2*"
      `)

      // Only ONE footer at the end — the tool-call step's footer is NOT
      // emitted mid-turn. The final text follow-up gets the footer.
      expect(footerCount).toBe(1)
    },
    10_000,
  )

  test(
    'multi-step tool chain should only have one footer at the end',
    async () => {
      // Model does 3 sequential tool calls (each a separate assistant message
      // with finish="tool-calls") then a final text response. Only the final
      // text response should get a footer — intermediate tool-call steps
      // should NOT get footers since they're mid-turn work.
      const existingThreadIds = new Set(
        (await ctx.discord.channel(TEXT_CHANNEL_ID).getThreads()).map((thread) => {
          return thread.id
        }),
      )
      await ctx.discord.channel(TEXT_CHANNEL_ID).user(TEST_USER_ID).sendMessage({
        content: 'MULTI_TOOL_FOOTER_MARKER',
      })

      const thread = await ctx.discord.channel(TEXT_CHANNEL_ID).waitForThread({
        timeout: 6_000,
        predicate: (t) => {
          return !existingThreadIds.has(t.id)
        },
      })

      const th = ctx.discord.thread(thread.id)

      // Wait for the final text response after all 3 tool steps
      await waitForBotMessageContaining({
        discord: ctx.discord,
        threadId: thread.id,
        userId: TEST_USER_ID,
        text: 'all done, fixed 3 files',
        timeout: 6_000,
      })

      // Wait for the footer after the final response
      await waitForFooterMessage({
        discord: ctx.discord,
        threadId: thread.id,
        timeout: 6_000,
      })

      // Give any spurious extra footers time to arrive
      await new Promise((resolve) => {
        setTimeout(resolve, 500)
      })

      const messages = await th.getMessages()
      const footerCount = messages.filter((m) => {
        return m.author.id === ctx.discord.botUserId
          && m.content.startsWith('*')
          && m.content.includes('⋅')
      }).length

      expect(await th.text()).toMatchInlineSnapshot(`
        "--- from: user (queue-advanced-tester)
        MULTI_TOOL_FOOTER_MARKER
        --- from: assistant (TestBot)
        ⬥ investigating the issue
        ⬥ all done, fixed 3 files
        *project ⋅ main ⋅ Ns ⋅ N% ⋅ deterministic-v2*"
      `)

      // Only ONE footer should appear — after the final text response.
      // Intermediate tool-call steps should NOT get footers.
      expect(footerCount).toBe(1)
    },
    10_000,
  )

  test(
    '3 sequential tool-call steps produce exactly 1 footer, not 3',
    async () => {
      // This is the most obvious reproduction of the multi-footer bug:
      // the model runs 3 sequential tool-call steps (each a SEPARATE
      // assistant message with finish="tool-calls"), then a final text.
      // With a naive fix that treats tool-calls as natural completions,
      // you'd see 4 footers (one per assistant message). Only the final
      // text response should produce a footer.
      const existingThreadIds = new Set(
        (await ctx.discord.channel(TEXT_CHANNEL_ID).getThreads()).map((thread) => {
          return thread.id
        }),
      )
      await ctx.discord.channel(TEXT_CHANNEL_ID).user(TEST_USER_ID).sendMessage({
        content: 'MULTI_STEP_CHAIN_MARKER',
      })

      const thread = await ctx.discord.channel(TEXT_CHANNEL_ID).waitForThread({
        timeout: 6_000,
        predicate: (t) => {
          return !existingThreadIds.has(t.id)
        },
      })

      const th = ctx.discord.thread(thread.id)

      // Wait for the final text after all 3 sequential tool steps
      await waitForBotMessageContaining({
        discord: ctx.discord,
        threadId: thread.id,
        userId: TEST_USER_ID,
        text: 'chain complete: all 3 steps done',
        timeout: 10_000,
      })

      // Wait for footer
      await waitForFooterMessage({
        discord: ctx.discord,
        threadId: thread.id,
        timeout: 6_000,
      })

      // Give any spurious extra footers time to arrive
      await new Promise((resolve) => {
        setTimeout(resolve, 500)
      })

      const messages = await th.getMessages()
      const footerCount = messages.filter((m) => {
        return m.author.id === ctx.discord.botUserId
          && m.content.startsWith('*')
          && m.content.includes('⋅')
      }).length

      expect(await th.text()).toMatchInlineSnapshot(`
        "--- from: user (queue-advanced-tester)
        MULTI_STEP_CHAIN_MARKER
        --- from: assistant (TestBot)
        ⬥ chain step 1: reading config
        ⬥ chain step 2: analyzing results
        ⬥ chain step 3: applying fix
        ⬥ chain complete: all 3 steps done
        *project ⋅ main ⋅ Ns ⋅ N% ⋅ deterministic-v2*"
      `)

      // The critical assertion: only 1 footer at the very end.
      // With the naive "allow tool-calls as natural completion" fix,
      // this would be 4 (one per assistant message). We want 1.
      expect(footerCount).toBe(1)
    },
    15_000,
  )
})
