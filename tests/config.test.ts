import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.ts'

describe('resolveConfig', () => {
  it('uses stable opt-in defaults', () => {
    expect(resolveConfig()).toMatchObject({
      activation: { enabledPresets: ['stable-ptc-eval'], includeSubagents: false },
      shellTool: 'auto',
      zeroMatch: 'catalog',
      cache: { scope: 'session', onConflict: 'fallback' },
    })
  })

  it('rejects duplicate and reserved eager tools', () => {
    expect(() => resolveConfig({ eagerTools: ['read', 'read'] })).toThrow(/duplicates/)
    expect(() => resolveConfig({ eagerTools: ['run_code'] })).toThrow(/infrastructure/)
  })

  it('rejects invalid numeric budgets', () => {
    expect(() => resolveConfig({ maxDescribeTools: 0 })).toThrow(/positive safe integer/)
    expect(() => resolveConfig({ telemetry: { sampleSuccessRate: 1.1 } })).toThrow(/between 0 and 1/)
  })
})
