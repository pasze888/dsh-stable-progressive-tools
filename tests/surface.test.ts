import { describe, expect, it } from 'vitest'
import { createSurfaceManager, SurfaceRestoreError } from '../src/index.ts'
import { assertSurfaceContinuity, compactedEpoch } from '../src/cache-guard.ts'
import { DESCRIBE_TOOLS_NAME, SEARCH_TOOLS_NAME } from '../src/config.ts'
import type { ToolSdkSchema } from '@deepseek-ai/dsh-tool-executor-ptc'

function declaration(name: string): ToolSdkSchema {
  return {
    name,
    description: `Complete declaration for ${name}`,
    parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false },
    output: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false },
  }
}

const declarations = [SEARCH_TOOLS_NAME, DESCRIBE_TOOLS_NAME, 'read', 'grep', 'bash'].map(declaration)

const input = {
  sessionId: 'session-a',
  presetId: 'stable-ptc-eval',
  origin: 'user' as const,
  mode: 'code' as const,
  platform: 'linux',
  availableTools: ['read', 'grep', 'bash'],
  declarations,
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

  it('freezes complete eager declarations and their rendered SDK text', () => {
    const manager = createSurfaceManager({ eagerTools: ['read'], shellTool: 'none' })
    const surface = manager.open(input)!
    expect(surface.sdkText).toContain('Complete declaration for read')
    expect(surface.sdkText).toContain('value: string;')
    expect(surface.sdkText).not.toContain('Complete declaration for grep')
    expect(surface.declarations.map(tool => tool.name)).toEqual([DESCRIBE_TOOLS_NAME, 'read', SEARCH_TOOLS_NAME])
  })

  it('does not publish a partial Surface when an eager tool is unavailable', () => {
    const manager = createSurfaceManager({ eagerTools: ['missing'], shellTool: 'none' })
    expect(() => manager.open(input)).toThrow('Configured eager tool is not available: missing')
    expect(manager.get(input.sessionId)).toBeUndefined()
  })

  it('deeply freezes nested Shell and Schema state', () => {
    const manager = createSurfaceManager({ eagerTools: ['read'] })
    const surface = manager.open(input)!
    expect(() => { surface.shell.requested = 'none' }).toThrow(TypeError)
    const read = surface.declarations.find(tool => tool.name === 'read')!
    const properties = (read.parameters as { properties?: Record<string, object> }).properties
    expect(Object.isFrozen(properties)).toBe(true)
    expect(Object.isFrozen(properties?.value)).toBe(true)
  })

  it('hashes canonical declarations independently of object key order', () => {
    const config = { eagerTools: ['read'], shellTool: 'none' as const }
    const first = createSurfaceManager(config).open(input)!
    const reordered = declarations.map(tool => tool.name === 'read' ? {
      output: tool.output,
      parameters: {
        additionalProperties: false,
        required: ['value'],
        properties: { value: { type: 'string' as const } },
        type: 'object' as const,
      },
      description: tool.description,
      name: tool.name,
    } : tool)
    const second = createSurfaceManager(config).open({ ...input, declarations: reordered })!
    expect(second.sdkText).toBe(first.sdkText)
    expect(second.surfaceHash).toBe(first.surfaceHash)
  })

  it('restores the canonical Surface and rejects a mismatched hash', () => {
    const original = createSurfaceManager({ eagerTools: ['read'], shellTool: 'none' }).open(input)!
    const restored = createSurfaceManager({ eagerTools: ['grep'], shellTool: 'auto' }).restore({ ...original, sessionId: 'restored-a' })
    expect(restored.sdkText).toBe(original.sdkText)
    expect(restored.declarations).toEqual(original.declarations)
    expect(() => createSurfaceManager().restore({ ...original, sessionId: 'restored-bad', sdkText: 'changed' }))
      .toThrow(SurfaceRestoreError)
  })

  it('changes only the Cache Epoch after Compaction', () => {
    const manager = createSurfaceManager()
    const first = manager.open(input)!
    expect(manager.syncEpoch(input.sessionId, first.cacheEpoch)).toBe(first)
    const compacted = manager.syncEpoch(input.sessionId, compactedEpoch(first, 'compaction-1'))!
    expect(compacted.cacheEpoch).not.toBe(first.cacheEpoch)
    expect(compacted.sdkText).toBe(first.sdkText)
    expect(compacted.surfaceHash).toBe(first.surfaceHash)
    expect(manager.get(input.sessionId)).toBe(compacted)
    expect(() => assertSurfaceContinuity(first, compacted)).toThrow()
  })

  it('shares surface hashes but not cache epochs across sessions', () => {
    const manager = createSurfaceManager()
    const first = manager.open(input)!
    const second = manager.open({ ...input, sessionId: 'session-b' })!
    expect(first.surfaceHash).toBe(second.surfaceHash)
    expect(first.cacheEpoch).not.toBe(second.cacheEpoch)
  })

  it('leaves preset activation to the host scope and excludes subagents by default', () => {
    const manager = createSurfaceManager()
    expect(manager.open({ ...input, presetId: 'ptc' })?.presetId).toBe('ptc')
    expect(manager.open({ ...input, sessionId: 'child-a', origin: 'subagent' })).toBeUndefined()
  })
})
