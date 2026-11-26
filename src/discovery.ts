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

/** Discovery reads the live registry; it never mutates authorization or the session surface. */
export interface DiscoveryModule {
  search(input: SearchToolsInput): Promise<SearchToolsResult>
  describe(input: DescribeToolsInput): Promise<DescribeToolsResult>
}
