import { Schema, SchemaAST } from "effect"

// Effect brands are type-only; retain explicit metadata for our schema code generator.
export const BrandAnnotation = Symbol.for("@opencode/schema/brands")

declare module "effect/Schema" {
  namespace Annotations {
    interface Annotations {
      readonly [BrandAnnotation]?: ReadonlyArray<string>
    }
  }
}

const resolve = SchemaAST.resolveAt<ReadonlyArray<string>>(BrandAnnotation as unknown as string)

export const brand =
  <B extends string>(identifier: Parameters<typeof Schema.brand<B>>[0]) =>
  <S extends Schema.ConstraintRebuildable>(schema: S) =>
    Schema.brand<B>(identifier)(schema).annotate({
      [BrandAnnotation]: [...(resolve(schema.ast) ?? []), identifier],
    })
