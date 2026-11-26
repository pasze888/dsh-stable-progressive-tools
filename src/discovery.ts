export interface SearchToolsInput { query?: string; namespace?: string; limit?: number; cursor?: string }
export interface SearchResultEntry { name: string; summary: string; namespace?: string; schemaHash: string }
export interface SearchToolsResult { results: SearchResultEntry[]; total: number; fallback: boolean; nextCursor?: string }

export interface DescribeToolsInput { names: string[] }
export interface ToolDescription {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
  sdkExcerpt?: string
  schemaHash: string
}
export interface DescribeToolsResult { tools: ToolDescription[] }

export interface CatalogEntry { name: string; description: string }

/** Shared deterministic lexical ranker used by live Search and offline evaluation. */
export function rankCatalog<T extends CatalogEntry>(catalog: readonly T[], input: { query?: string; namespace?: string }): T[] {
  const query = input.query?.trim().toLocaleLowerCase('en-US') ?? ''
  return catalog.filter(tool =>
    (input.namespace === undefined || tool.name.startsWith(input.namespace + '.'))
    && (query.length === 0 || query === '*'
      || tool.name.toLocaleLowerCase('en-US').includes(query)
      || tool.description.toLocaleLowerCase('en-US').includes(query)))
    .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
}

/** Discovery reads the live registry; it never mutates authorization or the session surface. */
export interface DiscoveryModule {
  search(input: SearchToolsInput): Promise<SearchToolsResult>
  describe(input: DescribeToolsInput): Promise<DescribeToolsResult>
}
