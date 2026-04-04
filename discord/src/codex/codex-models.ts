import fs from 'node:fs'
import { getChannelModel, getSessionModel } from '../database.js'
import { getKimakiCodexConfigPath } from './codex-home.js'

export type CodexModelSource = 'session' | 'channel' | 'default'

export type CodexReasoningEffort =
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'

export type CodexCurrentModelInfo = {
  modelId: string
  source: CodexModelSource
  reasoningEffort?: CodexReasoningEffort
}

export type CodexModelOption = {
  id: string
  label: string
  description: string
}

export type CodexReasoningOption = {
  id: CodexReasoningEffort
  label: string
  description: string
}

type CodexConfigHints = {
  model?: string
  modelReasoningEffort?: CodexReasoningEffort
  migratedModels: string[]
}

const DEFAULT_FALLBACK_MODELS = ['gpt-5.4', 'gpt-5', 'gpt-5.3-codex']

export const CODEX_DEFAULT_MODEL_ID = 'codex/default'

const REASONING_LABELS: Record<CodexReasoningEffort, string> = {
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'XHigh',
}

function isCodexModelId(modelId: string): boolean {
  return modelId === CODEX_DEFAULT_MODEL_ID || modelId.startsWith('codex/')
}

function toCodexNamespacedModel(model: string | undefined): string | undefined {
  if (!model?.trim()) {
    return undefined
  }
  return `codex/${model.trim()}`
}

function normalizeCodexReasoningEffort(
  value: string | undefined,
): CodexReasoningEffort | undefined {
  switch (value?.trim()) {
    case 'minimal':
      return 'minimal'
    case 'low':
      return 'low'
    case 'medium':
      return 'medium'
    case 'high':
      return 'high'
    case 'xhigh':
      return 'xhigh'
    default:
      return undefined
  }
}

export function parseCodexConfigHints(content: string): CodexConfigHints {
  const modelMatch = content.match(/^model\s*=\s*"([^"]+)"/m)
  const effortMatch = content.match(/^model_reasoning_effort\s*=\s*"([^"]+)"/m)
  const migratedModels: string[] = []
  const lines = content.split(/\r?\n/)
  let inMigrationsBlock = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '[notice.model_migrations]') {
      inMigrationsBlock = true
      continue
    }
    if (inMigrationsBlock && trimmed.startsWith('[')) {
      break
    }
    if (!inMigrationsBlock) {
      continue
    }
    const migrationMatch = trimmed.match(/^"[^"]+"\s*=\s*"([^"]+)"/)
    const migrated = migrationMatch?.[1]?.trim()
    if (migrated) {
      migratedModels.push(migrated)
    }
  }

  return {
    model: modelMatch?.[1]?.trim(),
    modelReasoningEffort: normalizeCodexReasoningEffort(effortMatch?.[1]),
    migratedModels,
  }
}

async function readCodexConfigHints(): Promise<CodexConfigHints> {
  const configPath = getKimakiCodexConfigPath()
  const content = await fs.promises.readFile(configPath, 'utf8').catch(() => '')
  if (!content) {
    return {
      migratedModels: [],
    }
  }
  return parseCodexConfigHints(content)
}

function buildModelDescription(
  model: string,
  configHints: CodexConfigHints,
): string {
  if (configHints.model === model) {
    return 'Current model from the Kimaki Codex config'
  }
  if (configHints.migratedModels.includes(model)) {
    return 'Migration target hinted by Codex config'
  }
  if (model === 'gpt-5.4') {
    return 'Current GPT-5 general model'
  }
  if (model === 'gpt-5') {
    return 'Stable GPT-5 alias'
  }
  if (model === 'gpt-5.3-codex') {
    return 'Pinned Codex model variant'
  }
  return 'Codex model'
}

export async function getCodexModelOptions(): Promise<CodexModelOption[]> {
  const configHints = await readCodexConfigHints()
  const modelIds = [
    CODEX_DEFAULT_MODEL_ID,
    ...new Set(
      [
        configHints.model,
        ...configHints.migratedModels,
        ...DEFAULT_FALLBACK_MODELS,
      ].filter((model): model is string => Boolean(model?.trim())),
    ),
  ]

  return modelIds.map((modelId) => {
    if (modelId === CODEX_DEFAULT_MODEL_ID) {
      return {
        id: modelId,
        label: 'Default',
        description: 'Use the Codex CLI account default',
      }
    }

    const plainModel = modelId.replace(/^codex\//, '')
    return {
      id: modelId.startsWith('codex/') ? modelId : `codex/${plainModel}`,
      label: plainModel,
      description: buildModelDescription(plainModel, configHints),
    }
  })
}

export function getCodexReasoningOptions({
  modelId,
}: {
  modelId: string
}): CodexReasoningOption[] {
  const includeXHigh =
    modelId === CODEX_DEFAULT_MODEL_ID || modelId === 'codex/gpt-5.4'

  const optionIds: CodexReasoningEffort[] = includeXHigh
    ? ['minimal', 'low', 'medium', 'high', 'xhigh']
    : ['minimal', 'low', 'medium', 'high']

  return optionIds.map((id) => ({
    id,
    label: REASONING_LABELS[id],
    description:
      id === 'high'
        ? 'Recommended for most Codex runs'
        : id === 'xhigh'
          ? 'Highest effort when the selected model supports it'
          : `Use ${REASONING_LABELS[id].toLowerCase()} reasoning effort`,
  }))
}

export async function getCurrentCodexModelInfo({
  sessionId,
  channelId,
}: {
  sessionId?: string
  channelId?: string
}): Promise<CodexCurrentModelInfo> {
  if (sessionId) {
    const sessionModel = await getSessionModel(sessionId)
    if (sessionModel && isCodexModelId(sessionModel.modelId)) {
      return {
        modelId: sessionModel.modelId,
        source: 'session',
        reasoningEffort: normalizeCodexReasoningEffort(
          sessionModel.variant ?? undefined,
        ),
      }
    }
  }

  if (channelId) {
    const channelModel = await getChannelModel(channelId)
    if (channelModel && isCodexModelId(channelModel.modelId)) {
      return {
        modelId: channelModel.modelId,
        source: 'channel',
        reasoningEffort: normalizeCodexReasoningEffort(
          channelModel.variant ?? undefined,
        ),
      }
    }
  }

  const configHints = await readCodexConfigHints()
  return {
    modelId: toCodexNamespacedModel(configHints.model) || CODEX_DEFAULT_MODEL_ID,
    source: 'default',
    reasoningEffort: configHints.modelReasoningEffort,
  }
}

export function toCodexCliModel(modelId: string | undefined): string | undefined {
  if (!modelId || modelId === CODEX_DEFAULT_MODEL_ID) {
    return undefined
  }
  if (!modelId.startsWith('codex/')) {
    return undefined
  }
  return modelId.slice('codex/'.length) || undefined
}

export function describeCodexModelSource(source: CodexModelSource): string {
  switch (source) {
    case 'session':
      return 'thread override'
    case 'channel':
      return 'channel override'
    case 'default':
      return 'Codex default'
  }
}

export async function findCodexModelOption(
  modelId: string,
): Promise<CodexModelOption | undefined> {
  const options = await getCodexModelOptions()
  return options.find((option) => option.id === modelId)
}
