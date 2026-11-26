import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'stable-ptc-test-fixture'
export const inject = ['tools']

function fixtureTool(name, execute, reordered = false) {
  return defineTool({
    name,
    description: `Return the supplied ${name} value without changing it.`,
    parameters: {
      value: reordered
        ? { description: 'Value returned by the fixture.', required: true, type: 'string' }
        : { type: 'string', required: true, description: 'Value returned by the fixture.' },
    },
    output: {
      schema: reordered ? {
        properties: { value: { required: true, type: 'string' } },
        additionalProperties: false,
        type: 'object',
      } : {
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
  let replaceAlpha
  for (const name of ['fixture.page.alpha', 'fixture.page.beta', 'fixture.page.gamma']) {
    const dispose = ctx.tools.register(fixtureTool(name, args => Promise.resolve({ value: args.value })))
    if (name === 'fixture.page.alpha') replaceAlpha = dispose
  }
  ctx.tools.register({
    ...fixtureTool('fixture_large', args => Promise.resolve({ value: args.value })),
    description: 'large-disclosure-start-' + 'x'.repeat(1_048_600) + '-large-disclosure-end',
  })
  ctx.tools.register(fixtureTool('fixture_reorder_catalog', () => {
    replaceAlpha?.()
    replaceAlpha = ctx.tools.register(fixtureTool('fixture.page.alpha', args => Promise.resolve({ value: args.value }), true))
    return Promise.resolve({ value: 'catalog-reordered' })
  }))
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
