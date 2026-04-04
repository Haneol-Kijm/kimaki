// /restart command - Restart the bot without attempting a package upgrade.
// On systemd-managed installs we exit via SIGTERM so the service restarts us.
// On standalone runs we use SIGUSR2 so Kimaki respawns itself.

import type { CommandContext } from './types.js'
import { SILENT_MESSAGE_FLAGS } from '../discord-utils.js'
import { createLogger, LogPrefix } from '../logger.js'
import { getCurrentVersion } from '../upgrade.js'

const logger = createLogger(LogPrefix.CLI)

function getRestartSignal(): NodeJS.Signals {
  return process.env['INVOCATION_ID'] ? 'SIGTERM' : 'SIGUSR2'
}

export async function handleRestartCommand({
  command,
}: CommandContext): Promise<void> {
  await command.deferReply({ flags: SILENT_MESSAGE_FLAGS })

  logger.log('[RESTART] /restart triggered')

  const currentVersion = getCurrentVersion()
  const signal = getRestartSignal()

  await command.editReply({
    content: `Restarting kimaki v${currentVersion}...`,
  })

  setTimeout(() => {
    try {
      logger.log(`[RESTART] sending ${signal} to current process`)
      process.kill(process.pid, signal)
    } catch (error) {
      logger.error(
        '[RESTART] Failed:',
        error instanceof Error ? error.message : String(error),
      )
    }
  }, 500)
}
