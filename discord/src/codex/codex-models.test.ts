import { describe, expect, test } from 'vitest'
import {
  getCodexReasoningOptions,
  parseCodexConfigHints,
  toCodexCliModel,
} from './codex-models.js'

describe('Codex model options', () => {
  test('parses model hints from ~/.codex/config.toml content', () => {
    expect(parseCodexConfigHints(`
model = "gpt-5.4"
model_reasoning_effort = "xhigh"

[notice.model_migrations]
"gpt-5.1" = "gpt-5.3-codex"
`)).toEqual({
      model: 'gpt-5.4',
      modelReasoningEffort: 'xhigh',
      migratedModels: ['gpt-5.3-codex'],
    })
  })

  test('strips codex namespace before passing models to the CLI', () => {
    expect(toCodexCliModel('codex/gpt-5.4')).toBe('gpt-5.4')
  })

  test('only shows xhigh for models that should support it', () => {
    expect(
      getCodexReasoningOptions({ modelId: 'codex/gpt-5.4' }).map((option) => option.id),
    ).toContain('xhigh')
    expect(
      getCodexReasoningOptions({ modelId: 'codex/gpt-5' }).map((option) => option.id),
    ).not.toContain('xhigh')
  })
})
