import { describe, expect, it } from 'vitest'
import { createSurfaceManager } from '../src/index.ts'
import { assertSurfaceContinuity } from '../src/cache-guard.ts'

const input = {
  sessionId: 'session-a',
  presetId: 'stable-ptc-eval',
  origin: 'user' as const,
  mode: 'code' as const,
  platform: 'linux',
  availableTools: ['read', 'grep', 'bash'],
}

describe('SurfaceManager', () => {
  it('pins shell, eager tools and SDK inputs for the session', () => {
    const manager = createSurfaceManager({ eagerTools: ['read', 'grep'] })
    const first = manager.open(input)!
    const second = manager.open({ ...input, availableTools: [] })
    expect(first.eagerTools).toEqual(['bash', 'grep', 'read'])
    expect(first.shell.selected).toBe('bash')
    expect(second).toBe(first)
    expect(() => assertSurfaceContinuity(first, second!)).not.toThrow()
  })

  it('shares surface hashes but not cache epochs across sessions', () => {
    const manager = createSurfaceManager()
    const first = manager.open(input)!
    const second = manager.open({ ...input, sessionId: 'session-b' })!
    expect(first.surfaceHash).toBe(second.surfaceHash)
    expect(first.cacheEpoch).not.toBe(second.cacheEpoch)
  })

  it('activates only selected presets and excludes subagents by default', () => {
    const manager = createSurfaceManager()
    expect(manager.open({ ...input, presetId: 'ptc' })).toBeUndefined()
    expect(manager.open({ ...input, origin: 'subagent' })).toBeUndefined()
  })
})
