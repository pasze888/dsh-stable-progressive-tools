import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Session } from '@deepseek-ai/dsh-session'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { SessionSurface } from './surface.ts'

export type DisclosureTelemetryEvent =
  | {
    type: 'session-open'
    presetId: string
    mode: string
    surfaceHash: string
    cacheEpoch: string
    requestedShell: string
    selectedShell: string | null
  }
  | {
    type: 'search'
    resultCount: number
    totalCount: number
    durationMs: number
    resultBytes: number
    schemaHashes: string[]
    fallback: boolean
  }
  | {
    type: 'describe'
    requestedCount: number
    resultCount: number
    durationMs: number
    resultBytes: number
    schemaHashes: string[]
  }
  | { type: 'schema-change'; toolName: string; oldSchemaHash: string; newSchemaHash: string }
  | { type: 'fallback'; operation: 'search'; reason: 'zero-match-catalog'; durationMs: number; resultCount: number; resultBytes: number }
  | { type: 'surface-conflict'; owner: 'tools:sdk' | 'discovery'; reason: 'missing-section' | 'unavailable-or-shadowed'; action: 'return-original' | 'fail' }
  | { type: 'error'; operation: 'search' | 'describe' | 'surface'; reason: string; durationMs?: number }

export interface TelemetrySink { record(session: Session, event: DisclosureTelemetryEvent): void }

/** SDK-observable, log-only Telemetry with success-only sampling and field allowlists. */
export class SessionTelemetry implements TelemetrySink {
  constructor(private readonly sampleSuccessRate: number, private readonly random: () => number = Math.random) {}

  record(session: Session, event: DisclosureTelemetryEvent): void {
    if ((event.type === 'search' || event.type === 'describe') && this.random() >= this.sampleSuccessRate) return
    const target = join(dshHomePath('stable-progressive-tools', 'telemetry'), Buffer.from(session.id, 'utf8').toString('base64url') + '.jsonl')
    try {
      mkdirSync(dirname(target), { recursive: true })
      appendFileSync(target, JSON.stringify(event) + '\n')
    } catch {
      // Telemetry is non-authoritative and must never replace the Session's own outcome.
    }
  }
}

export function sessionOpenEvent(surface: SessionSurface): DisclosureTelemetryEvent {
  return {
    type: 'session-open',
    presetId: surface.presetId,
    mode: surface.mode,
    surfaceHash: surface.surfaceHash,
    cacheEpoch: surface.cacheEpoch,
    requestedShell: surface.shell.requested,
    selectedShell: surface.shell.selected,
  }
}

export function telemetryBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value, null, 2), 'utf8')
}
