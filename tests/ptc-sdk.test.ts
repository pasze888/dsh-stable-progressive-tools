import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import {
  createSdkFixture,
  localProductionPatch,
  runCode,
  stablePtcPatches,
  type ModelContent,
  type ModelRequest,
} from './fixtures/sdk-runtime.ts'

function scripted(script: ModelContent[]) {
  return (_request: ModelRequest, requests: readonly ModelRequest[]): ModelContent =>
    script[requests.length - 1] ?? { type: 'text', text: 'unexpected extra request' }
}

it('discovers, describes, and executes a hidden tool through the official SDK', { timeout: 60_000 }, async () => {
  const script = [
    runCode('search-call', 'return await tools.search_tools({ query: "hidden fixture" })'),
    runCode('describe-call', 'return await tools.describe_tools({ names: ["fixture_hidden"] })'),
    runCode('hidden-call', 'return await tools.fixture_hidden({ value: "hidden-ok" })'),
    runCode('mutate-call', 'return await tools.fixture_mutate_catalog({ value: "remove-and-restrict" })'),
    runCode('verify-catalog-call', 'return await tools.search_tools({ query: "fixture" })'),
    { type: 'text', text: 'hidden workflow complete' },
  ]
  const fixture = await createSdkFixture('stable-ptc-sdk', scripted(script))
  const { root, requests } = fixture
  const harness = fixture.harness(await stablePtcPatches(root, { eagerTools: ['fixture_eager'], shellTool: 'none' }))

  const result = await harness.session('hidden-workflow').run('Run the hidden fixture workflow')

  expect(result.finalResponse).toBe('hidden workflow complete')
  expect(requests).toHaveLength(6)
  expect(JSON.stringify(requests[0]?.tools)).toContain('run_code')
  const initialSystem = JSON.stringify(requests[0]?.system)
  expect(initialSystem).toContain('search_tools')
  expect(initialSystem).toContain('describe_tools')
  expect(initialSystem).toContain('fixture_eager')
  expect(initialSystem).not.toContain('fixture_hidden')
  expect(JSON.stringify(requests[1]?.messages)).toContain('fixture_hidden')
  expect(JSON.stringify(requests[2]?.messages)).toContain('inputSchema')
  expect(JSON.stringify(requests[2]?.messages)).toContain('sdkExcerpt')
  expect(JSON.stringify(requests[3]?.messages)).toContain('hidden-ok')
  expect(JSON.stringify(requests[4]?.messages)).toContain('catalog-mutated')
  expect(JSON.stringify(requests[5]?.messages)).toContain('fixture_hidden')
  expect(JSON.stringify(requests[5]?.messages)).not.toContain('fixture_late')
  expect(JSON.stringify(requests[5]?.messages)).not.toContain('fixture_restricted')
  for (const request of requests.slice(1)) expect(JSON.stringify(request.system)).toBe(initialSystem)
  expect(result.events.some(event => event.type === 'tool/result' && event.data.error !== undefined)).toBe(false)
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
