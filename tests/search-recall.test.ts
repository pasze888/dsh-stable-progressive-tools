import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { evaluateSearchRecall, type LabelledSearchDataset } from '../src/index.ts'

const dataset = JSON.parse(await readFile(fileURLToPath(new URL('./fixtures/search-recall-v1.json', import.meta.url)), 'utf8')) as LabelledSearchDataset

describe('offline Search Recall@5', () => {
  it('uses the production ranker with fixed labels and reports misses', () => {
    expect(evaluateSearchRecall(dataset)).toEqual({
      score: 0.75,
      misses: [{ queryId: 'unmatched-shell', relevant: ['shell.run_command'] }],
    })
  })

  it('rejects invalid labels instead of inventing a score', () => {
    expect(() => evaluateSearchRecall({
      ...dataset,
      queries: [dataset.queries[0]!, dataset.queries[0]!],
    })).toThrow(/unique/)
    expect(() => evaluateSearchRecall({
      ...dataset,
      queries: [{ id: 'unknown', query: 'anything', relevant: ['missing.tool'] }],
    })).toThrow(/absent from the catalog/)
  })
})
