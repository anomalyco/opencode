import { expect, test } from "bun:test"
import { brand } from "@opencode/schema/brand"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api"
import { compile, emitEffectShape } from "../src"

const ID = Schema.String.pipe(brand("Example.ID"))
const Key = Schema.String.pipe(brand("Example.Key"))

test.each([
  {
    name: "suspended schemas",
    schema: Schema.suspend(() => ID),
    type: '(string) & Brand.Brand<"Example.ID">',
  },
  {
    name: "Option type parameters",
    schema: Schema.Option(ID),
    type: 'Option.Option<(string) & Brand.Brand<"Example.ID">>',
  },
  {
    name: "ReadonlyMap keys and values",
    schema: Schema.ReadonlyMap(Key, ID),
    type: 'globalThis.ReadonlyMap<(string) & Brand.Brand<"Example.Key">, (string) & Brand.Brand<"Example.ID">>',
  },
  {
    name: "literal-key records",
    schema: Schema.Record(Schema.Literals(["first", "second"]), ID),
    type: '{ readonly "first": (string) & Brand.Brand<"Example.ID">, readonly "second": (string) & Brand.Brand<"Example.ID"> }',
  },
])("preserves brands in $name without branding sibling strings", ({ schema, type }) => {
  const output = emitEffectShape(
    compile(
      HttpApi.make("test").add(
        HttpApiGroup.make("example").add(
          HttpApiEndpoint.get("get", "/", { success: Schema.Struct({ value: schema, plain: Schema.String }) }),
        ),
      ),
    ),
  )
  expect(output.files[0]?.content).toContain(
    `export type ExampleGetOutput = { readonly "value": ${type}, readonly "plain": string }`,
  )
})
