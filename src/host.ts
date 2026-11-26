import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-ptc-runtime'
import { renderToolsSdk, type ToolSdkSchema } from '@deepseek-ai/dsh-tool-executor-ptc'
import { defineTool, projectToolSchema, RUN_CODE_NAME, type ResolvedToolSet, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { DESCRIBE_TOOLS_NAME, INVOKE_TOOL_NAME, SEARCH_TOOLS_NAME, type ResolvedConfig } from './config.ts'
import { rankCatalog } from './discovery.ts'
import { SurfaceManager } from './surface.ts'
import { canonicalJsonHash } from './hash.ts'
import { registerDisclosureHistory } from './disclosure-history.ts'
import { ToolSchemaChangedError } from './invocation.ts'
import { registerSurfaceHistory } from './surface-history.ts'
import { readSurfaceRecord, writeSurfaceRecord } from './surface-store.ts'
import { SessionTelemetry, sessionOpenEvent, telemetryBytes } from './telemetry.ts'

const INFRASTRUCTURE_NAMES = new Set([RUN_CODE_NAME, SEARCH_TOOLS_NAME, DESCRIBE_TOOLS_NAME, INVOKE_TOOL_NAME])

function renderJson(_args: unknown, value: unknown): { type: 'text'; text: string }[] {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

function sdkSchema(definition: ToolDefinition): ToolSdkSchema {
  return {
    ...projectToolSchema(definition, true),
    output: structuredClone(definition.output.schema),
  }
}

function schemaHash(schema: ToolSdkSchema): string {
  return canonicalJsonHash({ parameters: schema.parameters, output: schema.output })
}

interface SearchCursor {
  version: 1
  query: string
  namespace?: string
  fingerprint: string
  offset: number
}

function encodeCursor(cursor: SearchCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

function decodeCursor(value: string): SearchCursor {
  try {
    const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<SearchCursor>
    if (cursor.version !== 1 || typeof cursor.query !== 'string' || typeof cursor.fingerprint !== 'string'
      || (cursor.namespace !== undefined && typeof cursor.namespace !== 'string')
      || !Number.isSafeInteger(cursor.offset) || (cursor.offset as number) < 0) {
      throw new Error('invalid cursor payload')
    }
    return cursor as SearchCursor
  } catch {
    throw new Error('INVALID_SEARCH_CURSOR: restart Search without a cursor')
  }
}

function liveCatalog(ctx: Context, agent: Agent | undefined, toolSet: ResolvedToolSet | undefined): ToolSdkSchema[] {
  return ctx.tools.definitions(agent, toolSet)
    .filter(definition => !INFRASTRUCTURE_NAMES.has(definition.name))
    .map(sdkSchema)
    .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
}

function renderSdk(ctx: Context, schemas: readonly ToolSdkSchema[]): string {
  const runtime = ctx.get('ptcRuntime')
  if (runtime === undefined || runtime.language !== 'typescript') {
    throw new Error('stable-progressive-tools P0 requires a TypeScript PTC runtime')
  }
  return renderToolsSdk(schemas, runtime.programFormat)
}

function safeErrorReason(operation: 'search' | 'describe' | 'surface', error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (operation === 'search') {
    if (message.includes('maxQueryChars')) return 'query-too-long'
    if (message.includes('limit must be positive')) return 'invalid-limit'
    if (message.includes('SEARCH_CURSOR_MISMATCH')) return 'cursor-mismatch'
    if (message.includes('TOOL_CATALOG_CHANGED')) return 'catalog-changed'
    if (message.includes('INVALID_SEARCH_CURSOR')) return 'invalid-cursor'
    return 'search-failed'
  }
  if (operation === 'describe') {
    if (message.includes('names must not be empty')) return 'empty-names'
    if (message.includes('unknown or unavailable tool')) return 'unknown-or-unavailable-tool'
    return 'describe-failed'
  }
  if (message.includes('Configured eager tool')) return 'eager-tool-unavailable'
  if (message.includes('Configured shell tool')) return 'shell-unavailable'
  if (message.includes('restoration failed')) return 'restoration-failed'
  if (message.includes('persistence failed')) return 'persistence-failed'
  return 'surface-failed'
}

export async function installStablePtc(ctx: Context, config: ResolvedConfig): Promise<void> {
  const disclosureHistory = await registerDisclosureHistory(ctx)
  const surfaceHistory = await registerSurfaceHistory(ctx)
  const telemetry = new SessionTelemetry(config.telemetry.sampleSuccessRate)
  const searchTool = defineTool({
    name: SEARCH_TOOLS_NAME,
    description: 'Search the live tool catalog by exact names and description words without changing tool permissions.',
    parameters: {
      query: { type: 'string', description: 'Optional case-insensitive name or description query.' },
      namespace: { type: 'string', description: 'Optional exact namespace prefix.' },
      limit: { type: 'integer', description: 'Optional maximum number of results.' },
      cursor: { type: 'string', description: 'Opaque nextCursor from an earlier page of the same Search.' },
    },
    output: {
      schema: { type: 'json' },
      render: renderJson,
    },
    isConcurrencySafe: () => true,
    execute(args, exec) {
      const started = performance.now()
      try {
      if (args.query !== undefined && args.query.length > config.maxQueryChars) {
        throw new Error(`search_tools query exceeds maxQueryChars (${config.maxQueryChars})`)
      }
      const query = args.query?.trim().toLocaleLowerCase('en-US') ?? ''
      const requestedLimit = args.limit ?? config.maxSearchResults
      if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) throw new Error('search_tools limit must be positive')
      const limit = Math.min(requestedLimit, config.maxSearchResults)
      const catalog = liveCatalog(ctx, exec.agent, exec.toolSet)
      const fingerprint = canonicalJsonHash(catalog)
      let offset = 0
      if (args.cursor !== undefined) {
        const cursor = decodeCursor(args.cursor)
        if (cursor.query !== query || cursor.namespace !== args.namespace) {
          throw new Error('SEARCH_CURSOR_MISMATCH: restart Search with the intended query and namespace')
        }
        if (cursor.fingerprint !== fingerprint) {
          throw new Error('TOOL_CATALOG_CHANGED: catalog changed; restart Search without a cursor')
        }
        offset = cursor.offset
      }
      const all = rankCatalog(catalog, { query, ...args.namespace === undefined ? {} : { namespace: args.namespace } })
      const matches = all.length > 0 || query.length === 0 || query === '*' || config.zeroMatch === 'empty'
        ? all
        : catalog
      if (offset > matches.length) throw new Error('INVALID_SEARCH_CURSOR: cursor offset exceeds the result set')
      const results = matches.slice(offset, offset + limit).map(tool => ({
        name: tool.name,
        summary: tool.description.slice(0, config.maxSummaryChars),
        schemaHash: schemaHash(tool),
      }))
      const nextOffset = offset + results.length
      const result = {
        results,
        total: matches.length,
        fallback: matches !== all,
        ...nextOffset < matches.length ? {
          nextCursor: encodeCursor({ version: 1, query, ...args.namespace === undefined ? {} : { namespace: args.namespace }, fingerprint, offset: nextOffset }),
        } : {},
      }
      if (exec.agent !== undefined) {
        const durationMs = performance.now() - started
        const resultBytes = telemetryBytes(result)
        telemetry.record(exec.agent.session, {
          type: 'search',
          resultCount: result.results.length,
          totalCount: result.total,
          durationMs,
          resultBytes,
          schemaHashes: result.results.map(item => item.schemaHash),
          fallback: result.fallback,
        })
        if (result.fallback) {
          telemetry.record(exec.agent.session, {
            type: 'fallback', operation: 'search', reason: 'zero-match-catalog', durationMs, resultCount: result.results.length, resultBytes,
          })
        }
      }
      return Promise.resolve(result)
      } catch (error) {
        if (exec.agent !== undefined) {
          telemetry.record(exec.agent.session, {
            type: 'error', operation: 'search', reason: safeErrorReason('search', error), durationMs: performance.now() - started,
          })
        }
        throw error
      }
    },
  })

  const describeTool = defineTool({
    name: DESCRIBE_TOOLS_NAME,
    description: 'Return complete input and output schemas and SDK excerpts for exact tool names.',
    parameters: {
      names: { type: 'array', required: true, items: { type: 'string' }, description: 'Exact live tool names.' },
    },
    output: {
      schema: { type: 'json' },
      render: renderJson,
      presentationMeta: (_args, value) => {
        const disclosure = value as { tools: { name: string; schemaHash: string }[] }
        return { tools: disclosure.tools.map(tool => ({ name: tool.name, schemaHash: tool.schemaHash })) }
      },
    },
    isConcurrencySafe: () => true,
    execute(args, exec) {
      const started = performance.now()
      try {
      if (args.names.length === 0) throw new Error('describe_tools names must not be empty')
      const byName = new Map(liveCatalog(ctx, exec.agent, exec.toolSet).map(tool => [tool.name, tool]))
      const selected = [...new Set(args.names)].map(name => {
        const tool = byName.get(name)
        if (tool === undefined) throw new Error('describe_tools received unknown or unavailable tool: ' + JSON.stringify(name))
        return tool
      })
      const result = {
        tools: selected.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: structuredClone(tool.parameters) as JsonValue,
          outputSchema: structuredClone(tool.output) as JsonValue,
          sdkExcerpt: renderSdk(ctx, [tool]),
          schemaHash: schemaHash(tool),
        })),
      }
      if (exec.agent !== undefined) {
        telemetry.record(exec.agent.session, {
          type: 'describe',
          requestedCount: args.names.length,
          resultCount: result.tools.length,
          durationMs: performance.now() - started,
          resultBytes: telemetryBytes(result),
          schemaHashes: result.tools.map(tool => tool.schemaHash),
        })
      }
      return Promise.resolve(result)
      } catch (error) {
        if (exec.agent !== undefined) {
          telemetry.record(exec.agent.session, {
            type: 'error', operation: 'describe', reason: safeErrorReason('describe', error), durationMs: performance.now() - started,
          })
        }
        throw error
      }
    },
  })

  const isStableSurfaceEnabled = (agent: Agent): boolean =>
    config.activation.includeSubagents || agent.session.header.origin !== 'subagent'
  ctx.tools.register(searchTool, { when: ({ agent }) => isStableSurfaceEnabled(agent) })
  ctx.tools.register(describeTool, { when: ({ agent }) => isStableSurfaceEnabled(agent) })
  const surfaces = new SurfaceManager(config)

  ctx.tools.guard(exec => {
    if (exec.parent === undefined || exec.agent === undefined) return
    const disclosures = disclosureHistory.stateOf(exec.agent.session)
    if (!Object.hasOwn(disclosures, exec.name)) return
    const expected = disclosures[exec.name]
    if (expected === undefined) return
    const live = ctx.tools.get(exec.name, exec.agent, exec.toolSet)
    if (live === undefined || schemaHash(sdkSchema(live)) === expected) return
    const error = new ToolSchemaChangedError(exec.name)
    telemetry.record(exec.agent.session, {
      type: 'schema-change', toolName: exec.name, oldSchemaHash: expected, newSchemaHash: schemaHash(sdkSchema(live)),
    })
    return {
      reason: 'TOOL_SCHEMA_CHANGED: ' + error.message,
      info: { name: error.name, code: 'TOOL_SCHEMA_CHANGED' },
    }
  })

  const ensureSurface = async (agent: Agent, signal?: AbortSignal) => {
    const existing = surfaces.get(agent.session.id)
    if (existing !== undefined) return existing
    const history = surfaceHistory.stateOf(agent.session)
    try {
      const record = await readSurfaceRecord(agent.session)
      let surface = record === undefined ? undefined : surfaces.restore({
        sessionId: agent.session.id,
        cacheEpoch: history.cacheEpoch,
        surfaceHash: record.surfaceHash,
        ...record.surface,
      })
      if (surface === undefined) {
        if (history.hasPresentationHistory) {
          throw new Error('Stable Surface restoration failed: recovery record is missing from existing history')
        }
        const modelSelection = agent.model.current()
        if (modelSelection === undefined) throw new Error('Stable Surface creation requires a selected model')
        const toolSet = await ctx.tools.resolve({
          agent,
          modelSelection,
          signal: signal ?? new AbortController().signal,
        })
        try {
          for (const expected of [searchTool, describeTool]) {
            const current = ctx.tools.get(expected.name, agent, toolSet)
            if (current !== expected) {
              telemetry.record(agent.session, { type: 'surface-conflict', owner: 'discovery', reason: 'unavailable-or-shadowed', action: 'fail' })
              throw new Error('stable-progressive-tools discovery tool is unavailable or shadowed: ' + expected.name)
            }
          }
          const declarations = ctx.tools.definitions(agent, toolSet)
            .filter(definition => definition.name !== RUN_CODE_NAME && definition.name !== INVOKE_TOOL_NAME)
            .map(sdkSchema)
          surface = surfaces.open({
            sessionId: agent.session.id,
            presetId: 'stable-ptc-eval',
            origin: agent.session.header.origin === 'subagent' ? 'subagent' : 'user',
            mode: 'code',
            platform: process.platform,
            availableTools: declarations.map(declaration => declaration.name),
            declarations,
            programFormat: ctx.get('ptcRuntime')?.programFormat ?? 'function-body',
          })
        } finally {
          toolSet.dispose()
        }
      }
      if (surface === undefined) return undefined
      // Every new or inherited Surface is committed before its first model assembly.
      await writeSurfaceRecord(agent.session, surface)
      telemetry.record(agent.session, sessionOpenEvent(surface))
      return surface
    } catch (error) {
      telemetry.record(agent.session, { type: 'error', operation: 'surface', reason: safeErrorReason('surface', error) })
      surfaces.close(agent.session.id)
      throw error
    }
  }

  ctx.on('agent/created', async ({ agent, signal }) => {
    if (isStableSurfaceEnabled(agent)) await ensureSurface(agent, signal)
  })

  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembly = await next()
    const agent = context.agent
    if (agent === undefined || !isStableSurfaceEnabled(agent)) return assembly
    const sdkIndex = assembly.sections.findIndex(section => section.name === 'tools:sdk')
    if (sdkIndex < 0) {
      queueMicrotask(() => {
        telemetry.record(agent.session, { type: 'surface-conflict', owner: 'tools:sdk', reason: 'missing-section', action: 'return-original' })
      })
      return assembly
    }
    const surface = surfaces.get(agent.session.id)
    if (surface === undefined) throw new Error('Stable Surface is not initialized for this Agent')
    const history = surfaceHistory.stateOf(agent.session)
    const current = surfaces.syncEpoch(agent.session.id, history.cacheEpoch) ?? surface
    return {
      ...assembly,
      sections: assembly.sections.map((section, index) => index === sdkIndex ? { ...section, text: current.sdkText } : section),
    }
  }, { prepend: true })
}
