import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import type { ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
import { DESCRIBE_TOOLS_NAME } from './config.ts'

const disclosureMetaSchema = z.object({
  tools: z.array(z.object({
    name: z.string().min(1),
    schemaHash: z.string().regex(/^[a-f0-9]{64}$/),
  })),
})

/** Latest disclosed SchemaHash per exact runtime name, replayed from committed PTC history. */
export function registerDisclosureHistory(ctx: Context): Promise<ProjectionHandle<Record<string, string>>> {
  return ctx.sessionProjections.register({
    key: 'stableProgressiveDisclosures',
    stateVersion: 1,
    stateSchema: z.record(z.string(), z.string()),
    init: () => ({}),
    apply(state, event) {
      if (event.type !== 'tool/ptc-dispatch' || event.data.name !== DESCRIBE_TOOLS_NAME || event.data.isError) return state
      let payload: unknown = event.data.meta
      if (payload === undefined) {
        const text = event.data.content.find(block => block.type === 'text')?.text
        if (text === undefined) throw new Error('Legacy describe_tools disclosure has no text content')
        try { payload = JSON.parse(text) }
        catch { throw new Error('Legacy describe_tools disclosure contains invalid JSON') }
      }
      const parsed = disclosureMetaSchema.safeParse(payload)
      if (!parsed.success) throw new Error('Invalid describe_tools disclosure metadata in Session history')
      return Object.fromEntries([
        ...Object.entries(state),
        ...parsed.data.tools.map(tool => [tool.name, tool.schemaHash] as const),
      ])
    },
  })
}
