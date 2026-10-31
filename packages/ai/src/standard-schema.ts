// The Standard Schema and Standard JSON Schema interfaces (https://standardschema.dev), copied as the spec recommends so
// accepting them adds no dependency. Trimmed to the members this package reads.

export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": StandardSchemaV1.Props<Input, Output>
}

export declare namespace StandardSchemaV1 {
  export interface Props<Input = unknown, Output = Input> {
    readonly version: 1
    readonly vendor: string
    readonly validate: (value: unknown) => Result<Output> | Promise<Result<Output>>
    readonly types?: Types<Input, Output> | undefined
  }

  export type Result<Output> = { readonly value: Output; readonly issues?: undefined } | FailureResult

  export interface FailureResult {
    readonly issues: ReadonlyArray<Issue>
  }

  export interface Issue {
    readonly message: string
    readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined
  }

  export interface Types<Input = unknown, Output = Input> {
    readonly input: Input
    readonly output: Output
  }

  export type InferOutput<Schema extends StandardSchemaV1> = NonNullable<Schema["~standard"]["types"]>["output"]
}

export interface StandardJSONSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": StandardJSONSchemaV1.Props<Input, Output>
}

export declare namespace StandardJSONSchemaV1 {
  export interface Props<Input = unknown, Output = Input> {
    readonly version: 1
    readonly vendor: string
    readonly types?: StandardSchemaV1.Types<Input, Output> | undefined
    readonly jsonSchema: Converter
  }

  export interface Converter {
    readonly input: (options: Options) => Record<string, unknown>
    readonly output: (options: Options) => Record<string, unknown>
  }

  export interface Options {
    readonly target: "draft-2020-12" | "draft-07" | "openapi-3.0" | ({} & string)
    readonly libraryOptions?: Record<string, unknown> | undefined
  }
}
