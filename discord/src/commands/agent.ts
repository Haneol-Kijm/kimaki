// /agent command - Set the preferred agent for this channel or session.
// Also provides quick agent commands like /plan-agent, /build-agent that switch instantly.

import {
  ChatInputCommandInteraction,
  StringSelectMenuInteraction,
  StringSelectMenuBuilder,
  ActionRowBuilder,
  ChannelType,
  type ThreadChannel,
  type TextChannel,
  MessageFlags,
} from 'discord.js'
import crypto from 'node:crypto'
import {
  setChannelAgent,
  setSessionAgent,
  clearSessionModel,
  getThreadSession,
  getSessionAgent,
  getChannelAgent,
} from '../database.js'
import { initializeOpencodeForDirectory } from '../opencode.js'
import { resolveTextChannel, getKimakiMetadata } from '../discord-utils.js'
import { createLogger, LogPrefix } from '../logger.js'

const agentLogger = createLogger(LogPrefix.AGENT)
const CODEX_AGENT_NOT_SUPPORTED_MESSAGE =
  'Codex agent profiles are not ported yet. Use /model for now.'

const AGENT_CONTEXT_TTL_MS = 10 * 60 * 1000
const pendingAgentContexts = new Map<
  string,
  {
    dir: string
    channelId: string
    sessionId?: string
    isThread: boolean
  }
>()

/**
 * Context for agent commands, containing channel/session info.
 */
export type AgentCommandContext = {
  dir: string
  channelId: string
  sessionId?: string
  isThread: boolean
}

export type CurrentAgentInfo =
  | { type: 'session'; agent: string }
  | { type: 'channel'; agent: string }
  | { type: 'none' }

/**
 * Get the current agent info for a channel/session, including where it comes from.
 * Priority: session > channel > none
 */
export async function getCurrentAgentInfo({
  sessionId,
  channelId,
}: {
  sessionId?: string
  channelId?: string
}): Promise<CurrentAgentInfo> {
  if (sessionId) {
    const sessionAgent = await getSessionAgent(sessionId)
    if (sessionAgent) {
      return { type: 'session', agent: sessionAgent }
    }
  }
  if (channelId) {
    const channelAgent = await getChannelAgent(channelId)
    if (channelAgent) {
      return { type: 'channel', agent: channelAgent }
    }
  }
  return { type: 'none' }
}

/**
 * Sanitize an agent name to be a valid Discord command name component.
 * Lowercase, alphanumeric and hyphens only.
 */
export function sanitizeAgentName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

const QUICK_AGENT_DESCRIPTION_PATTERN = /^\[agent:([^\]]+)\]/

/**
 * Build quick-agent command description with an embedded original agent name.
 * Metadata format: [agent:<original-name>] <visible description>
 */
export function buildQuickAgentCommandDescription({
  agentName,
  description,
}: {
  agentName: string
  description?: string
}): string {
  const metadataPrefix = `[agent:${agentName}]`
  if (metadataPrefix.length > 100) {
    return metadataPrefix.slice(0, 100)
  }

  const visibleDescription = description || `Switch to ${agentName} agent`
  const maxVisibleLength = 100 - metadataPrefix.length - 1

  if (maxVisibleLength <= 0) {
    return metadataPrefix
  }

  const trimmedVisible = visibleDescription.slice(0, maxVisibleLength).trim()
  if (!trimmedVisible) {
    return metadataPrefix
  }

  return `${metadataPrefix} ${trimmedVisible}`
}

function parseQuickAgentNameFromDescription(
  description: string | undefined,
): string | undefined {
  if (!description) {
    return undefined
  }
  const match = QUICK_AGENT_DESCRIPTION_PATTERN.exec(description)
  if (!match) {
    return undefined
  }
  const agentName = match[1]?.trim()
  if (!agentName) {
    return undefined
  }
  return agentName
}

async function resolveQuickAgentNameFromInteraction({
  command,
}: {
  command: ChatInputCommandInteraction
}): Promise<string | undefined> {
  const fromCommandObject = parseQuickAgentNameFromDescription(
    command.command?.description,
  )
  if (fromCommandObject) {
    return fromCommandObject
  }

  if (!command.guild) {
    return undefined
  }

  const fetchedCommand = await command.guild.commands.fetch(command.commandId)
  if (!fetchedCommand) {
    return undefined
  }

  return parseQuickAgentNameFromDescription(fetchedCommand.description)
}

/**
 * Resolve the context for an agent command (directory, channel, session).
 * Returns null if the command cannot be executed in this context.
 */
export async function resolveAgentCommandContext({
  interaction,
}: {
  interaction: ChatInputCommandInteraction
  appId: string
}): Promise<AgentCommandContext | null> {
  const channel = interaction.channel

  if (!channel) {
    await interaction.editReply({
      content: 'This command can only be used in a channel',
    })
    return null
  }

  const isThread = [
    ChannelType.PublicThread,
    ChannelType.PrivateThread,
    ChannelType.AnnouncementThread,
  ].includes(channel.type)

  let projectDirectory: string | undefined
  let targetChannelId: string
  let sessionId: string | undefined

  if (isThread) {
    const thread = channel as ThreadChannel
    const textChannel = await resolveTextChannel(thread)
    const metadata = await getKimakiMetadata(textChannel)
    projectDirectory = metadata.projectDirectory
    targetChannelId = textChannel?.id || channel.id

    sessionId = await getThreadSession(thread.id)
  } else if (channel.type === ChannelType.GuildText) {
    const textChannel = channel as TextChannel
    const metadata = await getKimakiMetadata(textChannel)
    projectDirectory = metadata.projectDirectory
    targetChannelId = channel.id
  } else {
    await interaction.editReply({
      content: 'This command can only be used in text channels or threads',
    })
    return null
  }

  if (!projectDirectory) {
    await interaction.editReply({
      content: 'This channel is not configured with a project directory',
    })
    return null
  }

  return {
    dir: projectDirectory,
    channelId: targetChannelId,
    sessionId,
    isThread,
  }
}

/**
 * Set the agent preference for a context (session or channel).
 * When switching agents for a session, clears session model preference
 * so the new agent's model takes effect (agent model > channel model).
 */
export async function setAgentForContext({
  context,
  agentName,
}: {
  context: AgentCommandContext
  agentName: string
}): Promise<void> {
  if (context.isThread && context.sessionId) {
    await setSessionAgent(context.sessionId, agentName)
    // Clear session model so the new agent's model takes effect
    await clearSessionModel(context.sessionId)
    agentLogger.log(
      `Set agent ${agentName} for session ${context.sessionId} (cleared session model)`,
    )
  } else {
    await setChannelAgent(context.channelId, agentName)
    agentLogger.log(`Set agent ${agentName} for channel ${context.channelId}`)
  }
}

export async function handleAgentCommand({
  interaction,
}: {
  interaction: ChatInputCommandInteraction
  appId: string
}): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  await interaction.editReply({
    content: CODEX_AGENT_NOT_SUPPORTED_MESSAGE,
  })
}

export async function handleAgentSelectMenu(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const customId = interaction.customId

  if (!customId.startsWith('agent_select:')) {
    return
  }

  await interaction.deferUpdate()

  const contextHash = customId.replace('agent_select:', '')
  const context = pendingAgentContexts.get(contextHash)

  if (!context) {
    await interaction.editReply({
      content: 'Selection expired. Please run /agent again.',
      components: [],
    })
    return
  }

  const selectedAgent = interaction.values[0]
  if (!selectedAgent) {
    await interaction.editReply({
      content: 'No agent selected',
      components: [],
    })
    return
  }

  try {
    await setAgentForContext({ context, agentName: selectedAgent })

    if (context.isThread && context.sessionId) {
      await interaction.editReply({
        content: `Agent preference set for this session next messages: **${selectedAgent}**`,
        components: [],
      })
    } else {
      await interaction.editReply({
        content: `Agent preference set for this channel: **${selectedAgent}**\nAll new sessions in this channel will use this agent.`,
        components: [],
      })
    }

    pendingAgentContexts.delete(contextHash)
  } catch (error) {
    agentLogger.error('Error saving agent preference:', error)
    await interaction.editReply({
      content: `Failed to save agent preference: ${error instanceof Error ? error.message : 'Unknown error'}`,
      components: [],
    })
  }
}

/**
 * Handle quick agent commands like /plan-agent, /build-agent.
 * These instantly switch to the specified agent without showing a dropdown.
 *
 * The slash command name is sanitized for Discord and can be lossy
 * (for example gpt5.4 -> gpt5-4-agent). To keep the original agent name,
 * registration stores [agent:<name>] metadata in the description and this
 * handler resolves from that metadata first.
 */
export async function handleQuickAgentCommand({
  command,
}: {
  command: ChatInputCommandInteraction
  appId: string
}): Promise<void> {
  await command.deferReply({ flags: MessageFlags.Ephemeral })

  await command.editReply({
    content: CODEX_AGENT_NOT_SUPPORTED_MESSAGE,
  })
}
