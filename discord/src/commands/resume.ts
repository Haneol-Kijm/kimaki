// /resume command - Resume an existing Codex session.

import {
  ChannelType,
  ThreadAutoArchiveDuration,
  type TextChannel,
} from 'discord.js'
import fs from 'node:fs'
import type { AutocompleteContext, CommandContext } from './types.js'
import {
  getAllThreadSessionIds,
  getChannelDirectory,
  setThreadSession,
} from '../database.js'
import {
  resolveProjectDirectoryFromAutocomplete,
  sendThreadMessage,
} from '../discord-utils.js'
import { createLogger, LogPrefix } from '../logger.js'

const logger = createLogger(LogPrefix.RESUME)

export async function handleResumeCommand({
  command,
}: CommandContext): Promise<void> {
  await command.deferReply()

  const sessionId = command.options.getString('session', true)
  const channel = command.channel

  const isThread =
    channel &&
    [
      ChannelType.PublicThread,
      ChannelType.PrivateThread,
      ChannelType.AnnouncementThread,
    ].includes(channel.type)

  if (isThread) {
    await command.editReply(
      'This command can only be used in project channels, not threads',
    )
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
    const thread = await textChannel.threads.create({
      name: `Resume: ${sessionId}`.slice(0, 100),
      autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
      reason: `Resuming Codex session ${sessionId}`,
    })

    await thread.members.add(command.user.id)
    await setThreadSession(thread.id, sessionId)

    logger.log(`[RESUME] Created thread ${thread.id} for session ${sessionId}`)

    await command.editReply(
      `Resumed Codex session \`${sessionId}\` in ${thread.toString()}`,
    )
    await sendThreadMessage(
      thread,
      `**Resumed Codex session**\nSession ID: \`${sessionId}\`\nSend a message in this thread to continue.`,
    )
  } catch (error) {
    logger.error('[RESUME] Error:', error)
    await command.editReply(
      `Failed to resume session: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

export async function handleResumeAutocomplete({
  interaction,
}: AutocompleteContext): Promise<void> {
  const focusedValue = interaction.options.getFocused()
  const projectDirectory = await resolveProjectDirectoryFromAutocomplete(interaction)

  if (!projectDirectory) {
    await interaction.respond([])
    return
  }

  try {
    const sessions = [...new Set(await getAllThreadSessionIds())]
      .filter((id) => id.toLowerCase().includes(focusedValue.toLowerCase()))
      .slice(0, 25)
      .map((id) => ({
        name: id.slice(0, 100),
        value: id,
      }))

    await interaction.respond(sessions)
  } catch (error) {
    logger.error('[AUTOCOMPLETE] Error fetching sessions:', error)
    await interaction.respond([])
  }
}
