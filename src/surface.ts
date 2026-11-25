import { createHash } from 'node:crypto'
import type { ResolvedConfig } from './config.ts'
import { resolveShell, type ShellResolution } from './shell.ts'

export const DISCLOSURE_PROTOCOL_VERSION = 1
export const STABLE_DISCLOSURE_PROMPT = [
  'Use search_tools to discover non-eager tools and describe_tools to load exact schemas before use.',
  'In Code mode, return discovery results from run_code so they become visible in the next model step.',
  'Discovery never grants permission; the live ToolRuntime remains authoritative.',
].join('\n')

export type PresentationMode = 'native' | 'code' | 'both'

export interface OpenSessionInput {
  sessionId: string
  presetId: string
  origin: 'user' | 'subagent'
  mode: PresentationMode
  platform: string
  availableTools: readonly string[]
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
}

function hashSurface(input: Omit<SessionSurface, 'surfaceHash' | 'cacheEpoch' | 'sessionId' | 'presetId'>): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex')
}

/** Owns immutable session surfaces; the live tool catalog is deliberately absent from this interface. */
export class SurfaceManager {
  private readonly surfaces = new Map<string, SessionSurface>()

  constructor(readonly config: ResolvedConfig) {}

  open(input: OpenSessionInput): SessionSurface | undefined {
    const existing = this.surfaces.get(input.sessionId)
    if (existing) return existing
    if (!this.config.activation.enabledPresets.includes(input.presetId)) return undefined
    if (input.origin === 'subagent' && !this.config.activation.includeSubagents) return undefined

    const shell = resolveShell(this.config.shellTool, input)
    const eagerTools = Object.freeze([...this.config.eagerTools, ...shell.eager && shell.selected ? [shell.selected] : []].sort())
    const fixed = {
      mode: input.mode,
      protocolVersion: DISCLOSURE_PROTOCOL_VERSION,
      eagerTools,
      shell,
      prompt: STABLE_DISCLOSURE_PROMPT,
    }
    const surface: SessionSurface = Object.freeze({
      sessionId: input.sessionId,
      presetId: input.presetId,
      ...fixed,
      cacheEpoch: 'session:' + input.sessionId,
      surfaceHash: hashSurface(fixed),
    })
    this.surfaces.set(input.sessionId, surface)
    return surface
  }

  get(sessionId: string): SessionSurface | undefined { return this.surfaces.get(sessionId) }
  close(sessionId: string): boolean { return this.surfaces.delete(sessionId) }
}
