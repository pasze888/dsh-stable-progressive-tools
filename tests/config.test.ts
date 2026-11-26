import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.ts'

describe('resolveConfig', () => {
  it('uses preset-scoped PTC defaults without retired budgets or modes', () => {
    expect(resolveConfig()).toEqual({
      activation: { includeSubagents: false },
      eagerTools: [],
      shellTool: 'auto',
      maxSearchResults: 10,
      maxSummaryChars: 240,
      maxQueryChars: 500,
      zeroMatch: 'catalog',
    })
  })

  it('rejects duplicate and reserved eager tools', () => {
    expect(() => resolveConfig({ eagerTools: ['read', 'read'] })).toThrow(/duplicates/)
    expect(() => resolveConfig({ eagerTools: ['run_code'] })).toThrow(/infrastructure/)
  })

  it('rejects invalid Search budgets', () => {
    expect(() => resolveConfig({ maxSearchResults: 0 })).toThrow(/positive safe integer/)
    expect(() => resolveConfig({ maxSummaryChars: 0 })).toThrow(/positive safe integer/)
    expect(() => resolveConfig({ maxQueryChars: 0 })).toThrow(/positive safe integer/)
  })
})
