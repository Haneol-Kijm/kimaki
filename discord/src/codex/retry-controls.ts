import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ThreadChannel,
} from 'discord.js'

export type CodexSandboxMode =
  | 'read-only'
  | 'workspace-write'
  | 'danger-full-access'

export const CODEX_RETRY_CUSTOM_ID_PREFIX = 'codex_retry:'

export function buildCodexRetryCustomId(
  sandboxMode: CodexSandboxMode | 'cancel',
): string {
  return `${CODEX_RETRY_CUSTOM_ID_PREFIX}${sandboxMode}`
}

export function parseCodexRetryCustomId(
  customId: string,
): CodexSandboxMode | 'cancel' | undefined {
  if (!customId.startsWith(CODEX_RETRY_CUSTOM_ID_PREFIX)) {
    return undefined
  }
  const value = customId.slice(CODEX_RETRY_CUSTOM_ID_PREFIX.length)
  if (
    value === 'read-only' ||
    value === 'workspace-write' ||
    value === 'danger-full-access' ||
    value === 'cancel'
  ) {
    return value
  }
  return undefined
}

export async function showCodexRetryButtons({
  thread,
  context,
}: {
  thread: ThreadChannel
  context: string
}): Promise<void> {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildCodexRetryCustomId('read-only'))
      .setLabel('Retry Read-Only')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(buildCodexRetryCustomId('workspace-write'))
      .setLabel('Retry Workspace-Write')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(buildCodexRetryCustomId('danger-full-access'))
      .setLabel('Retry Full Access')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(buildCodexRetryCustomId('cancel'))
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary),
  )

  await thread.send({
    content: `Codex hit a sandbox restriction.\n${context}\nChoose how to retry the last prompt:`,
    components: [row],
  })
}
