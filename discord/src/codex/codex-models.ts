import {
  getChannelModel,
  getSessionModel,
} from '../database.js'

export type CodexModelSource = 'session' | 'channel' | 'default'

export type CodexCurrentModelInfo = {
  modelId: string
  source: CodexModelSource
}

export type CodexModelOption = {
  id: string
  label: string
  description: string
}

export const CODEX_DEFAULT_MODEL_ID = 'codex/default'

export const CODEX_MODEL_OPTIONS: CodexModelOption[] = [
  {
    id: CODEX_DEFAULT_MODEL_ID,
    label: 'Default',
    description: 'Use the Codex CLI account default',
  },
  {
    id: 'codex/gpt-5',
    label: 'gpt-5',
    description: 'General-purpose GPT-5 model',
  },
  {
    id: 'codex/gpt-5-mini',
    label: 'gpt-5-mini',
    description: 'Lower-cost GPT-5 variant if available',
  },
  {
    id: 'codex/o4-mini',
    label: 'o4-mini',
    description: 'Smaller reasoning model if available',
  },
]

function isCodexModelId(modelId: string): boolean {
  return modelId === CODEX_DEFAULT_MODEL_ID || modelId.startsWith('codex/')
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
      }
    }
  }

  if (channelId) {
    const channelModel = await getChannelModel(channelId)
    if (channelModel && isCodexModelId(channelModel.modelId)) {
      return {
        modelId: channelModel.modelId,
        source: 'channel',
      }
    }
  }

  return {
    modelId: CODEX_DEFAULT_MODEL_ID,
    source: 'default',
  }
}

export function toCodexCliModel(
  modelId: string | undefined,
): string | undefined {
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

export function findCodexModelOption(
  modelId: string,
): CodexModelOption | undefined {
  return CODEX_MODEL_OPTIONS.find((option) => option.id === modelId)
}
