import { ChannelType, type TextChannel, type ThreadChannel } from 'discord.js'
import {
  getChannelBackend,
  getThreadBackend,
  getThreadSession,
  type SessionBackend,
} from './database.js'
import { resolveTextChannel } from './discord-utils.js'

export const DEFAULT_SESSION_BACKEND: SessionBackend = 'opencode'

export async function resolveThreadBackend({
  threadId,
  channelId,
}: {
  threadId: string
  channelId?: string
}): Promise<SessionBackend> {
  const persistedThreadBackend = await getThreadBackend(threadId)
  if (persistedThreadBackend) {
    return persistedThreadBackend
  }

  const existingSessionId = await getThreadSession(threadId)
  if (existingSessionId) {
    return 'opencode'
  }

  if (!channelId) {
    return DEFAULT_SESSION_BACKEND
  }

  return (await getChannelBackend(channelId)) || DEFAULT_SESSION_BACKEND
}

export async function resolveChannelBackendOrDefault(
  channelId: string,
): Promise<SessionBackend> {
  return (await getChannelBackend(channelId)) || DEFAULT_SESSION_BACKEND
}

export async function resolveChannelLikeBackend(
  channel: TextChannel | ThreadChannel | null | undefined,
): Promise<SessionBackend> {
  if (!channel) {
    return DEFAULT_SESSION_BACKEND
  }

  if (channel.type === ChannelType.GuildText) {
    return resolveChannelBackendOrDefault(channel.id)
  }

  if (
    channel.type === ChannelType.PublicThread ||
    channel.type === ChannelType.PrivateThread ||
    channel.type === ChannelType.AnnouncementThread
  ) {
    const textChannel = await resolveTextChannel(channel)
    return resolveThreadBackend({
      threadId: channel.id,
      channelId: textChannel?.id,
    })
  }

  return DEFAULT_SESSION_BACKEND
}

export function isCodexBackend(
  backend: SessionBackend | undefined,
): backend is 'codex' {
  return backend === 'codex'
}
