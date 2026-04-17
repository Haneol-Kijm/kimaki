import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface, type Interface } from 'node:readline'
import {
  type CollaborationMode,
  type InitializeResponse,
  isJsonRpcResponse,
  isJsonRpcServerEvent,
  type JsonRpcError,
  type JsonRpcId,
  type JsonRpcResponse,
  type JsonRpcServerEvent,
  type RequestUserInputResponse,
  type ThreadStartResponse,
  type TurnStartResponse,
} from './types.js'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve: ((value: T) => void) | undefined
  let reject: ((error: Error) => void) | undefined

  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  if (!resolve || !reject) {
    throw new Error('failed to create deferred')
  }

  return { promise, resolve, reject }
}

function stringifyJsonRpcError(error: JsonRpcError): string {
  const dataSuffix =
    error.data === undefined ? '' : ` data=${JSON.stringify(error.data)}`
  return `${error.code}: ${error.message}${dataSuffix}`
}

type StartOptions = {
  configOverrides?: string[]
  enabledFeatures?: string[]
  disabledFeatures?: string[]
}

type StartThreadParams = {
  model?: string
  cwd?: string | null
  approvalPolicy?: string
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access'
  developerInstructions?: string | null
  experimentalRawEvents?: boolean
  persistExtendedHistory?: boolean
}

type StartTurnParams = {
  threadId: string
  input: Array<{
    type: 'text'
    text: string
    text_elements: []
  }>
  collaborationMode?: CollaborationMode | null
}

export class CodexAppServerClient {
  private readonly process: ChildProcessWithoutNullStreams
  private readonly readline: Interface
  private readonly pendingResponses = new Map<JsonRpcId, Deferred<unknown>>()
  private readonly queuedEvents: JsonRpcServerEvent[] = []
  private readonly waitingForEvent: Array<(event: JsonRpcServerEvent) => void> = []
  private readonly stderrLines: string[] = []
  private requestCounter = 0
  private closed = false
  private closeError: Error | null = null

  constructor({
    configOverrides = [],
    enabledFeatures = [],
    disabledFeatures = [],
  }: StartOptions = {}) {
    const args = ['app-server', '--listen', 'stdio://']

    for (const override of configOverrides) {
      args.push('-c', override)
    }
    for (const feature of enabledFeatures) {
      args.push('--enable', feature)
    }
    for (const feature of disabledFeatures) {
      args.push('--disable', feature)
    }

    this.process = spawn('codex', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.readline = createInterface({
      input: this.process.stdout,
      crlfDelay: Infinity,
    })

    this.readline.on('line', (line) => {
      this.handleStdoutLine(line)
    })

    this.process.stderr.on('data', (chunk) => {
      const text = chunk.toString()
      this.stderrLines.push(text)
      if (this.stderrLines.length > 20) {
        this.stderrLines.shift()
      }
    })

    this.process.on('close', (code, signal) => {
      this.closed = true
      const stderrTail = this.stderrLines.join('').trim()
      const tailSuffix = stderrTail ? ` stderr=${stderrTail}` : ''
      this.closeError = new Error(
        `codex app-server exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})${tailSuffix}`,
      )

      for (const deferred of this.pendingResponses.values()) {
        deferred.reject(this.closeError)
      }
      this.pendingResponses.clear()

      while (this.waitingForEvent.length > 0) {
        const resolve = this.waitingForEvent.shift()
        if (!resolve) {
          continue
        }
        resolve({
          method: 'app-server/closed',
          params: { code, signal, stderrTail },
        })
      }
    })
  }

  async initialize(): Promise<InitializeResponse> {
    const response = await this.sendRequest<InitializeResponse>({
      method: 'initialize',
      params: {
        clientInfo: {
          name: 'kimaki-app-server-probe',
          title: 'Kimaki App Server Probe',
          version: '0.0.0',
        },
        capabilities: {
          experimentalApi: true,
        },
      },
    })

    this.sendNotification({ method: 'initialized' })
    return response
  }

  async startThread(
    params: StartThreadParams = {},
  ): Promise<ThreadStartResponse> {
    return this.sendRequest<ThreadStartResponse>({
      method: 'thread/start',
      params: {
        model: params.model ?? null,
        cwd: params.cwd ?? null,
        approvalPolicy: params.approvalPolicy ?? null,
        sandbox: params.sandbox ?? null,
        developerInstructions: params.developerInstructions ?? null,
        experimentalRawEvents: params.experimentalRawEvents ?? false,
        persistExtendedHistory: params.persistExtendedHistory ?? false,
      },
    })
  }

  async startTurn(params: StartTurnParams): Promise<TurnStartResponse> {
    return this.sendRequest<TurnStartResponse>({
      method: 'turn/start',
      params: {
        threadId: params.threadId,
        input: params.input,
        collaborationMode: params.collaborationMode ?? null,
      },
    })
  }

  respondToRequestUserInput({
    requestId,
    response,
  }: {
    requestId: JsonRpcId
    response: RequestUserInputResponse
  }): void {
    this.writeMessage({
      id: requestId,
      result: response,
    })
  }

  async nextEvent({
    timeoutMs,
  }: {
    timeoutMs?: number
  } = {}): Promise<JsonRpcServerEvent | null> {
    if (this.queuedEvents.length > 0) {
      return this.queuedEvents.shift() ?? null
    }

    if (this.closed) {
      return null
    }

    const deferred = createDeferred<JsonRpcServerEvent>()
    this.waitingForEvent.push(deferred.resolve)

    let timeoutHandle: NodeJS.Timeout | undefined
    if (timeoutMs !== undefined) {
      timeoutHandle = setTimeout(() => {
        const index = this.waitingForEvent.indexOf(deferred.resolve)
        if (index >= 0) {
          this.waitingForEvent.splice(index, 1)
        }
        deferred.resolve({
          method: 'app-server/timeout',
          params: { timeoutMs },
        })
      }, timeoutMs)
      timeoutHandle.unref()
    }

    const event = await deferred.promise
    if (timeoutHandle) {
      clearTimeout(timeoutHandle)
    }

    if (event.method === 'app-server/timeout') {
      return null
    }

    return event
  }

  dispose(): void {
    if (this.closed) {
      return
    }
    this.process.kill()
  }

  private async sendRequest<T>({
    method,
    params,
  }: {
    method: string
    params?: unknown
  }): Promise<T> {
    this.assertOpen()

    const id = `${++this.requestCounter}`
    const deferred = createDeferred<unknown>()
    this.pendingResponses.set(id, deferred)

    this.writeMessage({
      id,
      method,
      params,
    })

    const result = await deferred.promise
    return result as T
  }

  private sendNotification({
    method,
    params,
  }: {
    method: string
    params?: unknown
  }): void {
    this.assertOpen()
    this.writeMessage({ method, params })
  }

  private writeMessage(message: Record<string, unknown>): void {
    const line = JSON.stringify(message)
    this.process.stdin.write(`${line}\n`)
  }

  private handleStdoutLine(line: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      this.enqueueEvent({
        method: 'app-server/non-json-line',
        params: { line },
      })
      return
    }

    if (isJsonRpcResponse(parsed)) {
      this.handleResponse(parsed)
      return
    }

    if (isJsonRpcServerEvent(parsed)) {
      this.enqueueEvent(parsed)
    }
  }

  private handleResponse(response: JsonRpcResponse<unknown>): void {
    const deferred = this.pendingResponses.get(response.id)
    if (!deferred) {
      this.enqueueEvent({
        method: 'app-server/unmatched-response',
        params: response,
      })
      return
    }

    this.pendingResponses.delete(response.id)

    if (response.error) {
      deferred.reject(new Error(stringifyJsonRpcError(response.error)))
      return
    }

    deferred.resolve(response.result)
  }

  private enqueueEvent(event: JsonRpcServerEvent): void {
    const waiter = this.waitingForEvent.shift()
    if (waiter) {
      waiter(event)
      return
    }
    this.queuedEvents.push(event)
  }

  private assertOpen(): void {
    if (this.closed) {
      throw this.closeError ?? new Error('codex app-server is closed')
    }
  }
}
