import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
import { onTestFinished } from 'vitest'
import { messagesResponse } from './messages-response.ts'

export interface ModelContent extends Record<string, unknown> { type: string }
export type ModelRequest = Record<string, unknown>

export function runCode(id: string, code: string): ModelContent {
  return { type: 'tool_use', id, name: 'run_code', input: { code, description: 'Drive the hidden-tool workflow' } }
}

export async function localProductionPatch(root: string, config?: Record<string, unknown>): Promise<string> {
  const source = await readFile(fileURLToPath(new URL('../../cordis.patch.yml', import.meta.url)), 'utf8')
  const pluginUrl = pathToFileURL(fileURLToPath(new URL('../../lib/index.mjs', import.meta.url))).href
  const row = 'name: ' + JSON.stringify(pluginUrl)
    + (config === undefined ? '' : '\n            config: ' + JSON.stringify(config))
  const content = source.replace('name: dsh-stable-progressive-tools', row)
  if (content === source) throw new Error('production preset does not contain the plugin package row')
  const target = join(root, 'stable-ptc-production.patch.yml')
  await writeFile(target, content)
  return target
}

export async function stablePtcPatches(root: string, config?: Record<string, unknown>): Promise<string[]> {
  return [
    fileURLToPath(new URL('./preset-runtime.yml', import.meta.url)),
    fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-web-app/presets/ptc.patch.yml')),
    await localProductionPatch(root, config),
    fileURLToPath(new URL('./stable-preset-driver.yml', import.meta.url)),
    fileURLToPath(new URL('./ptc.yml', import.meta.url)),
    fileURLToPath(new URL('./stable-ptc.yml', import.meta.url)),
  ]
}

interface HarnessOptions {
  permissionMode?: 'danger-full-access' | 'workspace-write'
  approvalRequests?: boolean
}

/** Own one controlled endpoint and all SDK subprocesses used by a single test. */
export async function createSdkFixture(
  prefix: string,
  respond: (request: ModelRequest, requests: readonly ModelRequest[]) => ModelContent,
) {
  const root = await mkdtemp(join(tmpdir(), prefix + '-'))
  const requests: ModelRequest[] = []
  const harnesses = new Set<DeepSeekHarness>()
  const server = createServer((incoming, response) => {
    let body = ''
    incoming.setEncoding('utf8')
    incoming.on('data', (chunk: string) => { body += chunk })
    incoming.on('end', () => {
      const request = JSON.parse(body) as ModelRequest
      requests.push(request)
      const content = respond(request, requests)
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(messagesResponse(content, content.type === 'tool_use' ? 'tool_use' : 'end_turn'))
    })
  })
  onTestFinished(async () => {
    try {
      for (const harness of harnesses) await harness.close()
    } finally {
      try { await new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error))) }
      finally { await rm(root, { recursive: true, force: true }) }
    }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('model fixture has no port')
  const port = address.port
  return {
    root,
    requests,
    harness(patches: string[], options: HarnessOptions = {}): DeepSeekHarness {
      const harness = new DeepSeekHarness({
        cwd: root,
        processCwd: root,
        dshHome: join(root, '.dsh-' + String(harnesses.size)),
        env: {
          ...process.env,
          DSH_PERMISSION_MODE: options.permissionMode ?? 'danger-full-access',
          DSH_TELEMETRY_DISABLED: '1',
          DEEPSEEK_API_KEY: prefix + '-fixture',
          DEEPSEEK_BASE_URL: 'http://127.0.0.1:' + String(port),
          HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '', http_proxy: '', https_proxy: '', all_proxy: '',
        },
        model: 'deepseek-v4-pro',
        initializeTimeoutMs: 30_000,
        patches,
        ...options.approvalRequests === undefined ? {} : { approvalRequests: options.approvalRequests },
      })
      harnesses.add(harness)
      return harness
    },
  }
}
