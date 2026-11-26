export const SEARCH_TOOLS_NAME = 'search_tools'
export const DESCRIBE_TOOLS_NAME = 'describe_tools'
export const INVOKE_TOOL_NAME = 'invoke_tool'
export const RUN_CODE_NAME = 'run_code'

const RESERVED_EAGER_NAMES = new Set([SEARCH_TOOLS_NAME, DESCRIBE_TOOLS_NAME, INVOKE_TOOL_NAME, RUN_CODE_NAME])

export interface Config {
  activation?: { includeSubagents?: boolean }
  eagerTools?: string[]
  shellTool?: 'auto' | 'bash' | 'pwsh' | 'none'
  maxSearchResults?: number
  maxSummaryChars?: number
  maxQueryChars?: number
  zeroMatch?: 'catalog' | 'empty'
  telemetry?: { sampleSuccessRate?: number }
}

export interface ResolvedConfig {
  activation: { includeSubagents: boolean }
  eagerTools: string[]
  shellTool: 'auto' | 'bash' | 'pwsh' | 'none'
  maxSearchResults: number
  maxSummaryChars: number
  maxQueryChars: number
  zeroMatch: 'catalog' | 'empty'
  telemetry: { sampleSuccessRate: number }
}

/** Resolve direct-call defaults and reject unstable configuration. */
export function resolveConfig(config: Config = {}): ResolvedConfig {
  const resolved: ResolvedConfig = {
    activation: { includeSubagents: config.activation?.includeSubagents ?? false },
    eagerTools: [...config.eagerTools ?? []],
    shellTool: config.shellTool ?? 'auto',
    maxSearchResults: config.maxSearchResults ?? 10,
    maxSummaryChars: config.maxSummaryChars ?? 240,
    maxQueryChars: config.maxQueryChars ?? 500,
    zeroMatch: config.zeroMatch ?? 'catalog',
    telemetry: { sampleSuccessRate: config.telemetry?.sampleSuccessRate ?? 0.1 },
  }
  for (const name of resolved.eagerTools) {
    if (name.length === 0) throw new Error('eagerTools cannot contain an empty name')
    if (RESERVED_EAGER_NAMES.has(name)) throw new Error('eagerTools cannot name disclosure infrastructure: ' + name)
  }
  if (new Set(resolved.eagerTools).size !== resolved.eagerTools.length) throw new Error('eagerTools cannot contain duplicates')
  for (const key of ['maxSearchResults', 'maxSummaryChars', 'maxQueryChars'] as const) {
    if (!Number.isSafeInteger(resolved[key]) || resolved[key] < 1) throw new Error(key + ' must be a positive safe integer')
  }
  const sampleRate = resolved.telemetry.sampleSuccessRate
  if (!Number.isFinite(sampleRate) || sampleRate < 0 || sampleRate > 1) {
    throw new Error('telemetry.sampleSuccessRate must be between 0 and 1')
  }
  return resolved
}
