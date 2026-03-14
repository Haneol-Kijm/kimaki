import { describe, expect, test } from 'vitest'
import { buildCodexPrompt } from './codex-prompt.js'

describe('buildCodexPrompt', () => {
  test('includes critique guidance when enabled', () => {
    const prompt = buildCodexPrompt({
      prompt: 'Fix the bug.',
      includeCritiqueInstructions: true,
    })

    expect(prompt).toContain('bunx critique --web')
    expect(prompt).toContain('Do not tell the user to run `/diff`; use critique directly.')
    expect(prompt).toContain('plain text, not a markdown link')
  })

  test('omits critique guidance when disabled', () => {
    const prompt = buildCodexPrompt({
      prompt: 'Fix the bug.',
      includeCritiqueInstructions: false,
    })

    expect(prompt).not.toContain('bunx critique --web')
    expect(prompt).not.toContain('Do not tell the user to run `/diff`; use critique directly.')
  })
})
