import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-ptc-runtime'
import { renderToolsSdk, type ToolSdkSchema } from '@deepseek-ai/dsh-tool-executor-ptc'
import { defineTool, projectToolSchema, RUN_CODE_NAME, type ResolvedToolSet, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { DESCRIBE_TOOLS_NAME, INVOKE_TOOL_NAME, SEARCH_TOOLS_NAME, type ResolvedConfig } from './config.ts'
import { SurfaceManager } from './surface.ts'

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
  return createHash('sha256').update(JSON.stringify({ parameters: schema.parameters, output: schema.output })).digest('hex')
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

export function installStablePtc(ctx: Context, config: ResolvedConfig): void {
  const searchTool = defineTool({
    name: SEARCH_TOOLS_NAME,
    description: 'Search the live tool catalog by exact names and description words without changing tool permissions.',
    parameters: {
      query: { type: 'string', description: 'Optional case-insensitive name or description query.' },
      namespace: { type: 'string', description: 'Optional exact namespace prefix.' },
      limit: { type: 'integer', description: 'Optional maximum number of results.' },
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
      const all = liveCatalog(ctx, exec.agent, exec.toolSet).filter(tool =>
        (args.namespace === undefined || tool.name.startsWith(args.namespace + '.'))
        && (query.length === 0 || query === '*'
          || tool.name.toLocaleLowerCase('en-US').includes(query)
          || tool.description.toLocaleLowerCase('en-US').includes(query)))
      const matches = all.length > 0 || query.length === 0 || query === '*' || config.zeroMatch === 'empty'
        ? all
        : liveCatalog(ctx, exec.agent, exec.toolSet)
      return Promise.resolve({
        results: matches.slice(0, limit).map(tool => ({
          name: tool.name,
          summary: tool.description.slice(0, config.maxSummaryChars),
          schemaHash: schemaHash(tool),
        })),
        total: matches.length,
        fallback: matches !== all,
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
