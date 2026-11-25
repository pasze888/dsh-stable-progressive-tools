import { describe, expect, it } from 'vitest'
import { resolveShell, ShellConfigurationError } from '../src/shell.ts'

describe('resolveShell', () => {
  it.each([
    ['win32', ['pwsh'], 'pwsh'],
    ['win32', ['bash', 'pwsh'], 'pwsh'],
    ['win32', ['bash'], 'bash'],
    ['linux', ['bash'], 'bash'],
    ['linux', ['bash', 'pwsh'], 'bash'],
    ['linux', ['pwsh'], 'pwsh'],
  ])('resolves auto on %s with %s', (platform, availableTools, selected) => {
    expect(resolveShell('auto', { platform, availableTools }).selected).toBe(selected)
  })

  it('keeps auto non-fatal when no shell exists', () => {
    expect(resolveShell('auto', { platform: 'linux', availableTools: [] })).toMatchObject({ selected: null, eager: false })
  })

  it('supports disabling eager shell without disabling discovery', () => {
    expect(resolveShell('none', { platform: 'linux', availableTools: ['bash'] })).toMatchObject({ selected: null, eager: false })
  })

  it('does not silently replace an explicit unavailable shell', () => {
    expect(() => resolveShell('pwsh', { platform: 'linux', availableTools: ['bash'] })).toThrow(ShellConfigurationError)
  })
})
