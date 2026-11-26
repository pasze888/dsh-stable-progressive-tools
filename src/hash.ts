import { createHash } from 'node:crypto'

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, unknown] => entry[1] !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    return Object.fromEntries(entries.map(([key, child]) => [key, canonicalize(child)]))
  }
  return value
}

/** Hash equivalent JSON data identically, regardless of object key order. */
export function canonicalJsonHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
}
