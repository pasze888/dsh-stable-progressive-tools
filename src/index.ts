/**
 * Skeleton entry: validates configuration but deliberately performs no
 * model-surface rewrite until the presentation adapters are implemented.
 * @module dsh-stable-progressive-tools
 */
import type { Context } from '@deepseek-ai/cordis'
import { resolveConfig, type Config } from './config.ts'
import { SurfaceManager } from './surface.ts'

export const name = 'stable-progressive-tools'
export const inject: string[] = []

export function apply(_ctx: Context, config: Config): void {
  resolveConfig(config)
}

export function createSurfaceManager(config: Config = {}): SurfaceManager {
  return new SurfaceManager(resolveConfig(config))
}

export * from './config.ts'
export * from './shell.ts'
export * from './surface.ts'
export * from './discovery.ts'
export * from './invocation.ts'
export * from './cache-guard.ts'
export * from './telemetry.ts'
export type * from './adapters/types.ts'
