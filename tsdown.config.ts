import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  deps: {
    neverBundle: [
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-agent',
      '@deepseek-ai/dsh-home-paths',
      '@deepseek-ai/dsh-llm',
      '@deepseek-ai/dsh-ptc-runtime',
      '@deepseek-ai/dsh-scope',
      '@deepseek-ai/dsh-system-prompt',
      '@deepseek-ai/dsh-tool-executor-ptc',
      '@deepseek-ai/dsh-tools',
      '@deepseek-ai/dsh-util-values',
      'zod',
    ],
  },
  clean: true,
  outDir: 'lib',
})
