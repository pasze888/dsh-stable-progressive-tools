export const name = 'stable-ptc-preset-driver'
export const inject = ['agentPresets']

// The SDK server deliberately creates uncomposed Agents. Join root sessions to
// the requested roster entry before their first model turn, as a deployment
// with a preset roster must do. Child Agents already inherit their parent scope.
export function apply(ctx, config) {
  ctx.on('agent/created', async ({ agent }) => {
    if (agent.session.header.origin === 'subagent') return
    if (ctx.agentPresets.composedPreset(agent.ctx) === undefined) {
      await ctx.agentPresets.mount(agent.ctx, config.preset)
    }
  })
}
