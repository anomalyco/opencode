import z from "zod"

export abstract class NamedError extends Error {
  abstract schema(): z.core.$ZodType
  abstract toObject(): { name: string; data: any }

  static create<Name extends string, Data extends z.core.$ZodType>(name: Name, data: Data) {
    const schema = z
      .object({
        name: z.literal(name),
        data,
      })
      .meta({
        ref: name,
      })
    const result = class extends NamedError {
      public static readonly Schema = schema

      public override readonly name = name as Name

      constructor(
        public readonly data: z.input<Data>,
        options?: ErrorOptions,
      ) {
        super(name, options)
        this.name = name
      }

      static isInstance(input: any): input is InstanceType<typeof result> {
        return typeof input === "object" && "name" in input && input.name === name
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

  public static readonly Unknown = NamedError.create(
    "UnknownError",
    z.object({
      message: z.string(),
    }),
  )
}
