import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import {
  createSdkFixture,
  httpError,
  localProductionPatch,
  runCode,
  stablePtcPatches,
  toolResultText,
  type ModelContent,
  type ModelRequest,
} from './fixtures/sdk-runtime.ts'

function scripted(script: ModelContent[]) {
  return (_request: ModelRequest, requests: readonly ModelRequest[]): ModelContent =>
    script[requests.length - 1] ?? { type: 'text', text: 'unexpected extra request' }
}

it('discovers, describes, and executes hidden tools through the official SDK', { timeout: 60_000 }, async () => {
  const script = [
    runCode('search-call', 'return await tools.search_tools({ query: "fixture_hidden" })'),
    runCode('describe-call', 'return await tools.describe_tools({ names: ["fixture_hidden", "fixture.page.alpha", "fixture.page.beta", "fixture.page.gamma", "fixture_eager", "fixture_mutate_catalog"] })'),
    runCode('hidden-call', 'return await tools.fixture_hidden({ value: "hidden-ok" })'),
    runCode('punctuated-call', 'return await tools["fixture.page.alpha"]({ value: "punctuation-ok" })'),
    runCode('mutate-call', 'return await tools.fixture_mutate_catalog({ value: "remove-and-restrict" })'),
    runCode('verify-catalog-call', 'return await tools.search_tools({ query: "fixture" })'),
    { type: 'text', text: 'hidden workflow complete' },
  ]
  const fixture = await createSdkFixture('stable-ptc-sdk', scripted(script))
  const { root, requests } = fixture
  const harness = fixture.harness(await stablePtcPatches(root, { eagerTools: ['fixture_eager'], shellTool: 'none' }))

  const result = await harness.session('hidden-workflow').run('Run the hidden fixture workflow')

  expect(result.finalResponse).toBe('hidden workflow complete')
  expect(requests).toHaveLength(7)
  expect(JSON.stringify(requests[0]?.tools)).toContain('run_code')
  const initialSystem = JSON.stringify(requests[0]?.system)
  expect(initialSystem).toContain('search_tools')
  expect(initialSystem).toContain('describe_tools')
  expect(initialSystem).toContain('fixture_eager')
  expect(initialSystem).not.toContain('fixture_hidden')
  expect(JSON.stringify(requests[1]?.messages)).toContain('fixture_hidden')
  expect(JSON.stringify(requests[2]?.messages)).toContain('inputSchema')
  expect(JSON.stringify(requests[2]?.messages)).toContain('sdkExcerpt')
  const disclosures = JSON.parse(toolResultText(requests[2]!, 'describe-call')) as {
    tools: { name: string; description: string; inputSchema: object; outputSchema: object; sdkExcerpt: string; schemaHash: string }[]
  }
  expect(disclosures.tools.map(tool => tool.name)).toEqual([
    'fixture_hidden',
    'fixture.page.alpha',
    'fixture.page.beta',
    'fixture.page.gamma',
    'fixture_eager',
    'fixture_mutate_catalog',
  ])
  for (const tool of disclosures.tools) {
    expect(tool.description).toContain(tool.name)
    expect(tool.inputSchema).toMatchObject({
      type: 'object',
      required: ['value'],
      properties: { value: { type: 'string' } },
    })
    expect(tool.outputSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['value'],
      properties: { value: { type: 'string' } },
    })
    expect(tool.sdkExcerpt).toContain(tool.name)
    expect(tool.schemaHash).toMatch(/^[a-f0-9]{64}$/)
  }
  expect(JSON.stringify(requests[3]?.messages)).toContain('hidden-ok')
  expect(JSON.stringify(requests[4]?.messages)).toContain('punctuation-ok')
  expect(JSON.stringify(requests[5]?.messages)).toContain('catalog-mutated')
  expect(JSON.stringify(requests[6]?.messages)).toContain('fixture_hidden')
  expect(JSON.stringify(requests[6]?.messages)).not.toContain('fixture_late')
  expect(JSON.stringify(requests[6]?.messages)).not.toContain('fixture_restricted')
  for (const request of requests.slice(1)) expect(JSON.stringify(request.system)).toBe(initialSystem)
  expect(result.events.some(event => event.type === 'tool/result' && event.data.error !== undefined)).toBe(false)
})

it('returns a Describe disclosure larger than the retired byte budget without truncation', { timeout: 60_000 }, async () => {
  const fixture = await createSdkFixture('stable-ptc-large-describe', scripted([
    runCode('large-describe-call', 'return await tools.describe_tools({ names: ["fixture_large"] })'),
    { type: 'text', text: 'large Describe complete' },
  ]))
  const patches = await stablePtcPatches(fixture.root, { shellTool: 'none' })
  patches.push(fileURLToPath(new URL('./fixtures/large-describe.yml', import.meta.url)))
  const harness = fixture.harness(patches)

  const result = await harness.session('large-describe').run('Return the complete large disclosure')

  expect(result.finalResponse).toBe('large Describe complete')
  expect(fixture.requests).toHaveLength(2)
  const largeText = toolResultText(fixture.requests[1]!, 'large-describe-call')
  const disclosure = JSON.parse(largeText) as {
    tools: { name: string; description: string; inputSchema: object; outputSchema: object }[]
  }
  expect(disclosure.tools).toHaveLength(1)
  expect(disclosure.tools[0]!.description.length).toBeGreaterThan(1_048_576)
  expect(disclosure.tools[0]!.description).toContain('large-disclosure-start-')
  expect(disclosure.tools[0]!.description.endsWith('-large-disclosure-end')).toBe(true)
})

it('propagates a Provider failure after Describe as an error', { timeout: 60_000 }, async () => {
  const fixture = await createSdkFixture('stable-ptc-describe-provider-error', (_request, requests) =>
    requests.length === 1
      ? runCode('provider-error-describe', 'return await tools.describe_tools({ names: ["fixture_hidden"] })')
      : httpError(400, 'provider-size-limit-sentinel'))
  const harness = fixture.harness(await stablePtcPatches(fixture.root, { shellTool: 'none' }))

  const result = await harness.session('describe-provider-error').run('Simulate a Provider hard failure')

  expect(result.finishReason).toBe('error')
  expect(result.finalResponse).not.toContain('complete')
  expect(JSON.stringify(result.events)).toContain('provider-size-limit-sentinel')
  expect(fixture.requests).toHaveLength(2)
})

it('preloads one available Shell declaration and executes its live PTC binding', { timeout: 60_000 }, async () => {
  const fixture = await createSdkFixture('stable-ptc-shell', scripted([
    runCode('shell-call', 'return await tools.bash({ command: "printf shell-ok", description: "Verify the selected Shell binding" })'),
    { type: 'text', text: 'shell workflow complete' },
  ]))
  const harness = fixture.harness(await stablePtcPatches(fixture.root))

  const result = await harness.session('stable-shell').run('Run the selected Shell')

  expect(result.finalResponse).toBe('shell workflow complete')
  expect(fixture.requests).toHaveLength(2)
  const initialSystem = JSON.stringify(fixture.requests[0]?.system)
  // One declaration appears in each of ToolArgsMap and ToolOutputMap.
  expect(initialSystem.split('bash:').length - 1).toBe(2)
  expect(initialSystem).not.toContain('pwsh:')
  expect(JSON.stringify(fixture.requests[1]?.system)).toBe(initialSystem)
  expect(JSON.stringify(fixture.requests[1]?.messages)).toContain('shell-ok')
  expect(result.events.some(event => event.type === 'tool/result' && event.data.error !== undefined)).toBe(false)
})

it('leaves subagent PTC presentation unchanged by session origin', { timeout: 60_000 }, async () => {
  const fixture = await createSdkFixture('stable-ptc-subagent', (request, requests) => {
    const messages = JSON.stringify(request.messages)
    const firstMessage = JSON.stringify((request.messages as unknown[])[0])
    const isChild = firstMessage.includes('Return only the child response.')
    const hasWaitResult = messages.includes('child complete') && messages.includes('wait_agent')
    if (isChild) return { type: 'text', text: 'child complete' }
    if (hasWaitResult) return { type: 'text', text: 'parent complete' }
    return requests.length === 1
      ? runCode('subagent-call', 'return await tools.subagent({ description: "Inspect child SDK", prompt: "Return only the child response." })')
      : runCode('wait-call', 'return await tools.wait_agent({ timeout_ms: 10000 })')
  })
  const harness = fixture.harness(await stablePtcPatches(fixture.root))

  const result = await harness.session('parent-surface').run('Delegate one response')

  expect(result.finalResponse).toBe('parent complete')
  expect(fixture.requests).toHaveLength(4)
  const parentInitial = JSON.stringify(fixture.requests[0]?.system)
  const childRequest = fixture.requests.find(request => JSON.stringify((request.messages as unknown[])[0]).includes('Return only the child response.'))!
  const childInitial = JSON.stringify(childRequest.system)
  expect(parentInitial).not.toContain('fixture_hidden')
  expect(parentInitial).toContain('search_tools')
  expect(childInitial).toContain('fixture_hidden')
  expect(childInitial).not.toContain('search_tools')
  expect(childInitial).not.toContain('describe_tools')
  expect(childInitial).not.toContain('Use search_tools to discover non-eager tools')
})

it('keeps Search cursors consistent across catalog changes', { timeout: 60_000 }, async () => {
  let firstCursor = ''
  let freshCursor = ''
  const fixture = await createSdkFixture('stable-ptc-search-cursor', (request, requests) => {
    if (requests.length === 1) {
      return runCode('page-start', 'return await tools.search_tools({ query: "*", namespace: "fixture.page", limit: 2 })')
    }
    if (requests.length === 2) {
      const page = JSON.parse(toolResultText(request, 'page-start')) as { nextCursor?: string }
      firstCursor = page.nextCursor ?? ''
      return runCode('reorder-catalog', 'return await tools.fixture_reorder_catalog({ value: "reorder" })')
    }
    if (requests.length === 3) {
      return runCode('equivalent-page', 'return await tools.search_tools({ query: "*", namespace: "fixture.page", limit: 2, cursor: ' + JSON.stringify(firstCursor) + ' })')
    }
    if (requests.length === 4) {
      return runCode('mutate-catalog', 'return await tools.fixture_hidden({ value: "cursor-mutation-ok" })')
    }
    if (requests.length === 5) {
      return runCode('stale-page', 'return await tools.search_tools({ query: "*", namespace: "fixture.page", limit: 2, cursor: ' + JSON.stringify(firstCursor) + ' })')
    }
    if (requests.length === 6) {
      return runCode('fresh-start', 'return await tools.search_tools({ query: "*", namespace: "fixture.page", limit: 2 })')
    }
    if (requests.length === 7) {
      const page = JSON.parse(toolResultText(request, 'fresh-start')) as { nextCursor?: string }
      freshCursor = page.nextCursor ?? ''
      return runCode('fresh-page', 'return await tools.search_tools({ query: "*", namespace: "fixture.page", limit: 2, cursor: ' + JSON.stringify(freshCursor) + ' })')
    }
    return { type: 'text', text: 'cursor workflow complete' }
  })
  const harness = fixture.harness(await stablePtcPatches(fixture.root, { shellTool: 'none' }))

  const result = await harness.session('search-cursors').run('Exercise consistent Search cursors')

  expect(result.finalResponse).toBe('cursor workflow complete')
  expect(fixture.requests).toHaveLength(8)
  expect(firstCursor).not.toBe('')
  expect(freshCursor).not.toBe('')
  const firstPage = JSON.parse(toolResultText(fixture.requests[1]!, 'page-start')) as {
    results: { name: string }[]
    nextCursor?: string
  }
  expect(firstPage.results.map(item => item.name)).toEqual(['fixture.page.alpha', 'fixture.page.beta'])
  expect(JSON.stringify(fixture.requests[2]?.messages)).toContain('catalog-reordered')
  const equivalentPage = JSON.parse(toolResultText(fixture.requests[3]!, 'equivalent-page')) as { results: { name: string }[] }
  expect(equivalentPage.results.map(item => item.name)).toEqual(['fixture.page.gamma'])
  expect(JSON.stringify(fixture.requests[4]?.messages)).toContain('cursor-mutation-ok')
  const stale = toolResultText(fixture.requests[5]!, 'stale-page')
  expect(stale).toContain('TOOL_CATALOG_CHANGED')
  expect(stale).not.toContain('fixture.page.gamma')
  const secondPage = JSON.parse(toolResultText(fixture.requests[7]!, 'fresh-page')) as {
    results: { name: string }[]
    nextCursor?: string
  }
  expect(secondPage.results.map(item => item.name)).toEqual(['fixture.page.gamma'])
  expect(secondPage.nextCursor).toBeUndefined()
  const initialSystem = JSON.stringify(fixture.requests[0]?.system)
  for (const request of fixture.requests.slice(1)) expect(JSON.stringify(request.system)).toBe(initialSystem)
})

it('enforces disclosed Schema hashes while preserving live runtime errors', { timeout: 60_000 }, async () => {
  const script = [
    runCode('undisclosed-call', 'return await tools.fixture_hidden({ value: "undisclosed-ok" })'),
    runCode('describe-v1', 'return await tools.describe_tools({ names: ["fixture_schema"] })'),
    runCode('change-schema', 'return await tools.fixture_change_schema({ value: "change" })'),
    runCode('stale-call', 'return await tools.fixture_schema({ value: 2 })'),
    runCode('describe-v2', 'return await tools.describe_tools({ names: ["fixture_schema"] })'),
    runCode('retry-call', 'return await tools.fixture_schema({ value: 2 })'),
    runCode('invalid-call', 'return await tools.fixture_schema({ value: "wrong" })'),
    runCode('mutate-call', 'return await tools.fixture_mutate_catalog({ value: "remove-and-restrict" })'),
    runCode('deleted-call', 'return await tools.fixture_late({ value: "deleted" })'),
    runCode('restricted-call', 'return await tools.fixture_restricted({ value: "restricted" })'),
    { type: 'text', text: 'schema workflow complete' },
  ]
  const fixture = await createSdkFixture('stable-ptc-schema', scripted(script))
  const harness = fixture.harness(await stablePtcPatches(fixture.root, { shellTool: 'none' }))

  const result = await harness.session('schema-history').run('Exercise Schema history and live errors')

  expect(result.finalResponse).toBe('schema workflow complete')
  expect(fixture.requests).toHaveLength(11)
  expect(JSON.stringify(fixture.requests[1]?.messages)).toContain('undisclosed-ok')
  const v1 = JSON.parse(toolResultText(fixture.requests[2]!, 'describe-v1')) as { tools: { schemaHash: string }[] }
  const stale = toolResultText(fixture.requests[4]!, 'stale-call')
  expect(stale).toContain('TOOL_SCHEMA_CHANGED')
  expect(stale).toContain('describe the tool again')
  const v2 = JSON.parse(toolResultText(fixture.requests[5]!, 'describe-v2')) as { tools: { schemaHash: string }[] }
  expect(v2.tools[0]!.schemaHash).not.toBe(v1.tools[0]!.schemaHash)
  expect(JSON.parse(toolResultText(fixture.requests[6]!, 'retry-call'))).toEqual({ value: 2 })
  expect(toolResultText(fixture.requests[7]!, 'invalid-call')).toContain('invalid arguments')
  expect(JSON.stringify(fixture.requests[8]?.messages)).toContain('catalog-mutated')
  expect(toolResultText(fixture.requests[9]!, 'deleted-call')).toContain('tools.fixture_late is not a function')
  expect(toolResultText(fixture.requests[10]!, 'restricted-call')).toContain('tools.fixture_restricted is not a function')
  const events = JSON.stringify(result.events)
  expect(events).toContain('"code":"TOOL_SCHEMA_CHANGED"')
  expect(events).toContain('"code":"INVALID_ARGS"')
  expect(events).not.toContain('describedSchemaHash')
  const initialSystem = JSON.stringify(fixture.requests[0]?.system)
  for (const request of fixture.requests.slice(1)) expect(JSON.stringify(request.system)).toBe(initialSystem)
})

it('does not invent disclosures for Object prototype tool names', { timeout: 60_000 }, async () => {
  const fixture = await createSdkFixture('stable-ptc-prototype-names', scripted([
    runCode('constructor-call', 'return await tools["constructor"]({ value: "constructor-ok" })'),
    runCode('to-string-call', 'return await tools["toString"]({ value: "to-string-ok" })'),
    runCode('proto-call', 'return await tools["__proto__"]({ value: "proto-ok" })'),
    { type: 'text', text: 'prototype names complete' },
  ]))
  const harness = fixture.harness(await stablePtcPatches(fixture.root, { shellTool: 'none' }))

  const result = await harness.session('prototype-names').run('Call undisclosed prototype-named tools')

  expect(result.finalResponse).toBe('prototype names complete')
  for (const [index, callId, value] of [
    [1, 'constructor-call', 'constructor-ok'],
    [2, 'to-string-call', 'to-string-ok'],
    [3, 'proto-call', 'proto-ok'],
  ] as const) {
    expect(JSON.parse(toolResultText(fixture.requests[index]!, callId))).toEqual({ value })
  }
})

it('replays a legacy Describe disclosure without presentation metadata', { timeout: 60_000 }, async () => {
  const fixture = await createSdkFixture('stable-ptc-legacy-disclosure', scripted([
    runCode('legacy-describe-call', 'return await tools.fixture_legacy_describe({ value: "' + 'a'.repeat(64) + '" })'),
    runCode('legacy-stale-call', 'return await tools.fixture_schema({ value: "current" })'),
    { type: 'text', text: 'legacy disclosure complete' },
  ]))
  const harness = fixture.harness(await stablePtcPatches(fixture.root, { shellTool: 'none' }))

  const result = await harness.session('legacy-disclosure').run('Replay a legacy Describe record')

  expect(result.finalResponse).toBe('legacy disclosure complete')
  const stale = toolResultText(fixture.requests[2]!, 'legacy-stale-call')
  expect(stale).toContain('TOOL_SCHEMA_CHANGED')
  expect(stale).not.toContain('Invalid describe_tools disclosure metadata')
})

it('restores the complete Surface and disclosure history after a process restart', { timeout: 60_000 }, async () => {
  const fixture = await createSdkFixture('stable-ptc-resume', (_request, requests) => {
    if (requests.length === 1) return runCode('resume-describe', 'return await tools.describe_tools({ names: ["fixture_hidden"] })')
    if (requests.length === 2) return { type: 'text', text: 'before restart complete' }
    return { type: 'text', text: 'after restart complete' }
  })
  const home = join(fixture.root, 'shared-home')
  const first = fixture.harness(await stablePtcPatches(fixture.root, {
    eagerTools: ['fixture_eager'],
    shellTool: 'none',
  }), { dshHome: home })
  const initial = await first.session('resume-surface').run('Create and Describe before restart')
  expect(initial.finalResponse).toBe('before restart complete')
  const initialSystem = JSON.stringify(fixture.requests[0]?.system)
  await first.close()

  const second = fixture.harness(await stablePtcPatches(fixture.root, {
    eagerTools: [],
    shellTool: 'auto',
  }), { dshHome: home })
  const resumed = await second.resumeSession('resume-surface')
  expect(fixture.requests).toHaveLength(2)
  const result = await resumed.run('Resume with a different plugin configuration')

  expect(result.finalResponse).toBe('after restart complete')
  expect(fixture.requests).toHaveLength(3)
  expect(JSON.stringify(fixture.requests[2]?.system)).toBe(initialSystem)
  expect(JSON.stringify(fixture.requests[2]?.system)).toContain('fixture_eager')
  expect(JSON.stringify(fixture.requests[2]?.system)).not.toContain('bash:')
  expect(JSON.stringify(fixture.requests[2]?.messages)).toContain('inputSchema')
  expect(JSON.stringify(fixture.requests[2]?.messages)).toContain('sdkExcerpt')
})

it('rolls back an unpublished Surface when persistence fails and retries honestly', { timeout: 60_000 }, async () => {
  const fixture = await createSdkFixture('stable-ptc-write-retry', () => ({ type: 'text', text: 'Surface retry complete' }))
  const home = join(fixture.root, 'retry-home')
  await mkdir(home, { recursive: true })
  const blocker = join(home, 'stable-progressive-tools')
  await writeFile(blocker, 'block the Surface directory')
  const harness = fixture.harness(await stablePtcPatches(fixture.root, { shellTool: 'none' }), { dshHome: home })
  const session = harness.session('surface-write-retry')
  const failed = await session.run('Fail the first Surface write')
  expect(failed.finishReason).toBe('error')
  expect(JSON.stringify(failed.events)).toContain('cannot commit recovery record')
  expect(fixture.requests).toHaveLength(0)

  await rm(blocker)
  const retried = await session.run('Retry the Surface write')
  expect(retried.finalResponse).toBe('Surface retry complete')
  expect(fixture.requests).toHaveLength(1)
  const record = join(home, 'stable-progressive-tools', 'surfaces', Buffer.from(failed.sessionId).toString('base64url') + '.json')
  expect(JSON.parse(await readFile(record, 'utf8')).version).toBe(1)
})

it('fails honestly when a persisted Surface record is corrupt', { timeout: 60_000 }, async () => {
  const fixture = await createSdkFixture('stable-ptc-corrupt-surface', () => ({ type: 'text', text: 'before corruption complete' }))
  const home = join(fixture.root, 'shared-home')
  const first = fixture.harness(await stablePtcPatches(fixture.root, { shellTool: 'none' }), { dshHome: home })
  const initial = await first.session('corrupt-surface').run('Create a durable Surface')
  expect(initial.finalResponse).toBe('before corruption complete')
  await first.close()
  const record = join(home, 'stable-progressive-tools', 'surfaces', Buffer.from('corrupt-surface').toString('base64url') + '.json')
  await writeFile(record, '{not-json')

  const second = fixture.harness(await stablePtcPatches(fixture.root, { shellTool: 'none' }), { dshHome: home })
  const resumed = await second.resumeSession('corrupt-surface')
  const result = await resumed.run('The corrupt Surface must not be replaced')

  expect(result.finishReason).toBe('error')
  expect(JSON.stringify(result.events)).toContain('invalid recovery record')
  expect(fixture.requests).toHaveLength(1)
})

it('inherits the parent Surface and disclosure history through fork', { timeout: 60_000 }, async () => {
  const fixture = await createSdkFixture('stable-ptc-fork', (request, requests) => {
    const messages = JSON.stringify(request.messages)
    const lastMessage = JSON.stringify((request.messages as unknown[]).at(-1))
    if (lastMessage.includes('Return the forked child response.')) return { type: 'text', text: 'fork child complete' }
    if (messages.includes('fork child complete') && messages.includes('wait_agent')) return { type: 'text', text: 'fork parent complete' }
    if (requests.length === 1) return runCode('fork-describe', 'return await tools.describe_tools({ names: ["fixture_hidden"] })')
    if (requests.length === 2) return runCode('remove-eager', 'return await tools.fixture_remove_eager({ value: "remove" })')
    if (requests.length === 3) return { type: 'text', text: 'fork setup complete' }
    if (requests.length === 4) return runCode('fork-call', 'return await tools.subagent_fork({ description: "Fork Surface", prompt: "Return the forked child response." })')
    return runCode('fork-wait', 'return await tools.wait_agent({ timeout_ms: 10000 })')
  })
  const home = join(fixture.root, 'fork-home')
  const harness = fixture.harness(await stablePtcPatches(fixture.root, {
    activation: { includeSubagents: true },
    eagerTools: ['fixture_eager'],
    shellTool: 'none',
  }), { dshHome: home })

  const session = harness.session('fork-parent')
  const setup = await session.run('Describe before the fork')
  expect(setup.finalResponse).toBe('fork setup complete')
  const result = await session.run('Fork after removing an Eager Tool')

  expect(result.finalResponse).toBe('fork parent complete')
  expect(fixture.requests).toHaveLength(7)
  const parentInitial = JSON.stringify(fixture.requests[0]?.system)
  const child = fixture.requests.find(request => JSON.stringify((request.messages as unknown[]).at(-1)).includes('Return the forked child response.'))!
  expect(JSON.stringify(child.system)).toBe(parentInitial)
  expect(JSON.stringify(child.messages)).toContain('inputSchema')
  expect(JSON.stringify(child.messages)).toContain('sdkExcerpt')
  for (const request of fixture.requests.filter(item => item !== child)) {
    expect(JSON.stringify(request.system)).toBe(parentInitial)
  }
  const childNotification = result.notifications.find(notification => notification.method === 'session.event'
    && notification.params.sessionId !== 'fork-parent')
  const childId = childNotification?.params.sessionId
  expect(typeof childId).toBe('string')
  const childRecord = join(home, 'stable-progressive-tools', 'surfaces', Buffer.from(childId as string).toString('base64url') + '.json')
  expect(JSON.parse(await readFile(childRecord, 'utf8')).version).toBe(1)
})

it('keeps Surface bytes unchanged while Compaction starts a new Cache Epoch', { timeout: 60_000 }, async () => {
  const fixture = await createSdkFixture('stable-ptc-compaction', (_request, requests) => {
    if (requests.length === 1) return { type: 'text', text: 'before Compaction complete' }
    if (requests.length === 2) return { type: 'text', text: 'Compaction summary' }
    return { type: 'text', text: 'after Compaction complete' }
  })
  const harness = fixture.harness(await stablePtcPatches(fixture.root, { shellTool: 'none' }))
  const session = harness.session('compact-surface')
  const before = await session.run('Run before Compaction')
  expect(before.finalResponse).toBe('before Compaction complete')
  const compact = await session.run('/compact')
  expect(compact.events.some(event => event.type === 'compaction/start')).toBe(true)
  const after = await session.run('Run after Compaction')

  expect(after.finalResponse).toBe('after Compaction complete')
  expect(fixture.requests).toHaveLength(3)
  expect(JSON.stringify(fixture.requests[2]?.system)).toBe(JSON.stringify(fixture.requests[0]?.system))
})

it('keeps ordinary PTC byte-for-byte unchanged when the evaluation preset is installed', { timeout: 60_000 }, async () => {
  const fixture = await createSdkFixture('stable-ptc-ordinary', () => ({ type: 'text', text: 'ordinary PTC complete' }))
  const runtimePatch = fileURLToPath(new URL('./fixtures/preset-runtime.yml', import.meta.url))
  const ptcPatch = fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-web-app/presets/ptc.patch.yml'))
  async function capture(patches: string[]): Promise<ModelRequest | undefined> {
    const harness = fixture.harness(patches)
    const result = await harness.session('ordinary-ptc').run('Return the ordinary PTC response')
    expect(result.finalResponse).toBe('ordinary PTC complete')
    await harness.close()
    return fixture.requests.at(-1)
  }

  const baseline = await capture([runtimePatch, ptcPatch])
  const installed = await capture([runtimePatch, ptcPatch, await localProductionPatch(fixture.root)])

  expect(fixture.requests).toHaveLength(2)
  expect(JSON.stringify(installed?.system)).toBe(JSON.stringify(baseline?.system))
  expect(JSON.stringify(installed?.tools)).toBe(JSON.stringify(baseline?.tools))
})

it('enforces Search query and zero-match budgets through run_code', { timeout: 60_000 }, async () => {
  const fixture = await createSdkFixture('stable-ptc-search-budgets', scripted([
    runCode('empty-search-call', 'return await tools.search_tools({ query: "zzz" })'),
    runCode('long-search-call', 'return await tools.search_tools({ query: "123456789" })'),
    { type: 'text', text: 'search budgets complete' },
  ]))
  const harness = fixture.harness(await stablePtcPatches(fixture.root, {
    maxQueryChars: 8,
    zeroMatch: 'empty',
    shellTool: 'none',
  }))

  const result = await harness.session('search-budgets').run('Exercise Search budgets')

  expect(result.finalResponse).toBe('search budgets complete')
  expect(fixture.requests).toHaveLength(3)
  expect(JSON.stringify(fixture.requests[1]?.messages)).toContain('\\"results\\": []')
  expect(JSON.stringify(fixture.requests[1]?.messages)).toContain('\\"fallback\\": false')
  expect(JSON.stringify(fixture.requests[2]?.messages)).toContain('maxQueryChars')
})

it('rejects an unavailable Eager Tool before emitting a mutated model request', { timeout: 60_000 }, async () => {
  const fixture = await createSdkFixture('stable-ptc-invalid-eager', () => ({ type: 'text', text: 'unexpected model request' }))
  const harness = fixture.harness(await stablePtcPatches(fixture.root, {
    eagerTools: ['fixture_missing'],
    shellTool: 'none',
  }))

  const result = await harness.session('invalid-eager').run('This configuration must fail')

  expect(result.finishReason).toBe('error')
  expect(JSON.stringify(result.events)).toContain('Configured eager tool is not available: fixture_missing')
  expect(fixture.requests).toHaveLength(0)
})

it('keeps the live approval pipeline for a hidden Shell invocation', { timeout: 60_000 }, async () => {
  const fixture = await createSdkFixture('stable-ptc-approval', scripted([
    runCode('approval-call', 'return await tools.bash({ command: "printf permission-ok > /stable-ptc-approval-probe", description: "Verify hidden-tool approval", workdir: "/", sandbox_permissions: "danger-full-access", justification: "Exercise the existing approval pipeline without writing the probe." })'),
    { type: 'text', text: 'approval workflow complete' },
  ]))
  const harness = fixture.harness(await stablePtcPatches(fixture.root, { shellTool: 'none' }), {
    permissionMode: 'workspace-write',
    approvalRequests: true,
  })
  const approvals: Record<string, unknown>[] = []
  harness.client.start()
  harness.client.onRequest(async (method, params) => {
    expect(method).toBe('approval/request')
    approvals.push(params)
    return { outcome: 'rejected' }
  })

  const result = await harness.session('hidden-approval').run('Run the hidden Shell outside the workspace')

  expect(result.finalResponse).toBe('approval workflow complete')
  expect(approvals, JSON.stringify(fixture.requests[1]?.messages)).toHaveLength(1)
  expect(approvals[0]).toMatchObject({ sessionId: 'hidden-approval', toolName: 'bash' })
  expect(JSON.stringify(fixture.requests[0]?.system)).not.toContain('bash:')
  expect(JSON.stringify(fixture.requests[1]?.messages)).toContain('rejected')
})
