/**
 * Preset-scoped stable progressive disclosure for TypeScript PTC sessions.
 * @module dsh-stable-progressive-tools
 */
import type { Context } from '@deepseek-ai/cordis'
import { resolveConfig, type Config } from './config.ts'
import { SurfaceManager } from './surface.ts'
import { installStablePtc } from './host.ts'

export const name = 'stable-progressive-tools'
export const inject = ['tools', 'systemPrompt', 'ptcRuntime', 'sessionProjections']

export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  await installStablePtc(ctx, resolveConfig(config))
}

export function createSurfaceManager(config: Config = {}): SurfaceManager {
  return new SurfaceManager(resolveConfig(config))
}

export * from './config.ts'
export * from './shell.ts'
export * from './surface.ts'
export * from './discovery.ts'
export * from './search-recall.ts'
export * from './invocation.ts'
export * from './cache-guard.ts'
export * from './telemetry.ts'
export type * from './adapters/types.ts'
