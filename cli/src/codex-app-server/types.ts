export type JsonRpcId = string | number

export type JsonRpcError = {
  code: number
  message: string
  data?: unknown
}

export type JsonRpcResponse<T = unknown> = {
  id: JsonRpcId
  result?: T
  error?: JsonRpcError
}

export type JsonRpcServerEvent = {
  method: string
  params?: unknown
  id?: JsonRpcId
}

export type AppServerReasoningEffort =
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'

export type CollaborationModeName = 'default' | 'plan'

export type CollaborationMode = {
  mode: CollaborationModeName
  settings: {
    model: string
    reasoning_effort: AppServerReasoningEffort | null
    developer_instructions: string | null
  }
}

export type InitializeResponse = {
  userAgent: string
  codexHome: string
  platformFamily: string
  platformOs: string
}

export type ThreadStatus =
  | { type: 'idle' }
  | { type: 'active'; activeFlags?: string[] }
  | { type: string; activeFlags?: string[] }

export type ThreadStartResponse = {
  thread: AppServerThread
  model?: string
  serviceTier?: string | null
  reasoningEffort?: string | null
  approvalPolicy?: string
  sandbox?: unknown
  instructionSources?: string[]
}

export type TurnStartResponse = {
  turn: {
    id: string
    status: string
  }
}

export type AppServerUserMessageItem = {
  type: 'userMessage'
  id: string
  content: Array<{
    type: 'text'
    text: string
    text_elements?: unknown[]
  }>
}

export type AppServerReasoningItem = {
  type: 'reasoning'
  id: string
  summary: unknown[]
  content: unknown[]
}

export type AppServerAgentMessageItem = {
  type: 'agentMessage'
  id: string
  text: string
  phase: string
  memoryCitation: string | null
}

export type AppServerItem =
  | AppServerUserMessageItem
  | AppServerReasoningItem
  | AppServerAgentMessageItem

export type AppServerTurn = {
  id: string
  items: AppServerItem[]
  status: string
  error?: unknown
  startedAt?: number | null
  completedAt?: number | null
  durationMs?: number | null
}

export type AppServerThread = {
  id: string
  cwd: string
  path?: string | null
  status: ThreadStatus
  source?: string | null
  preview?: string
  turns?: AppServerTurn[]
}

export type ThreadResumeResponse = {
  thread: AppServerThread
  model?: string
  serviceTier?: string | null
  reasoningEffort?: string | null
  approvalPolicy?: string
  sandbox?: unknown
  instructionSources?: string[]
}

export type RequestUserInputQuestionOption = {
  label: string
  description: string
}

export type RequestUserInputQuestion = {
  id: string
  header: string
  question: string
  isOther: boolean
  isSecret: boolean
  options?: RequestUserInputQuestionOption[]
}

export type RequestUserInputParams = {
  threadId: string
  turnId: string
  itemId: string
  questions: RequestUserInputQuestion[]
}

export type RequestUserInputResponse = {
  answers: Record<
    string,
    {
      answers: string[]
    }
  >
}

export type TurnPlanUpdatedParams = {
  threadId: string
  turnId: string
  explanation?: string
  plan: Array<{
    step: string
    status: 'pending' | 'inProgress' | 'completed'
  }>
}

export type ThreadTokenUsageUpdatedParams = {
  threadId: string
  turnId: string
  tokenUsage: {
    total: {
      totalTokens: number
      inputTokens: number
      cachedInputTokens: number
      outputTokens: number
      reasoningOutputTokens: number
    }
    last: {
      totalTokens: number
      inputTokens: number
      cachedInputTokens: number
      outputTokens: number
      reasoningOutputTokens: number
    }
    modelContextWindow?: number
  }
}

export type ThreadStatusChangedParams = {
  threadId: string
  status: ThreadStatus
}

export type TurnCompletedParams = {
  threadId: string
  turn: AppServerTurn
}

export type ItemStartedOrCompletedParams = {
  threadId: string
  turnId: string
  item: AppServerItem
}

export type AgentMessageDeltaParams = {
  threadId: string
  turnId: string
  itemId: string
  delta: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function hasStringField(
  value: Record<string, unknown>,
  key: string,
): value is Record<string, string> {
  return typeof value[key] === 'string'
}

export function isJsonRpcResponse<T = unknown>(
  value: unknown,
): value is JsonRpcResponse<T> {
  if (!isRecord(value)) {
    return false
  }
  return 'id' in value && ('result' in value || 'error' in value)
}

export function isJsonRpcServerEvent(
  value: unknown,
): value is JsonRpcServerEvent {
  if (!isRecord(value)) {
    return false
  }
  return typeof value['method'] === 'string'
}

export function isRequestUserInputEvent(
  value: JsonRpcServerEvent,
): value is JsonRpcServerEvent & {
  method: 'item/tool/requestUserInput'
  params: RequestUserInputParams
  id: JsonRpcId
} {
  return (
    value.method === 'item/tool/requestUserInput' &&
    value.params !== undefined &&
    value.id !== undefined
  )
}

export function isTurnPlanUpdatedEvent(
  value: JsonRpcServerEvent,
): value is JsonRpcServerEvent & {
  method: 'turn/plan/updated'
  params: TurnPlanUpdatedParams
} {
  return value.method === 'turn/plan/updated' && value.params !== undefined
}

export function isThreadTokenUsageUpdatedEvent(
  value: JsonRpcServerEvent,
): value is JsonRpcServerEvent & {
  method: 'thread/tokenUsage/updated'
  params: ThreadTokenUsageUpdatedParams
} {
  return (
    value.method === 'thread/tokenUsage/updated' && value.params !== undefined
  )
}

export function isThreadStatusChangedEvent(
  value: JsonRpcServerEvent,
): value is JsonRpcServerEvent & {
  method: 'thread/status/changed'
  params: ThreadStatusChangedParams
} {
  return value.method === 'thread/status/changed' && value.params !== undefined
}

export function isTurnCompletedEvent(
  value: JsonRpcServerEvent,
): value is JsonRpcServerEvent & {
  method: 'turn/completed'
  params: TurnCompletedParams
} {
  return value.method === 'turn/completed' && value.params !== undefined
}

export function isItemStartedEvent(
  value: JsonRpcServerEvent,
): value is JsonRpcServerEvent & {
  method: 'item/started'
  params: ItemStartedOrCompletedParams
} {
  return value.method === 'item/started' && value.params !== undefined
}

export function isItemCompletedEvent(
  value: JsonRpcServerEvent,
): value is JsonRpcServerEvent & {
  method: 'item/completed'
  params: ItemStartedOrCompletedParams
} {
  return value.method === 'item/completed' && value.params !== undefined
}

export function isAgentMessageDeltaEvent(
  value: JsonRpcServerEvent,
): value is JsonRpcServerEvent & {
  method: 'item/agentMessage/delta'
  params: AgentMessageDeltaParams
} {
  return value.method === 'item/agentMessage/delta' && value.params !== undefined
}

export function isAppServerAgentMessageItem(
  value: unknown,
): value is AppServerAgentMessageItem {
  if (!isRecord(value)) {
    return false
  }
  return (
    value['type'] === 'agentMessage'
    && hasStringField(value, 'id')
    && hasStringField(value, 'text')
    && hasStringField(value, 'phase')
    && (value['memoryCitation'] === null || typeof value['memoryCitation'] === 'string')
  )
}
