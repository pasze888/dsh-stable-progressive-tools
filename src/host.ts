import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-ptc-runtime'
import { renderToolsSdk, type ToolSdkSchema } from '@deepseek-ai/dsh-tool-executor-ptc'
import { defineTool, projectToolSchema, RUN_CODE_NAME, type ResolvedToolSet, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { DESCRIBE_TOOLS_NAME, INVOKE_TOOL_NAME, SEARCH_TOOLS_NAME, type ResolvedConfig } from './config.ts'
import { SurfaceManager } from './surface.ts'
import { canonicalJsonHash } from './hash.ts'
import { registerDisclosureHistory } from './disclosure-history.ts'
import { ToolSchemaChangedError } from './invocation.ts'

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

export async function installStablePtc(ctx: Context, config: ResolvedConfig): Promise<void> {
  const disclosureHistory = await registerDisclosureHistory(ctx)
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
      const all = catalog.filter(tool =>
        (args.namespace === undefined || tool.name.startsWith(args.namespace + '.'))
        && (query.length === 0 || query === '*'
          || tool.name.toLocaleLowerCase('en-US').includes(query)
          || tool.description.toLocaleLowerCase('en-US').includes(query)))
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
      return Promise.resolve({
        results,
        total: matches.length,
        fallback: matches !== all,
        ...nextOffset < matches.length ? {
          nextCursor: encodeCursor({ version: 1, query, ...args.namespace === undefined ? {} : { namespace: args.namespace }, fingerprint, offset: nextOffset }),
        } : {},
      })
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
      if (args.names.length === 0) throw new Error('describe_tools names must not be empty')
      const byName = new Map(liveCatalog(ctx, exec.agent, exec.toolSet).map(tool => [tool.name, tool]))
      const selected = [...new Set(args.names)].map(name => {
        const tool = byName.get(name)
        if (tool === undefined) throw new Error('describe_tools received unknown or unavailable tool: ' + JSON.stringify(name))
        return tool
      })
      return Promise.resolve({
        tools: selected.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: structuredClone(tool.parameters) as JsonValue,
          outputSchema: structuredClone(tool.output) as JsonValue,
          sdkExcerpt: renderSdk(ctx, [tool]),
          schemaHash: schemaHash(tool),
        })),
      })
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
    return {
      reason: 'TOOL_SCHEMA_CHANGED: ' + error.message,
      info: { name: error.name, code: 'TOOL_SCHEMA_CHANGED' },
    }
  })

  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembly = await next()
    const agent = context.agent
    if (agent === undefined || !isStableSurfaceEnabled(agent)) return assembly
    const sdkIndex = assembly.sections.findIndex(section => section.name === 'tools:sdk')
    if (sdkIndex < 0) return assembly
    let surface = surfaces.get(agent.session.id)
    if (surface === undefined) {
      for (const expected of [searchTool, describeTool]) {
        const current = ctx.tools.get(expected.name, agent, context.toolSet)
        if (current !== expected) throw new Error('stable-progressive-tools discovery tool is unavailable or shadowed: ' + expected.name)
      }
      const declarations = ctx.tools.definitions(agent, context.toolSet)
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
      if (surface === undefined) return assembly
    }
    return {
      ...assembly,
      sections: assembly.sections.map((section, index) => index === sdkIndex ? { ...section, text: surface.sdkText } : section),
    }
  }, { prepend: true })
}
