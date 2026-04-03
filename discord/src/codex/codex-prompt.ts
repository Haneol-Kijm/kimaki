export function buildCodexPrompt({
  prompt,
  username,
  isSlashCommand,
  includeCritiqueInstructions,
}: {
  prompt: string
  username?: string
  isSlashCommand?: boolean
  includeCritiqueInstructions?: boolean
}): string {
  const header = [
    'You are replying inside a Discord thread that is often read on mobile.',
    'Keep the answer concise, scannable, and directly action-oriented.',
    'Mention changed file paths briefly when you make edits.',
    'Do not use markdown links like [label](url); use plain paths or plain URLs instead.',
    'Avoid filler and long preambles.',
  ].join(' ')

  const critiqueInstructions = includeCritiqueInstructions
    ? [
      'If you edit files, run `bunx critique --web` yourself before the final answer and share the resulting critique.work URL.',
      'Do not tell the user to run `/diff`; use critique directly.',
      'Share the critique URL as plain text, not a markdown link.',
      'If there are unrelated changes in the working tree, use `--filter` so the diff only includes files you edited.',
      'Skip critique only for read-only turns with no file edits.',
    ].join(' ')
    : ''

  const userContext = username ? `Discord user: ${username}.` : ''
  const commandContext = isSlashCommand
    ? 'The user triggered this through a Kimaki slash-command queue.'
    : ''

  return [header, critiqueInstructions, userContext, commandContext, '', prompt]
    .filter((part) => part.trim().length > 0)
    .join('\n\n')
}
