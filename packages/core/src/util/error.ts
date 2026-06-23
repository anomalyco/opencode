import { Cause, Schema } from "effect"

const GENERIC_UNKNOWN_MESSAGES = new Set(["An error occurred in Effect.try", "An error occurred in Effect.tryPromise"])

export function errorMessage(error: unknown): string {
  try {
    return renderErrorMessage(error, new Set())
  } catch {
    return "Unknown error"
  }
}

export function causeMessage(cause: Cause.Cause<unknown>): string {
  const failure = cause.reasons.find(Cause.isFailReason)
  if (failure) return errorMessage(failure.error)
  const defect = cause.reasons.find(Cause.isDieReason)
  if (defect) return errorMessage(defect.defect)
  if (cause.reasons.some(Cause.isInterruptReason)) return "Interrupted"
  return "Unknown error"
}

function renderErrorMessage(error: unknown, seen: Set<object>): string {
  if (typeof error === "string" && error) return error
  if (typeof error !== "object" || error === null) {
    const text = String(error)
    return text && text !== "undefined" && text !== "null" ? text : "Unknown error"
  }
  if (seen.has(error)) return "Unknown error"
  seen.add(error)

  if (
    Cause.isUnknownError(error) &&
    error.cause !== error &&
    (!error.message || GENERIC_UNKNOWN_MESSAGES.has(error.message))
  )
    return renderErrorMessage(error.cause, seen)

  if ("data" in error && isRecord(error.data) && typeof error.data.message === "string" && error.data.message)
    return error.data.message
  if (error instanceof Error) {
    if (error.message) return error.message
    if (error.cause !== error && error.cause !== undefined) {
      const message = renderErrorMessage(error.cause, seen)
      if (message !== "Unknown error") return message
    }
    if (error.name) return error.name
  }
  if ("message" in error && typeof error.message === "string" && error.message) return error.message

  // oxlint-disable-next-line no-base-to-string -- custom toString values are useful error messages
  const text = String(error)
  if (text && text !== "[object Object]") return text
  if ("_tag" in error && typeof error._tag === "string" && error._tag) return error._tag
  if ("name" in error && typeof error.name === "string" && error.name) return error.name
  return "Unknown error"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

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
        super(name, options)
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
