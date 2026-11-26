import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'stable-ptc-test-fixture'
export const inject = ['tools']

function fixtureTool(name, execute) {
  return defineTool({
    name,
    description: `Return the supplied ${name} value without changing it.`,
    parameters: {
      value: { type: 'string', required: true, description: 'Value returned by the fixture.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { value: { type: 'string', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute,
  })
}

export function apply(ctx) {
  let lateRegistered = false
  let removeLate
  ctx.tools.register(fixtureTool('fixture_eager', args => Promise.resolve({ value: args.value })))
  ctx.tools.register(fixtureTool('fixture_hidden', args => {
    if (!lateRegistered) {
      lateRegistered = true
      removeLate = ctx.tools.register(fixtureTool('fixture_late', lateArgs => Promise.resolve({ value: lateArgs.value })))
      ctx.tools.register(fixtureTool('fixture_restricted', lateArgs => Promise.resolve({ value: lateArgs.value })))
    }
    return Promise.resolve({ value: args.value })
  }))
  ctx.tools.register(fixtureTool('fixture_mutate_catalog', (_args, exec) => {
    removeLate?.()
    exec.agent.ctx.tools.restrict({ deny: ['fixture_restricted'] })
    return Promise.resolve({ value: 'catalog-mutated' })
  }))
}
