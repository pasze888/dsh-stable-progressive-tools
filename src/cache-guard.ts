import type { SessionSurface } from './surface.ts'

export class SurfaceDriftError extends Error {
  constructor() {
    super('The tool surface changed inside a stable cache epoch')
    this.name = 'SurfaceDriftError'
  }
}

export function assertSurfaceContinuity(expected: SessionSurface, actual: SessionSurface): void {
  if (expected.surfaceHash !== actual.surfaceHash || expected.cacheEpoch !== actual.cacheEpoch) {
    throw new SurfaceDriftError()
  }
}

/** Compaction may explicitly create a new epoch; ordinary requests must not. */
export function compactedEpoch(surface: Pick<SessionSurface, 'cacheEpoch'>, compactionId: string): string {
  return surface.cacheEpoch + ':compaction:' + compactionId
}
