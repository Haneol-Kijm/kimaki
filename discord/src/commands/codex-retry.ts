import {
  ChannelType,
  MessageFlags,
  type ButtonInteraction,
} from 'discord.js'
import { getRuntime } from '../session-handler/thread-session-runtime.js'
import { parseCodexRetryCustomId } from '../codex/retry-controls.js'
import { SILENT_MESSAGE_FLAGS } from '../discord-utils.js'

export async function handleCodexRetryButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const action = parseCodexRetryCustomId(interaction.customId)
  if (!action) {
    return
  }

  const channel = interaction.channel
  if (
    !channel ||
    ![
      ChannelType.PublicThread,
      ChannelType.PrivateThread,
      ChannelType.AnnouncementThread,
    ].includes(channel.type)
  ) {
    await interaction.reply({
      content: 'This retry button can only be used inside a session thread',
      flags: MessageFlags.Ephemeral | SILENT_MESSAGE_FLAGS,
    })
    return
  }

  if (action === 'cancel') {
    await interaction.update({
      content: 'Retry cancelled.',
      components: [],
    })
    return
  }

  const runtime = getRuntime(channel.id)
  if (!runtime) {
    await interaction.reply({
      content: 'Retry context expired. Send a new message to continue.',
      flags: MessageFlags.Ephemeral | SILENT_MESSAGE_FLAGS,
    })
    return
  }

  const retried = await runtime.retryLastUserPrompt({
    sandboxMode: action,
  })
  if (!retried) {
    await interaction.reply({
      content: 'There is no saved Codex prompt to retry in this thread.',
      flags: MessageFlags.Ephemeral | SILENT_MESSAGE_FLAGS,
    })
    return
  }

  await interaction.update({
    content:
      action === 'danger-full-access'
        ? 'Retrying the last Codex prompt with full access.'
        : `Retrying the last Codex prompt with \`${action}\`.`,
    components: [],
  })
}
