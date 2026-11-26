export const name = 'stable-ptc-missing-sdk-fixture'

export function apply(ctx) {
  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const assembly = await next()
    return { ...assembly, sections: assembly.sections.filter(section => section.name !== 'tools:sdk') }
  }, { prepend: true })
}
