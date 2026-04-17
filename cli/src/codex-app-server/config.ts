export function isExperimentalCodexAppServerEnabled(): boolean {
  return process.env['KIMAKI_EXPERIMENTAL_CODEX_APP_SERVER'] === '1'
}

export function getExperimentalCodexHome(): string | undefined {
  return process.env['KIMAKI_EXPERIMENTAL_CODEX_HOME']
    || process.env['CODEX_HOME']
    || undefined
}
