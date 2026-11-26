import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import type {} from '@deepseek-ai/dsh-compaction'
import type { ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
import { compactedEpoch } from './cache-guard.ts'

interface SurfaceHistoryState {
  cacheEpoch: string
  hasPresentationHistory: boolean
}

const stateSchema = z.custom<SurfaceHistoryState>(value => {
  if (typeof value !== 'object' || value === null) return false
  const state = value as Record<string, unknown>
  return typeof state.cacheEpoch === 'string' && typeof state.hasPresentationHistory === 'boolean'
})

/** Rebuild Cache Epoch and presentation history from the real Session log. */
export function registerSurfaceHistory(ctx: Context): Promise<ProjectionHandle<SurfaceHistoryState>> {
  return ctx.sessionProjections.register({
    key: 'stableProgressiveSurface',
    stateVersion: 1,
    stateSchema,
    init: header => ({ cacheEpoch: 'session:' + header.id, hasPresentationHistory: false }),
    apply(state, event) {
      if (event.type === 'system/message') {
        return state.hasPresentationHistory ? state : { ...state, hasPresentationHistory: true }
      }
      if (event.type === 'compaction/start') {
        return { ...state, cacheEpoch: compactedEpoch(state, event.data.compactionId) }
      }
      return state
    },
  })
}
