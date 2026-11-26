import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Session } from '@deepseek-ai/dsh-session'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { SurfaceRestoreError, type SessionSurface, type SurfacePayload } from './surface.ts'

interface StableSurfaceRecord {
  version: 1
  surfaceHash: string
  surface: SurfacePayload
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validPayload(value: unknown): boolean {
  if (!isObject(value)) return false
  return typeof value.presetId === 'string'
    && ['native', 'code', 'both'].includes(String(value.mode))
    && value.protocolVersion === 1
    && Array.isArray(value.eagerTools) && value.eagerTools.every(name => typeof name === 'string')
    && isObject(value.shell)
    && ['auto', 'bash', 'pwsh', 'none'].includes(String(value.shell.requested))
    && (value.shell.selected === null || ['bash', 'pwsh'].includes(String(value.shell.selected)))
    && typeof value.shell.eager === 'boolean'
    && ['explicit', 'platform-default', 'only-available', 'disabled', 'unavailable'].includes(String(value.shell.reason))
    && typeof value.prompt === 'string'
    && typeof value.sdkText === 'string'
    && typeof value.programFormat === 'string'
    && Array.isArray(value.declarations)
    && value.declarations.every(declaration => isObject(declaration)
      && typeof declaration.name === 'string'
      && typeof declaration.description === 'string'
      && isObject(declaration.parameters)
      && isObject(declaration.output))
}

function validRecord(value: unknown): value is StableSurfaceRecord {
  return isObject(value)
    && value.version === 1
    && typeof value.surfaceHash === 'string'
    && /^[a-f0-9]{64}$/.test(value.surfaceHash)
    && validPayload(value.surface)
}

function recordPath(sessionId: string): string {
  return join(dshHomePath('stable-progressive-tools', 'surfaces'), Buffer.from(sessionId, 'utf8').toString('base64url') + '.json')
}

async function readById(sessionId: string): Promise<StableSurfaceRecord | undefined> {
  let text: string
  try { text = await readFile(recordPath(sessionId), 'utf8') }
  catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes(String((error as NodeJS.ErrnoException).code))) return undefined
    throw new SurfaceRestoreError('Stable Surface restoration failed: cannot read recovery record')
  }
  try {
    const record = JSON.parse(text) as unknown
    if (!validRecord(record)) throw new Error('invalid record')
    return record
  } catch {
    throw new SurfaceRestoreError('Stable Surface restoration failed: invalid recovery record')
  }
}

/** Restore the current Session or the nearest persisted fork ancestor. */
export async function readSurfaceRecord(session: Session): Promise<StableSurfaceRecord | undefined> {
  const visited = new Set<string>()
  let current: string | undefined = session.id
  let parent = session.header.parentSession
  while (current !== undefined) {
    if (visited.has(current)) throw new SurfaceRestoreError('Stable Surface restoration failed: fork ancestry contains a cycle')
    visited.add(current)
    const record = await readById(current)
    if (record !== undefined) return record
    current = parent
    parent = undefined
  }
  return undefined
}

/** Atomically persist every field required for restoration; runtime close never removes it. */
export async function writeSurfaceRecord(session: Session, surface: SessionSurface): Promise<void> {
  const { sessionId: _sessionId, cacheEpoch: _cacheEpoch, surfaceHash, ...payload } = surface
  const record: StableSurfaceRecord = { version: 1, surfaceHash, surface: payload }
  if (!validRecord(record)) throw new SurfaceRestoreError('Stable Surface persistence failed: invalid payload')
  const target = recordPath(session.id)
  const temporary = target + '.' + randomUUID() + '.tmp'
  try {
    await mkdir(dirname(target), { recursive: true })
    await writeFile(temporary, JSON.stringify(record), { flag: 'wx' })
    await rename(temporary, target)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw new SurfaceRestoreError('Stable Surface persistence failed: cannot commit recovery record', { cause: error })
  }
}
