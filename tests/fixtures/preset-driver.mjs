export const name = 'stable-ptc-preset-driver'
export const inject = ['agentPresets', 'agents']

// The SDK server deliberately creates uncomposed Agents. Join root sessions in
// the setup slot, before agent/created and the first assembly, as a deployment
// with a preset roster must do. Child Agents already inherit their parent scope.
export function apply(ctx, config) {
  const agents = ctx.agents
  const create = agents.create.bind(agents)
  const resume = agents.resume.bind(agents)
  const compose = options => ({
    ...options,
    setup: async (agentCtx, agent) => {
      const commit = await options.setup?.(agentCtx, agent)
      if (agent.session.header.origin !== 'subagent'
        && ctx.agentPresets.composedPreset(agentCtx) === undefined) {
        await ctx.agentPresets.mount(agentCtx, config.preset)
      }
      return commit
    },
  })
  agents.create = options => create(compose(options))
  agents.resume = options => resume(compose(options))
}
