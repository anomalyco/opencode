export interface ServerApi {
  readonly name: string
  readonly groups: readonly string[]
}

export interface OpenApiSpec {
  readonly openapi: string
  readonly info: {
    readonly title: string
    readonly version: string
    readonly description: string
  }
  readonly paths: Record<string, never>
}
