export interface InvokeToolInput {
  name: string
  arguments: Record<string, unknown>
  describedSchemaHash?: string
}

export class ToolSchemaChangedError extends Error {
  constructor(readonly toolName: string) {
    super('Tool schema changed; describe the tool again before retrying: ' + toolName)
    this.name = 'ToolSchemaChangedError'
  }
}

/** Implementations delegate to the current ToolRuntime and its complete execution pipeline. */
export interface InvocationModule {
  invoke(input: InvokeToolInput): Promise<unknown>
}
