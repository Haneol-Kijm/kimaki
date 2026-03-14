export function buildCodexPrompt({
  prompt,
  username,
  isSlashCommand,
}: {
  prompt: string
  username?: string
  isSlashCommand?: boolean
}): string {
  const header = [
    'You are replying inside a Discord thread that is often read on mobile.',
    'Keep the answer concise, scannable, and directly action-oriented.',
    'Mention changed file paths briefly when you make edits.',
    'Avoid filler and long preambles.',
  ].join(' ')

  const userContext = username
    ? `Discord user: ${username}.`
    : ''
  const commandContext = isSlashCommand
    ? 'The user triggered this through a Kimaki slash-command queue.'
    : ''

  return [
    header,
    userContext,
    commandContext,
    '',
    prompt,
  ]
    .filter((part) => part.trim().length > 0)
    .join('\n\n')
}
