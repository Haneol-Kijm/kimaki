import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ChannelType, type ThreadChannel } from 'discord.js'
import * as errore from 'errore'
import * as threadState from './thread-runtime-state.js'
import type { QueuedMessage } from './thread-runtime-state.js'
import type {
  EnqueueResult,
  IngressInput,
  RuntimeOptions,
  SessionRuntime,
} from './thread-session-runtime.js'
import type { DiscordFileAttachment } from '../message-formatting.js'
import { sendThreadMessage, NOTIFY_MESSAGE_FLAGS } from '../discord-utils.js'
import {
  getThreadSession,
  setSessionStartSource,
  setThreadSession,
} from '../database.js'
import { createLogger, LogPrefix } from '../logger.js'
import {
  CODEX_DEFAULT_MODEL_ID,
  getCurrentCodexModelInfo,
  toCodexCliModel,
} from '../codex/codex-models.js'
import {
  showCodexRetryButtons,
  type CodexSandboxMode,
} from '../codex/retry-controls.js'
import { buildCodexPrompt } from '../codex/codex-prompt.js'

const logger = createLogger(LogPrefix.SESSION)

const SANDBOX_DENIAL_RE =
  /operation not permitted|permission denied|sandbox.*(?:block|denied|restrict)|read.only.*file.?system|write access to.*not allowed/i

type CodexJsonEvent = {
  type?: string
  thread_id?: string
  message?: string
  item?: {
    type?: string
    text?: string
    command?: string
    aggregated_output?: string
    exit_code?: number
  }
  error?: {
    message?: string
  }
}

type CompletedCommand = {
  command: string
  output: string
  exitCode: number
}

type CodexTurnResult = {
  runId: number
  sessionId?: string
  assistantTexts: string[]
  commands: CompletedCommand[]
  errorMessage?: string
  sandboxDeniedContext?: string
  wasAborted: boolean
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text
  }
  return `${text.slice(0, maxChars - 1)}…`
}

function parseDataUrl(url: string): { mime: string; base64: string } | Error {
  const match = url.match(/^data:([^;]+);base64,(.+)$/)
  if (!match?.[1] || !match[2]) {
    return new Error('Unsupported data URL attachment format')
  }
  return {
    mime: match[1],
    base64: match[2],
  }
}

function mimeExtension(mimeType: string): string {
  switch (mimeType) {
    case 'image/png':
      return '.png'
    case 'image/jpeg':
      return '.jpg'
    case 'image/webp':
      return '.webp'
    case 'image/gif':
      return '.gif'
    default:
      return '.bin'
  }
}

async function saveCodexImagesToTemp(
  images: DiscordFileAttachment[],
): Promise<string[]> {
  const imageAttachments = images.filter((image) => image.mime.startsWith('image/'))
  if (imageAttachments.length === 0) {
    return []
  }

  const tempDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'kimaki-codex-'),
  )

  const savedPaths = await Promise.all(imageAttachments.map(async (image, index) => {
    const parsed = parseDataUrl(image.url)
    if (parsed instanceof Error) {
      throw parsed
    }
    const outputPath = path.join(
      tempDir,
      `attachment-${index}${mimeExtension(parsed.mime)}`,
    )
    await fs.promises.writeFile(outputPath, Buffer.from(parsed.base64, 'base64'))
    return outputPath
  }))

  return savedPaths
}

async function cleanupTempPaths(paths: string[]): Promise<void> {
  if (paths.length === 0) {
    return
  }
  const root = path.dirname(paths[0] || '')
  await Promise.all(paths.map(async (filePath) => {
    await fs.promises.rm(filePath, { force: true }).catch(() => {})
  }))
  if (root) {
    await fs.promises.rm(root, { recursive: true, force: true }).catch(() => {})
  }
}

export class CodexThreadRuntime implements SessionRuntime {
  readonly threadId: string
  readonly projectDirectory: string
  sdkDirectory: string
  readonly channelId: string | undefined
  readonly appId: string | undefined
  readonly thread: ThreadChannel

  private disposed = false
  private activeChild: ChildProcess | null = null
  private activeRunId = 0
  private abortedRunId: number | null = null
  private activeTurnPromise: Promise<void> | null = null
  private lastActivityAt = Date.now()
  private typingKeepaliveTimeout: ReturnType<typeof setTimeout> | null = null
  private preprocessChain: Promise<void> = Promise.resolve()
  private blockedAfterAbort = false
  private currentSandboxMode: CodexSandboxMode = 'workspace-write'
  private lastTurnInput: QueuedMessage | undefined

  constructor(opts: RuntimeOptions) {
    this.threadId = opts.threadId
    this.thread = opts.thread
    this.projectDirectory = opts.projectDirectory
    this.sdkDirectory = opts.sdkDirectory
    this.channelId = opts.channelId
    this.appId = opts.appId
  }

  private get state() {
    return threadState.getThreadState(this.threadId)
  }

  handleDirectoryChanged({
    newDirectory,
  }: {
    oldDirectory: string
    newDirectory: string
  }): void {
    this.sdkDirectory = newDirectory
  }

  handleSharedServerStarted(): void {
    // OpenCode-only concern.
  }

  private async sendTypingPulse(): Promise<void> {
    const result = await errore.tryAsync(() => {
      return this.thread.sendTyping()
    })
    if (result instanceof Error) {
      logger.log(`[CODEX] failed to send typing for ${this.threadId}: ${result.message}`)
    }
  }

  private clearTypingKeepalive(): void {
    if (!this.typingKeepaliveTimeout) {
      return
    }
    clearTimeout(this.typingKeepaliveTimeout)
    this.typingKeepaliveTimeout = null
  }

  private ensureTypingKeepalive(): void {
    this.clearTypingKeepalive()
    void this.sendTypingPulse()
    this.typingKeepaliveTimeout = setTimeout(() => {
      this.ensureTypingKeepalive()
    }, 7000)
  }

  private stopTyping(): void {
    this.clearTypingKeepalive()
  }

  private shouldTreatAsQueued(): boolean {
    const queueLength = this.state?.queueItems.length ?? 0
    return Boolean(this.activeChild) || queueLength > 0 || this.blockedAfterAbort
  }

  private async resolvePreprocessedInput(
    input: IngressInput,
  ): Promise<QueuedMessage | undefined> {
    let resolvedPrompt = input.prompt
    let resolvedImages = input.images

    if (input.preprocess) {
      const preprocessed = await input.preprocess()
      if (preprocessed.skip) {
        return undefined
      }
      resolvedPrompt = preprocessed.prompt
      resolvedImages = preprocessed.images
    }

    return {
      prompt: resolvedPrompt,
      userId: input.userId,
      username: input.username,
      images: resolvedImages,
      appId: input.appId,
      command: input.command,
      agent: input.agent,
      model: input.model,
      sessionStartScheduleKind: input.sessionStartSource?.scheduleKind,
      sessionStartScheduledTaskId: input.sessionStartSource?.scheduledTaskId,
      sandboxMode: input.sandboxMode,
    }
  }

  private async enqueueResolvedInput(
    queuedInput: QueuedMessage,
  ): Promise<EnqueueResult> {
    if (this.disposed) {
      return { queued: false }
    }

    const wasQueued = this.shouldTreatAsQueued()
    if (this.blockedAfterAbort) {
      this.blockedAfterAbort = false
    }

    threadState.enqueueItem(this.threadId, queuedInput)
    const position = this.state?.queueItems.length

    if (!wasQueued) {
      this.startDrainLoop()
      return { queued: false }
    }

    return {
      queued: true,
      position,
    }
  }

  async enqueueIncoming(input: IngressInput): Promise<EnqueueResult> {
    return new Promise((resolve, reject) => {
      const run = async () => {
        try {
          const queuedInput = await this.resolvePreprocessedInput(input)
          if (!queuedInput) {
            resolve({ queued: false })
            return
          }
          resolve(await this.enqueueResolvedInput(queuedInput))
        } catch (error) {
          reject(error)
        }
      }

      const chained = this.preprocessChain.then(run, run)
      this.preprocessChain = chained.then(
        () => {},
        () => {},
      )
    })
  }

  abortActiveRun(reason: string): void {
    logger.log(`[CODEX] abort requested thread=${this.threadId} reason=${reason}`)
    this.blockedAfterAbort = true
    threadState.clearQueueItems(this.threadId)
    this.stopTyping()

    const activeRunId = this.activeRunId
    if (activeRunId > 0) {
      this.abortedRunId = activeRunId
    }

    if (this.activeChild && !this.activeChild.killed) {
      this.activeChild.kill('SIGTERM')
      setTimeout(() => {
        if (this.activeChild && !this.activeChild.killed) {
          this.activeChild.kill('SIGKILL')
        }
      }, 750).unref()
    }
  }

  getQueueLength(): number {
    return this.state?.queueItems.length ?? 0
  }

  clearQueue(): void {
    threadState.clearQueueItems(this.threadId)
  }

  private startDrainLoop(): void {
    if (this.activeTurnPromise || this.disposed || this.blockedAfterAbort) {
      return
    }

    this.activeTurnPromise = (async () => {
      while (!this.disposed && !this.blockedAfterAbort) {
        const next = threadState.dequeueItem(this.threadId)
        if (!next) {
          break
        }
        await this.runTurn(next)
        if (this.blockedAfterAbort) {
          break
        }
        await delay(0)
      }
    })().finally(() => {
      this.activeTurnPromise = null
    })
  }

  private async persistSessionId(sessionId: string): Promise<void> {
    await setThreadSession(this.threadId, sessionId)
    threadState.setSessionId(this.threadId, sessionId)
  }

  private async runTurn(input: QueuedMessage): Promise<void> {
    this.lastActivityAt = Date.now()
    this.lastTurnInput = {
      ...input,
      images: input.images ? [...input.images] : undefined,
    }

    const stateSessionId = this.state?.sessionId
    const persistedSessionId = stateSessionId || await getThreadSession(this.threadId)
    if (persistedSessionId) {
      threadState.setSessionId(this.threadId, persistedSessionId)
    }

    const currentModel = input.model || (await getCurrentCodexModelInfo({
      sessionId: persistedSessionId,
      channelId: this.channelId,
    })).modelId
    const cliModel = toCodexCliModel(currentModel)

    const sandboxMode = input.sandboxMode || this.currentSandboxMode
    this.currentSandboxMode = sandboxMode

    const promptText = input.command
      ? buildCodexPrompt({
        prompt: `Run the queued slash command /${input.command.name}${input.command.arguments ? ` ${input.command.arguments}` : ''}. Follow the request and report the result clearly.`,
        username: input.username,
        isSlashCommand: true,
      })
      : buildCodexPrompt({
        prompt: input.prompt,
        username: input.username,
      })

    this.ensureTypingKeepalive()
    const turnResult = await this.executeCodexTurn({
      promptText,
      sessionId: persistedSessionId,
      model: cliModel,
      sandboxMode,
      images: input.images || [],
    })

    if (turnResult.sessionId) {
      await this.persistSessionId(turnResult.sessionId)
      if (input.sessionStartScheduleKind) {
        await errore.tryAsync(() => {
          return setSessionStartSource({
            sessionId: turnResult.sessionId!,
            scheduleKind: input.sessionStartScheduleKind!,
            scheduledTaskId: input.sessionStartScheduledTaskId,
          })
        })
      }
    }

    this.stopTyping()
    this.lastActivityAt = Date.now()

    if (turnResult.wasAborted) {
      logger.log(`[CODEX] run aborted thread=${this.threadId}`)
      return
    }

    for (const command of turnResult.commands) {
      await sendThreadMessage(this.thread, formatCommandExecution(command))
    }

    for (const assistantText of turnResult.assistantTexts) {
      await sendThreadMessage(this.thread, assistantText)
    }

    if (turnResult.errorMessage) {
      await sendThreadMessage(this.thread, `✗ ${turnResult.errorMessage}`)
      return
    }

    const footerParts = [
      path.basename(this.sdkDirectory),
      'codex',
    ]
    if (currentModel !== CODEX_DEFAULT_MODEL_ID) {
      footerParts.push(currentModel.replace(/^codex\//, ''))
    }
    await sendThreadMessage(
      this.thread,
      `*${footerParts.join(' ⋅ ')}*`,
      { flags: NOTIFY_MESSAGE_FLAGS },
    )

    if (turnResult.sandboxDeniedContext) {
      await showCodexRetryButtons({
        thread: this.thread,
        context: truncate(turnResult.sandboxDeniedContext, 300),
      })
    }
  }

  private async executeCodexTurn({
    promptText,
    sessionId,
    model,
    sandboxMode,
    images,
  }: {
    promptText: string
    sessionId?: string
    model?: string
    sandboxMode: CodexSandboxMode
    images: DiscordFileAttachment[]
  }): Promise<CodexTurnResult> {
    const runId = ++this.activeRunId
    this.abortedRunId = null

    const tempImagePaths = await saveCodexImagesToTemp(images).catch((error) => {
      logger.warn(`[CODEX] failed to prepare images: ${error instanceof Error ? error.message : String(error)}`)
      return []
    })

    const args = sessionId
      ? buildResumeArgs({
        sessionId,
        promptText,
        model,
        sandboxMode,
        imagePaths: tempImagePaths,
      })
      : buildExecArgs({
        promptText,
        model,
        sandboxMode,
        imagePaths: tempImagePaths,
        cwd: this.sdkDirectory,
      })

    logger.log(`[CODEX] spawning codex ${args.join(' ')}`)

    const child = spawn('codex', args, {
      cwd: this.sdkDirectory,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    })
    this.activeChild = child

    const assistantTexts: string[] = []
    const commands: CompletedCommand[] = []
    let nextSessionId = sessionId
    let errorMessage: string | undefined
    let sandboxDeniedContext: string | undefined

    const parseLine = (line: string): void => {
      const trimmed = line.trim()
      if (!trimmed.startsWith('{')) {
        return
      }
      let parsed: CodexJsonEvent
      try {
        parsed = JSON.parse(trimmed) as CodexJsonEvent
      } catch {
        return
      }

      if (parsed.type === 'thread.started' && parsed.thread_id) {
        nextSessionId = parsed.thread_id
        return
      }

      if (parsed.type === 'item.completed' && parsed.item?.type === 'agent_message') {
        const text = parsed.item.text?.trim()
        if (text) {
          assistantTexts.push(text)
          if (!sandboxDeniedContext && SANDBOX_DENIAL_RE.test(text)) {
            sandboxDeniedContext = text
          }
        }
        return
      }

      if (
        parsed.type === 'item.completed' &&
        parsed.item?.type === 'command_execution'
      ) {
        const command = parsed.item.command || ''
        const output = parsed.item.aggregated_output || ''
        const exitCode = parsed.item.exit_code ?? 0
        commands.push({ command, output, exitCode })
        if (
          !sandboxDeniedContext &&
          exitCode !== 0 &&
          SANDBOX_DENIAL_RE.test(output)
        ) {
          sandboxDeniedContext = output
        }
        return
      }

      if (parsed.type === 'error' && parsed.message) {
        errorMessage = parsed.message
        return
      }

      if (parsed.type === 'turn.failed') {
        errorMessage = parsed.error?.message || 'Codex turn failed'
      }
    }

    const consumeStream = (
      stream: NodeJS.ReadableStream,
    ): void => {
      let buffer = ''
      stream.on('data', (chunk: Buffer | string) => {
        buffer += chunk.toString()
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() || ''
        for (const line of lines) {
          parseLine(line)
        }
      })
      stream.on('end', () => {
        if (buffer.trim()) {
          parseLine(buffer)
        }
      })
    }

    if (child.stdout) {
      consumeStream(child.stdout)
    }
    if (child.stderr) {
      consumeStream(child.stderr)
    }

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (code) => {
        resolve(code)
      })
    }).catch((error: unknown) => {
      errorMessage =
        error instanceof Error ? error.message : 'Failed to start Codex CLI'
      return null
    }).finally(async () => {
      this.activeChild = null
      await cleanupTempPaths(tempImagePaths)
    })

    const wasAborted = this.abortedRunId === runId

    if (!wasAborted && exitCode && exitCode !== 0 && !errorMessage) {
      errorMessage = `Codex exited with code ${exitCode}`
    }

    return {
      runId,
      sessionId: nextSessionId,
      assistantTexts,
      commands,
      errorMessage,
      sandboxDeniedContext,
      wasAborted,
    }
  }

  async retryLastUserPrompt(options?: {
    sandboxMode?: CodexSandboxMode
  }): Promise<boolean> {
    if (!this.lastTurnInput) {
      return false
    }

    if (this.activeChild) {
      const activeTurnPromise = this.activeTurnPromise
      this.abortActiveRun('codex-retry')
      if (activeTurnPromise) {
        await activeTurnPromise.catch(() => {})
      }
    }

    const sandboxMode = options?.sandboxMode
    if (sandboxMode && sandboxMode !== this.currentSandboxMode) {
      await setThreadSession(this.threadId, '')
      threadState.clearSessionId(this.threadId)
      this.currentSandboxMode = sandboxMode
    }

    this.blockedAfterAbort = false

    await this.enqueueResolvedInput({
      ...this.lastTurnInput,
      images: this.lastTurnInput.images ? [...this.lastTurnInput.images] : undefined,
      sandboxMode: sandboxMode || this.lastTurnInput.sandboxMode,
    })
    return true
  }

  dispose(): void {
    this.disposed = true
    this.stopTyping()
    threadState.clearQueueItems(this.threadId)
    if (this.activeChild && !this.activeChild.killed) {
      this.activeChild.kill('SIGKILL')
    }
    this.activeChild = null
  }

  isIdleForInactivityTimeout({
    idleMs,
    nowMs,
  }: {
    idleMs: number
    nowMs?: number
  }): boolean {
    const now = nowMs ?? Date.now()
    return !this.activeChild
      && (this.state?.queueItems.length ?? 0) === 0
      && now - this.lastActivityAt >= idleMs
  }
}

function buildExecArgs({
  promptText,
  model,
  sandboxMode,
  imagePaths,
  cwd,
}: {
  promptText: string
  model?: string
  sandboxMode: CodexSandboxMode
  imagePaths: string[]
  cwd: string
}): string[] {
  const args = [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--cd',
    cwd,
  ]

  if (model) {
    args.push('--model', model)
  }

  if (sandboxMode === 'danger-full-access') {
    args.push('--dangerously-bypass-approvals-and-sandbox')
  } else {
    args.push('--sandbox', sandboxMode)
  }

  for (const imagePath of imagePaths) {
    args.push('--image', imagePath)
  }

  args.push('--', promptText)
  return args
}

function buildResumeArgs({
  sessionId,
  promptText,
  model,
  sandboxMode,
  imagePaths,
}: {
  sessionId: string
  promptText: string
  model?: string
  sandboxMode: CodexSandboxMode
  imagePaths: string[]
}): string[] {
  const args = [
    'exec',
    'resume',
    '--json',
    '--skip-git-repo-check',
  ]

  if (model) {
    args.push('--model', model)
  }

  if (sandboxMode === 'danger-full-access') {
    args.push('--dangerously-bypass-approvals-and-sandbox')
  }

  for (const imagePath of imagePaths) {
    args.push('--image', imagePath)
  }

  args.push(sessionId, '--', promptText)
  return args
}

function formatCommandExecution(command: CompletedCommand): string {
  const output = truncate(command.output.trim(), 1200)
  if (!output) {
    return `Ran \`${command.command}\` (exit ${command.exitCode}).`
  }

  return [
    `Ran \`${command.command}\` (exit ${command.exitCode}).`,
    '```text',
    output,
    '```',
  ].join('\n')
}
