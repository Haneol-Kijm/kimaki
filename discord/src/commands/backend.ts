import {
  ChannelType,
  MessageFlags,
  type TextChannel,
} from 'discord.js'
import type { CommandContext } from './types.js'
import {
  getChannelBackend,
  getChannelDirectory,
  setChannelBackend,
} from '../database.js'
import { SILENT_MESSAGE_FLAGS } from '../discord-utils.js'

export async function handleBackendCommand({
  command,
}: CommandContext): Promise<void> {
  const channel = command.channel
  if (!channel || channel.type !== ChannelType.GuildText) {
    await command.reply({
      content: 'This command can only be used in project text channels',
      flags: MessageFlags.Ephemeral | SILENT_MESSAGE_FLAGS,
    })
    return
  }

  const textChannel = channel as TextChannel
  const project = await getChannelDirectory(textChannel.id)
  if (!project) {
    await command.reply({
      content: 'This channel is not configured with a project directory',
      flags: MessageFlags.Ephemeral | SILENT_MESSAGE_FLAGS,
    })
    return
  }

  const requestedBackend = command.options.getString('backend')
  if (!requestedBackend) {
    const backend = await getChannelBackend(textChannel.id)
    await command.reply({
      content: `Current backend: \`${backend || 'opencode'}\``,
      flags: MessageFlags.Ephemeral | SILENT_MESSAGE_FLAGS,
    })
    return
  }

  if (requestedBackend !== 'opencode' && requestedBackend !== 'codex') {
    await command.reply({
      content: 'Unsupported backend',
      flags: MessageFlags.Ephemeral | SILENT_MESSAGE_FLAGS,
    })
    return
  }

  await setChannelBackend({
    channelId: textChannel.id,
    backend: requestedBackend,
  })

  await command.reply({
    content: `Backend for this channel set to \`${requestedBackend}\`.\nExisting threads keep their current backend; new threads use the new backend.`,
    flags: SILENT_MESSAGE_FLAGS,
  })
}
