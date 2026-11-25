export type DisclosureTelemetryEvent =
  | { type: 'session-open'; presetId: string; mode: string; surfaceHash: string; shell: string | null }
  | { type: 'search'; resultCount: number; fallback: boolean; durationMs: number }
  | { type: 'describe'; toolNames: string[]; resultBytes: number }
  | { type: 'schema-change'; toolName: string }
  | { type: 'fallback'; reason: string }
  | { type: 'surface-conflict'; owner: string; reason: string }

export interface TelemetrySink { record(event: DisclosureTelemetryEvent): void }
