import { rankCatalog, type CatalogEntry } from './discovery.ts'

export interface LabelledSearchDataset {
  version: 1
  catalog: CatalogEntry[]
  queries: {
    id: string
    query: string
    namespace?: string
    relevant: string[]
  }[]
}

/** Macro-averaged per-query Recall@5 over a fixed, fully labelled offline dataset. */
export function evaluateSearchRecall(dataset: LabelledSearchDataset): {
  score: number
  misses: { queryId: string; relevant: string[] }[]
} {
  if (dataset.version !== 1 || dataset.queries.length === 0) throw new Error('Recall dataset must be version 1 and non-empty')
  const catalogNames = dataset.catalog.map(tool => tool.name)
  if (new Set(catalogNames).size !== catalogNames.length) throw new Error('Recall dataset catalog names must be unique')
  const queryIds = dataset.queries.map(query => query.id)
  if (new Set(queryIds).size !== queryIds.length) throw new Error('Recall dataset query ids must be unique')
  const known = new Set(catalogNames)
  const misses: { queryId: string; relevant: string[] }[] = []
  let total = 0
  for (const labelled of dataset.queries) {
    if (labelled.relevant.length === 0 || new Set(labelled.relevant).size !== labelled.relevant.length) {
      throw new Error('Recall labels must be non-empty and unique: ' + labelled.id)
    }
    if (labelled.relevant.some(name => !known.has(name))) throw new Error('Recall label is absent from the catalog: ' + labelled.id)
    const top = rankCatalog(dataset.catalog, {
      query: labelled.query,
      ...labelled.namespace === undefined ? {} : { namespace: labelled.namespace },
    }).slice(0, 5).map(tool => tool.name)
    const missing = labelled.relevant.filter(name => !top.includes(name))
    if (missing.length > 0) misses.push({ queryId: labelled.id, relevant: missing })
    total += (labelled.relevant.length - missing.length) / labelled.relevant.length
  }
  return { score: total / dataset.queries.length, misses }
}
