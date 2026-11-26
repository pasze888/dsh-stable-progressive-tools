import type { PtcProgramFormat } from '@deepseek-ai/dsh-ptc-runtime'
import { renderToolsSdk, type ToolSdkSchema } from '@deepseek-ai/dsh-tool-executor-ptc'
import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import { DESCRIBE_TOOLS_NAME, SEARCH_TOOLS_NAME, type ResolvedConfig } from './config.ts'
import { resolveShell, type ShellResolution } from './shell.ts'
import { canonicalJsonHash } from './hash.ts'

export const DISCLOSURE_PROTOCOL_VERSION = 1
export const STABLE_DISCLOSURE_PROMPT = [
  'Use search_tools to discover non-eager tools and describe_tools to load exact schemas when needed.',
  'In Code mode, return discovery results from run_code so they become visible in the next model step.',
  'Discovery never grants permission; the live ToolRuntime remains authoritative.',
].join('\n')

export type PresentationMode = 'native' | 'code' | 'both'

export type SurfacePayload = Omit<SessionSurface, 'sessionId' | 'cacheEpoch' | 'surfaceHash'>

export class SurfaceRestoreError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'SurfaceRestoreError'
  }
}

export interface OpenSessionInput {
  sessionId: string
  presetId: string
  origin: 'user' | 'subagent'
  mode: PresentationMode
  platform: string
  availableTools: readonly string[]
  declarations: readonly ToolSdkSchema[]
  programFormat?: PtcProgramFormat
}

export interface SessionSurface {
  sessionId: string
  presetId: string
  mode: PresentationMode
  protocolVersion: number
  cacheEpoch: string
  surfaceHash: string
  eagerTools: readonly string[]
  shell: ShellResolution
  prompt: string
  declarations: readonly ToolSdkSchema[]
  sdkText: string
  programFormat: PtcProgramFormat
}

function hashSurface(input: Omit<SessionSurface, 'surfaceHash' | 'cacheEpoch' | 'sessionId' | 'presetId'>): string {
  return canonicalJsonHash(input)
}

/** Owns immutable session surfaces; the live tool catalog is deliberately absent after creation. */
export class SurfaceManager {
  private readonly surfaces = new Map<string, SessionSurface>()

  constructor(readonly config: ResolvedConfig) {}

  open(input: OpenSessionInput): SessionSurface | undefined {
    const existing = this.surfaces.get(input.sessionId)
    if (existing) return existing
    if (input.origin === 'subagent' && !this.config.activation.includeSubagents) return undefined

    const shell = resolveShell(this.config.shellTool, input)
    const eagerTools = [...new Set([...this.config.eagerTools, ...shell.eager && shell.selected ? [shell.selected] : []])].sort()
    const requiredNames = new Set([SEARCH_TOOLS_NAME, DESCRIBE_TOOLS_NAME, ...eagerTools])
    const byName = new Map(input.declarations.map(declaration => [declaration.name, declaration]))
    for (const name of eagerTools) {
      if (!input.availableTools.includes(name) || !byName.has(name)) {
        throw new Error('Configured eager tool is not available: ' + name)
      }
    }
    const declarations = [...requiredNames].map(name => {
      const declaration = byName.get(name)
      if (declaration === undefined) throw new Error('Required Surface declaration is not available: ' + name)
      return structuredClone(declaration)
    }).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
    const programFormat = input.programFormat ?? 'function-body'
    const sdkText = STABLE_DISCLOSURE_PROMPT + '\n\n' + renderToolsSdk(declarations, programFormat)
    const fixed = {
      mode: input.mode,
      protocolVersion: DISCLOSURE_PROTOCOL_VERSION,
      eagerTools,
      shell: structuredClone(shell),
      prompt: STABLE_DISCLOSURE_PROMPT,
      declarations,
      sdkText,
      programFormat,
    }
    const surface: SessionSurface = deepFreeze({
      sessionId: input.sessionId,
      presetId: input.presetId,
      ...fixed,
      cacheEpoch: 'session:' + input.sessionId,
      surfaceHash: hashSurface(fixed),
    })
    this.surfaces.set(input.sessionId, surface)
    return surface
  }

  /** Adopt a validated durable payload without consulting current configuration or tool availability. */
  restore(surface: SessionSurface): SessionSurface {
    const existing = this.surfaces.get(surface.sessionId)
    if (existing) return existing
    const { sessionId: _sessionId, cacheEpoch: _cacheEpoch, surfaceHash: _surfaceHash, presetId: _presetId, ...fixed } = surface
    if (hashSurface(fixed) !== surface.surfaceHash) {
      throw new SurfaceRestoreError('Stable Surface restoration failed: SurfaceHash mismatch')
    }
    const restored = deepFreeze(structuredClone(surface))
    this.surfaces.set(surface.sessionId, restored)
    return restored
  }

  /** Advance only the Cache Epoch after a committed Compaction event. */
  syncEpoch(sessionId: string, cacheEpoch: string): SessionSurface | undefined {
    const surface = this.surfaces.get(sessionId)
    if (surface === undefined || surface.cacheEpoch === cacheEpoch) return surface
    const updated = deepFreeze({ ...surface, cacheEpoch })
    this.surfaces.set(sessionId, updated)
    return updated
  }

  get(sessionId: string): SessionSurface | undefined { return this.surfaces.get(sessionId) }
  close(sessionId: string): boolean { return this.surfaces.delete(sessionId) }
}
