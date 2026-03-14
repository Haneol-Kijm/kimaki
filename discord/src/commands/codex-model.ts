import crypto from 'node:crypto'
import {
  ActionRowBuilder,
  ChannelType,
  ChatInputCommandInteraction,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  type TextChannel,
  type ThreadChannel,
} from 'discord.js'
import {
  clearSessionModel,
  getChannelModel,
  getPrisma,
  getSessionModel,
  getThreadSession,
  setChannelModel,
  setSessionModel,
} from '../database.js'
import { resolveTextChannel, getKimakiMetadata } from '../discord-utils.js'
import { getRuntime } from '../session-handler/thread-session-runtime.js'
import {
  type CodexReasoningEffort,
  describeCodexModelSource,
  findCodexModelOption,
  getCodexModelOptions,
  getCodexReasoningOptions,
  getCurrentCodexModelInfo,
} from '../codex/codex-models.js'
import { createLogger, LogPrefix } from '../logger.js'

const logger = createLogger(LogPrefix.MODEL)
const CONTEXT_TTL_MS = 10 * 60 * 1000

type PendingCodexModelContext = {
  channelId: string
  sessionId?: string
  isThread: boolean
  threadId?: string
  selectedModelId?: string
  selectedReasoningEffort?: CodexReasoningEffort
}

const pendingCodexModelContexts = new Map<string, PendingCodexModelContext>()

function setContext(
  contextHash: string,
  context: PendingCodexModelContext,
): void {
  pendingCodexModelContexts.set(contextHash, context)
  setTimeout(() => {
    pendingCodexModelContexts.delete(contextHash)
  }, CONTEXT_TTL_MS).unref()
}

export async function handleCodexModelCommand({
  interaction,
}: {
  interaction: ChatInputCommandInteraction
}): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const channel = interaction.channel
  if (!channel) {
    await interaction.editReply('This command can only be used in a channel')
    return
  }

  const isThread = [
    ChannelType.PublicThread,
    ChannelType.PrivateThread,
    ChannelType.AnnouncementThread,
  ].includes(channel.type)

  let targetChannelId: string
  let sessionId: string | undefined

  if (isThread) {
    const textChannel = await resolveTextChannel(channel as ThreadChannel)
    const metadata = await getKimakiMetadata(textChannel)
    if (!metadata.projectDirectory) {
      await interaction.editReply('This channel is not configured with a project directory')
      return
    }
    targetChannelId = textChannel?.id || channel.id
    sessionId = await getThreadSession(channel.id)
  } else if (channel.type === ChannelType.GuildText) {
    const textChannel = channel as TextChannel
    const metadata = await getKimakiMetadata(textChannel)
    if (!metadata.projectDirectory) {
      await interaction.editReply('This channel is not configured with a project directory')
      return
    }
    targetChannelId = textChannel.id
  } else {
    await interaction.editReply('This command can only be used in project channels or threads')
    return
  }

  const currentModelInfo = await getCurrentCodexModelInfo({
    sessionId,
    channelId: targetChannelId,
  })

  const currentOption = await findCodexModelOption(currentModelInfo.modelId)
  const currentModelLabel = currentOption?.label || currentModelInfo.modelId
  const currentSource = describeCodexModelSource(currentModelInfo.source)
  const currentEffort = currentModelInfo.reasoningEffort
    ? ` / ${currentModelInfo.reasoningEffort}`
    : ''
  const modelOptions = await getCodexModelOptions()

  const contextHash = crypto.randomBytes(8).toString('hex')
  setContext(contextHash, {
    channelId: targetChannelId,
    sessionId,
    isThread,
    threadId: isThread ? channel.id : undefined,
  })

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`codex_model_select:${contextHash}`)
    .setPlaceholder('Select a Codex model')
    .addOptions(modelOptions.map((option) => ({
      label: option.label.slice(0, 100),
      value: option.id,
      description: option.description.slice(0, 100),
      default: option.id === currentModelInfo.modelId,
    })))

  await interaction.editReply({
    content: `**Codex model**\nCurrent: \`${currentModelLabel}\`${currentEffort} (${currentSource})\nSelect a model:`,
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu),
    ],
  })
}

export async function handleCodexModelSelectMenu(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  if (!interaction.customId.startsWith('codex_model_select:')) {
    return
  }

  await interaction.deferUpdate()

  const contextHash = interaction.customId.replace('codex_model_select:', '')
  const context = pendingCodexModelContexts.get(contextHash)
  if (!context) {
    await interaction.editReply({
      content: 'Selection expired. Please run /model again.',
      components: [],
    })
    return
  }

  const selectedModelId = interaction.values[0]
  if (!selectedModelId) {
    await interaction.editReply({
      content: 'No model selected.',
      components: [],
    })
    return
  }

  context.selectedModelId = selectedModelId
  setContext(contextHash, context)

  const reasoningOptions = getCodexReasoningOptions({
    modelId: selectedModelId,
  })

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`codex_model_effort:${contextHash}`)
    .setPlaceholder('Select reasoning effort')
    .addOptions(reasoningOptions.map((option) => ({
      label: option.label,
      value: option.id,
      description: option.description.slice(0, 100),
      default: option.id === 'high',
    })))

  await interaction.editReply({
    content: `Selected \`${selectedModelId}\`.\nSelect the reasoning effort:`,
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu),
    ],
  })
}

export async function handleCodexModelEffortSelectMenu(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  if (!interaction.customId.startsWith('codex_model_effort:')) {
    return
  }

  await interaction.deferUpdate()

  const contextHash = interaction.customId.replace('codex_model_effort:', '')
  const context = pendingCodexModelContexts.get(contextHash)
  if (!context?.selectedModelId) {
    await interaction.editReply({
      content: 'Selection expired. Please run /model again.',
      components: [],
    })
    return
  }

  const selectedEffort = interaction.values[0]
  if (
    selectedEffort !== 'minimal' &&
    selectedEffort !== 'low' &&
    selectedEffort !== 'medium' &&
    selectedEffort !== 'high' &&
    selectedEffort !== 'xhigh'
  ) {
    await interaction.editReply({
      content: 'Invalid reasoning effort selected.',
      components: [],
    })
    return
  }

  context.selectedReasoningEffort = selectedEffort
  setContext(contextHash, context)

  const scopeOptions = [
    ...(context.isThread && context.sessionId
      ? [{
          label: 'This session only',
          value: 'session',
          description: 'Use only for this thread session',
        }]
      : []),
    {
      label: 'This channel only',
      value: 'channel',
      description: 'Use for this project channel',
    },
  ]

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`codex_model_scope:${contextHash}`)
    .setPlaceholder('Apply to...')
    .addOptions(scopeOptions)

  await interaction.editReply({
    content: `Selected \`${context.selectedModelId}\` / \`${selectedEffort}\`.\nApply it to:`,
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu),
    ],
  })
}

export async function handleCodexModelScopeSelectMenu(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  if (!interaction.customId.startsWith('codex_model_scope:')) {
    return
  }

  await interaction.deferUpdate()

  const contextHash = interaction.customId.replace('codex_model_scope:', '')
  const context = pendingCodexModelContexts.get(contextHash)
  if (!context?.selectedModelId) {
    await interaction.editReply({
      content: 'Selection expired. Please run /model again.',
      components: [],
    })
    return
  }

  const selectedScope = interaction.values[0]
  if (selectedScope !== 'session' && selectedScope !== 'channel') {
    await interaction.editReply({
      content: 'Invalid scope selected.',
      components: [],
    })
    return
  }

  if (selectedScope === 'session') {
    if (!context.sessionId) {
      await interaction.editReply({
        content: 'This thread has no active session yet.',
        components: [],
      })
      return
    }

    await setSessionModel({
      sessionId: context.sessionId,
      modelId: context.selectedModelId,
      variant: context.selectedReasoningEffort ?? null,
    })

    const runtime = context.threadId ? getRuntime(context.threadId) : undefined
    const retried = runtime ? await runtime.retryLastUserPrompt() : false
    const retryNote = retried
      ? '\nRestarting the last request with the new model.'
      : '\nThe next message in this thread will use the new model.'
    const effortText = context.selectedReasoningEffort
      ? ` / ${context.selectedReasoningEffort}`
      : ''

    await interaction.editReply({
      content: `Codex model set for this thread:\n\`${context.selectedModelId}\`${effortText}${retryNote}`,
      components: [],
    })
  } else {
    await setChannelModel({
      channelId: context.channelId,
      modelId: context.selectedModelId,
      variant: context.selectedReasoningEffort ?? null,
    })

    const effortText = context.selectedReasoningEffort
      ? ` / ${context.selectedReasoningEffort}`
      : ''
    await interaction.editReply({
      content: `Codex model set for this channel:\n\`${context.selectedModelId}\`${effortText}\nNew threads in this channel will use it.`,
      components: [],
    })
  }

  pendingCodexModelContexts.delete(contextHash)
}

export async function handleCodexUnsetModelCommand({
  interaction,
}: {
  interaction: ChatInputCommandInteraction
}): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const channel = interaction.channel
  if (!channel) {
    await interaction.editReply('This command can only be used in a channel')
    return
  }

  const isThread = [
    ChannelType.PublicThread,
    ChannelType.PrivateThread,
    ChannelType.AnnouncementThread,
  ].includes(channel.type)

  let channelId: string
  let sessionId: string | undefined

  if (isThread) {
    const textChannel = await resolveTextChannel(channel as ThreadChannel)
    if (!textChannel) {
      await interaction.editReply('Could not resolve the parent project channel')
      return
    }
    channelId = textChannel.id
    sessionId = await getThreadSession(channel.id)
  } else if (channel.type === ChannelType.GuildText) {
    channelId = channel.id
  } else {
    await interaction.editReply('This command can only be used in project channels or threads')
    return
  }

  const [sessionModel, channelModel] = await Promise.all([
    sessionId ? getSessionModel(sessionId) : Promise.resolve(undefined),
    getChannelModel(channelId),
  ])

  if (
    isThread &&
    sessionId &&
    sessionModel &&
    sessionModel.modelId.startsWith('codex/')
  ) {
    await clearSessionModel(sessionId)
    logger.log(`[CODEX MODEL] cleared session override ${sessionId}`)
    await interaction.editReply('Cleared the Codex model override for this thread.')
    return
  }

  if (channelModel?.modelId.startsWith('codex/')) {
    const prisma = await getPrisma()
    await prisma.channel_models.deleteMany({
      where: {
        channel_id: channelId,
      },
    })
    logger.log(`[CODEX MODEL] cleared channel override ${channelId}`)
    await interaction.editReply('Cleared the Codex model override for this channel.')
    return
  }

  await interaction.editReply('There is no Codex model override to clear.')
}
