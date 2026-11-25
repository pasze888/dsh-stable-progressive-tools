export const SEARCH_TOOLS_NAME = 'search_tools'
export const DESCRIBE_TOOLS_NAME = 'describe_tools'
export const INVOKE_TOOL_NAME = 'invoke_tool'
export const RUN_CODE_NAME = 'run_code'

const RESERVED_EAGER_NAMES = new Set([SEARCH_TOOLS_NAME, DESCRIBE_TOOLS_NAME, INVOKE_TOOL_NAME, RUN_CODE_NAME])

export interface Config {
  activation?: { enabledPresets?: string[]; includeSubagents?: boolean }
  eagerTools?: string[]
  shellTool?: 'auto' | 'bash' | 'pwsh' | 'none'
  maxSearchResults?: number
  maxDescribeTools?: number
  maxSummaryChars?: number
  maxQueryChars?: number
  maxResultBytes?: number
  zeroMatch?: 'catalog' | 'empty'
  native?: { fallback?: 'invoke_tool' }
  cache?: {
    scope?: 'session'
    freezeCodeSdk?: boolean
    stablePlanMode?: boolean
    preserveHistory?: boolean
    onConflict?: 'fallback'
  }
  telemetry?: { logQueries?: boolean; sampleSuccessRate?: number }
}

export interface ResolvedConfig {
  activation: { enabledPresets: string[]; includeSubagents: boolean }
  eagerTools: string[]
  shellTool: 'auto' | 'bash' | 'pwsh' | 'none'
  maxSearchResults: number
  maxDescribeTools: number
  maxSummaryChars: number
  maxQueryChars: number
  maxResultBytes: number
  zeroMatch: 'catalog' | 'empty'
  native: { fallback: 'invoke_tool' }
  cache: {
    scope: 'session'
    freezeCodeSdk: boolean
    stablePlanMode: boolean
    preserveHistory: boolean
    onConflict: 'fallback'
  }
  telemetry: { logQueries: boolean; sampleSuccessRate: number }
}

/** Resolve direct-call defaults and reject unstable configuration. Loader schema validation is future work. */
export function resolveConfig(config: Config = {}): ResolvedConfig {
  const resolved: ResolvedConfig = {
    activation: {
      enabledPresets: [...config.activation?.enabledPresets ?? ['stable-ptc-eval']],
      includeSubagents: config.activation?.includeSubagents ?? false,
    },
    eagerTools: [...config.eagerTools ?? []],
    shellTool: config.shellTool ?? 'auto',
    maxSearchResults: config.maxSearchResults ?? 10,
    maxDescribeTools: config.maxDescribeTools ?? 5,
    maxSummaryChars: config.maxSummaryChars ?? 240,
    maxQueryChars: config.maxQueryChars ?? 500,
    maxResultBytes: config.maxResultBytes ?? 1_048_576,
    zeroMatch: config.zeroMatch ?? 'catalog',
    native: { fallback: config.native?.fallback ?? 'invoke_tool' },
    cache: {
      scope: 'session',
      freezeCodeSdk: config.cache?.freezeCodeSdk ?? true,
      stablePlanMode: config.cache?.stablePlanMode ?? true,
      preserveHistory: config.cache?.preserveHistory ?? true,
      onConflict: 'fallback',
    },
    telemetry: {
      logQueries: config.telemetry?.logQueries ?? false,
      sampleSuccessRate: config.telemetry?.sampleSuccessRate ?? 0.1,
    },
  }
  for (const name of resolved.eagerTools) {
    if (name.length === 0) throw new Error('eagerTools cannot contain an empty name')
    if (RESERVED_EAGER_NAMES.has(name)) throw new Error('eagerTools cannot name disclosure infrastructure: ' + name)
  }
  if (new Set(resolved.eagerTools).size !== resolved.eagerTools.length) throw new Error('eagerTools cannot contain duplicates')
  if (new Set(resolved.activation.enabledPresets).size !== resolved.activation.enabledPresets.length) {
    throw new Error('activation.enabledPresets cannot contain duplicates')
  }
  for (const key of ['maxSearchResults', 'maxDescribeTools', 'maxSummaryChars', 'maxQueryChars', 'maxResultBytes'] as const) {
    if (!Number.isSafeInteger(resolved[key]) || resolved[key] < 1) throw new Error(key + ' must be a positive safe integer')
  }
  if (resolved.telemetry.sampleSuccessRate < 0 || resolved.telemetry.sampleSuccessRate > 1) {
    throw new Error('telemetry.sampleSuccessRate must be between 0 and 1')
  }
  return resolved
}
