// /new-session command - Start a new Codex session.

import { ChannelType, type TextChannel } from 'discord.js'
import fs from 'node:fs'
import type { AutocompleteContext, CommandContext } from './types.js'
import { getChannelDirectory } from '../database.js'
import {
  SILENT_MESSAGE_FLAGS,
  resolveProjectDirectoryFromAutocomplete,
} from '../discord-utils.js'
import { getOrCreateRuntime } from '../session-handler/thread-session-runtime.js'
import { createLogger, LogPrefix } from '../logger.js'

const logger = createLogger(LogPrefix.SESSION)
const CODEX_AGENT_NOT_SUPPORTED_MESSAGE =
  'Codex agent profiles are not ported yet. Use /model for now.'

export async function handleSessionCommand({
  command,
  appId,
}: CommandContext): Promise<void> {
  await command.deferReply()

  const prompt = command.options.getString('prompt', true)
  const filesString = command.options.getString('files') || ''
  const agent = command.options.getString('agent') || undefined
  const channel = command.channel

  if (agent) {
    await command.editReply(CODEX_AGENT_NOT_SUPPORTED_MESSAGE)
    return
  }

  if (!channel || channel.type !== ChannelType.GuildText) {
    await command.editReply('This command can only be used in text channels')
    return
  }

  const textChannel = channel as TextChannel
  const channelConfig = await getChannelDirectory(textChannel.id)
  const projectDirectory = channelConfig?.directory

  if (!projectDirectory) {
    await command.editReply(
      'This channel is not configured with a project directory',
    )
    return
  }

  if (!fs.existsSync(projectDirectory)) {
    await command.editReply(`Directory does not exist: ${projectDirectory}`)
    return
  }

  try {
    const files = filesString
      .split(',')
      .map((file) => file.trim())
      .filter((file) => file)

    let fullPrompt = prompt
    if (files.length > 0) {
      fullPrompt = `${prompt}\n\n@${files.join(' @')}`
    }

    const starterMessage = await textChannel.send({
      content:
        `Starting Codex session\n${prompt}${files.length > 0 ? `\nFiles: ${files.join(', ')}` : ''}`,
      flags: SILENT_MESSAGE_FLAGS,
    })

    const thread = await starterMessage.startThread({
      name: prompt.slice(0, 100),
      autoArchiveDuration: 1440,
      reason: 'Codex session',
    })

    await thread.members.add(command.user.id)
    await command.editReply(`Created new session in ${thread.toString()}`)

    const runtime = getOrCreateRuntime({
      threadId: thread.id,
      thread,
      projectDirectory,
      sdkDirectory: projectDirectory,
      channelId: textChannel.id,
      appId,
    })
    await runtime.enqueueIncoming({
      prompt: fullPrompt,
      userId: command.user.id,
      username: command.user.displayName,
      appId,
    })
  } catch (error) {
    logger.error('[SESSION] Error:', error)
    await command.editReply(
      `Failed to create session: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

export async function handleSessionAutocomplete({
  interaction,
}: AutocompleteContext): Promise<void> {
  const focusedOption = interaction.options.getFocused(true)

  if (focusedOption.name === 'agent') {
    await interaction.respond([])
    return
  }

  if (focusedOption.name !== 'files') {
    return
  }

  const projectDirectory = await resolveProjectDirectoryFromAutocomplete(interaction)
  if (!projectDirectory) {
    await interaction.respond([])
    return
  }

  await interaction.respond([])
}
