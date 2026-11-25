export type ShellTool = 'bash' | 'pwsh'
export type ShellPreference = 'auto' | ShellTool | 'none'

export interface ShellEnvironment { platform: string; availableTools: readonly string[] }
export interface ShellResolution {
  requested: ShellPreference
  selected: ShellTool | null
  eager: boolean
  reason: 'explicit' | 'platform-default' | 'only-available' | 'disabled' | 'unavailable'
}

export class ShellConfigurationError extends Error {
  constructor(readonly tool: ShellTool) {
    super('Configured shell tool is not available: ' + tool)
    this.name = 'ShellConfigurationError'
  }
}

/** Resolve once at session creation; never rerun to mutate a live surface. */
export function resolveShell(requested: ShellPreference, env: ShellEnvironment): ShellResolution {
  if (requested === 'none') return { requested, selected: null, eager: false, reason: 'disabled' }
  const available = new Set(env.availableTools)
  if (requested !== 'auto') {
    if (!available.has(requested)) throw new ShellConfigurationError(requested)
    return { requested, selected: requested, eager: true, reason: 'explicit' }
  }
  const hasBash = available.has('bash')
  const hasPwsh = available.has('pwsh')
  const preferred: ShellTool = env.platform === 'win32' ? 'pwsh' : 'bash'
  if (available.has(preferred)) return { requested, selected: preferred, eager: true, reason: 'platform-default' }
  if (hasBash !== hasPwsh) {
    return { requested, selected: hasBash ? 'bash' : 'pwsh', eager: true, reason: 'only-available' }
  }
  return { requested, selected: null, eager: false, reason: 'unavailable' }
}
