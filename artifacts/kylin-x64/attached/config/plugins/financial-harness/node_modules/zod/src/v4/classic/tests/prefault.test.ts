import { expect, expectTypeOf, test } from "vitest";
import { z } from "zod/v4";

test("basic prefault", () => {
  const a = z.prefault(z.string().trim(), "  default  ");
  expect(a).toBeInstanceOf(z.ZodPrefault);
  expect(a.parse("  asdf  ")).toEqual("asdf");
  expect(a.parse(undefined)).toEqual("default");

  type inp = z.input<typeof a>;
  expectTypeOf<inp>().toEqualTypeOf<string | undefined>();
  type out = z.output<typeof a>;
  expectTypeOf<out>().toEqualTypeOf<string>();
});

test("prefault inside object", () => {
  // test optinality
  const a = z.object({
    name: z.string().optional(),
    age: z.number().default(1234),
    email: z.string().prefault("1234"),
  });

  type inp = z.input<typeof a>;
  expectTypeOf<inp>().toEqualTypeOf<{
    name?: string | undefined;
    age?: number | undefined;
    email?: string | undefined;
  }>();

  type out = z.output<typeof a>;
  expectTypeOf<out>().toEqualTypeOf<{
    name?: string | undefined;
    age: number;
    email: string;
  }>();
});

test("object schema with prefault should return shallow clone", () => {
  const schema = z
    .object({
      a: z.string(),
    })
    .default({ a: "x" });
  const result1 = schema.parse(undefined);
  const result2 = schema.parse(undefined);
  expect(result1).not.toBe(result2);
  expect(result1).toEqual(result2);
});

test("direction-aware prefault", () => {
  const schema = z.string().prefault("hello");

  // Forward direction (regular parse): prefault should be applied
  expect(schema.parse(undefined)).toBe("hello");

  // Reverse direction (encode): prefault should NOT be applied, undefined should fail validation
  expect(z.safeEncode(schema, undefined as any)).toMatchInlineSnapshot(`
    {
      "error": [ZodError: [
      {
        "expected": "string",
        "code": "invalid_type",
        "path": [],
        "message": "Invalid input: expected string, received undefined"
      }
    ]],
      "success": false,
    }
  `);

  // But valid values should still work in reverse
  expect(z.encode(schema, "world")).toBe("world");
});
