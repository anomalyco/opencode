import { Schema } from "effect"

export abstract class NamedError extends Error {
  abstract schema(): Schema.Top
  abstract toObject(): { name: string; data: unknown }

  static hasName(error: unknown, name: string): boolean {
    return (
      typeof error === "object" && error !== null && "name" in error && (error as Record<string, unknown>).name === name
    )
  }

  static create<Name extends string, Fields extends Schema.Struct.Fields>(
    name: Name,
    fields: Fields,
  ): ReturnType<typeof NamedError.createSchemaClass<Name, Schema.Struct<Fields>>>
  static create<Name extends string, DataSchema extends Schema.Top>(
    name: Name,
    data: DataSchema,
  ): ReturnType<typeof NamedError.createSchemaClass<Name, DataSchema>>
  static create<Name extends string>(name: Name, data: Schema.Top | Schema.Struct.Fields) {
    return NamedError.createSchemaClass(name, Schema.isSchema(data) ? data : Schema.Struct(data))
  }

  private static createSchemaClass<Name extends string, DataSchema extends Schema.Top>(name: Name, data: DataSchema) {
    const schema = Schema.Struct({
      name: Schema.Literal(name),
      data,
    }).annotate({ identifier: name })
    type Data = Schema.Schema.Type<DataSchema>

    const result = class extends NamedError {
      public static readonly Schema = schema
      public static readonly EffectSchema = schema
      public static readonly tag = name

      public override readonly name = name

      constructor(
        public readonly data: Data,
        options?: ErrorOptions,
      ) {
        // Error.message is the human detail only; the tag lives on `.name`, and renderers
        // (Cause.pretty, Error.toString) compose "${name}: ${message}".
        const message =
          typeof data === "object" && data !== null && "message" in data && typeof data.message === "string"
            ? data.message
            : ""
        super(message, options)
        this.name = name
      }

      static isInstance(input: unknown): input is InstanceType<typeof result> {
        return NamedError.hasName(input, name)
      }

      schema() {
        return schema
      }

      toObject() {
        return {
          name: name,
          data: this.data,
        }
      }
    }
    Object.defineProperty(result, "name", { value: name })
    return result
  }

  public static readonly Unknown = NamedError.create("UnknownError", {
    message: Schema.String,
    ref: Schema.optional(Schema.String),
  })
}
