import fs from 'node:fs'
import path from 'node:path'
import * as errore from 'errore'
import { getDataDir } from '../config.js'
import { createLogger, LogPrefix } from '../logger.js'

const logger = createLogger(LogPrefix.SESSION)

const DEFAULT_KIMAKI_CODEX_CONFIG = `# Dedicated Codex home for Kimaki Discord sessions.
# This keeps Discord runs isolated from your main ~/.codex state.
model = "gpt-5.4"
model_reasoning_effort = "xhigh"
service_tier = "fast"

[features]
fast_mode = true

# Codex CLI fast mode is configured via config/profile state, not a standalone
# "codex exec --fast" flag. This default keeps Kimaki on the fast service tier.
`

const DEFAULT_DISCORD_PERSONA = `# Kimaki Discord persona
# Put Discord-specific persona/style instructions here.
# Kimaki prepends non-comment lines from this file on every Codex turn.
`

export function getKimakiCodexHome(): string {
  const configuredHome = process.env['KIMAKI_CODEX_HOME']
  if (configuredHome?.trim()) {
    return path.resolve(configuredHome)
  }
  return path.join(getDataDir(), 'codex-home')
}

export function getKimakiCodexConfigPath(): string {
  return path.join(getKimakiCodexHome(), 'config.toml')
}

export function getKimakiCodexPersonaDir(): string {
  return path.join(getKimakiCodexHome(), 'personas')
}

export function getKimakiDiscordPersonaPath(): string {
  return path.join(getKimakiCodexPersonaDir(), 'discord.md')
}

export async function ensureKimakiCodexHomeScaffold(): Promise<void> {
  const codexHome = getKimakiCodexHome()
  const personaDir = getKimakiCodexPersonaDir()
  const configPath = getKimakiCodexConfigPath()
  const personaPath = getKimakiDiscordPersonaPath()

  const mkdirHome = await errore.tryAsync(() => {
    return fs.promises.mkdir(codexHome, { recursive: true })
  })
  if (mkdirHome instanceof Error) {
    logger.warn(`[CODEX] failed to create CODEX_HOME ${codexHome}: ${mkdirHome.message}`)
    return
  }

  const mkdirPersona = await errore.tryAsync(() => {
    return fs.promises.mkdir(personaDir, { recursive: true })
  })
  if (mkdirPersona instanceof Error) {
    logger.warn(
      `[CODEX] failed to create persona dir ${personaDir}: ${mkdirPersona.message}`,
    )
    return
  }

  if (!fs.existsSync(configPath)) {
    const writeConfig = await errore.tryAsync(() => {
      return fs.promises.writeFile(configPath, DEFAULT_KIMAKI_CODEX_CONFIG)
    })
    if (writeConfig instanceof Error) {
      logger.warn(
        `[CODEX] failed to write default config ${configPath}: ${writeConfig.message}`,
      )
    }
  }

  if (!fs.existsSync(personaPath)) {
    const writePersona = await errore.tryAsync(() => {
      return fs.promises.writeFile(personaPath, DEFAULT_DISCORD_PERSONA)
    })
    if (writePersona instanceof Error) {
      logger.warn(
        `[CODEX] failed to write default persona ${personaPath}: ${writePersona.message}`,
      )
    }
  }
}

export async function readKimakiDiscordPersona(): Promise<string> {
  const personaPath = getKimakiDiscordPersonaPath()
  const content = await fs.promises.readFile(personaPath, 'utf8').catch(() => '')
  if (!content) {
    return ''
  }

  return content
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => {
      const trimmed = line.trim()
      return trimmed.length > 0 && !trimmed.startsWith('#')
    })
    .join('\n')
    .trim()
}
