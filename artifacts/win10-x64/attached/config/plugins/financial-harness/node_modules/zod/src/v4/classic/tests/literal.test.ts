import { expect, test } from "vitest";

import * as z from "zod/v4";

const literalTuna = z.literal("tuna");
const literalTunaCustomMessage = z.literal("tuna", {
  message: "That's not a tuna",
});
const literalFortyTwo = z.literal(42);
const literalTrue = z.literal(true);

test("passing validations", () => {
  literalTuna.parse("tuna");
  literalFortyTwo.parse(42);
  literalTrue.parse(true);
});

test("failing validations", () => {
  expect(() => literalTuna.parse("shark")).toThrow();
  expect(() => literalFortyTwo.parse(43)).toThrow();
  expect(() => literalTrue.parse(false)).toThrow();
});

test("invalid_literal should have `input` field with data", () => {
  const data = "shark";
  const result = literalTuna.safeParse(data);

  const issue = result.error!.issues[0];
  expect(issue.code).toBe("invalid_value");
  expect(issue).toMatchInlineSnapshot(`
    {
      "code": "invalid_value",
      "message": "Invalid input: expected "tuna"",
      "path": [],
      "values": [
        "tuna",
      ],
    }
  `);
});

test("invalid_literal should return default message", () => {
  const data = "shark";
  const result = literalTuna.safeParse(data);

  const issue = result.error!.issues[0];
  expect(issue.message).toEqual(`Invalid input: expected \"tuna\"`);
});

test("invalid_literal should return custom message", () => {
  const data = "shark";
  const result = literalTunaCustomMessage.safeParse(data);

  const issue = result.error!.issues[0];
  expect(issue.message).toEqual(`That's not a tuna`);
});

test("literal default error message", () => {
  const result = z.literal("Tuna").safeParse("Trout");
  expect(result.success).toEqual(false);
  expect(result.error!.issues.length).toEqual(1);
  expect(result.error).toMatchInlineSnapshot(`
    [ZodError: [
      {
        "code": "invalid_value",
        "values": [
          "Tuna"
        ],
        "path": [],
        "message": "Invalid input: expected \\"Tuna\\""
      }
    ]]
  `);
});

test("literal bigint default error message", () => {
  const result = z.literal(BigInt(12)).safeParse(BigInt(13));
  expect(result.success).toBe(false);

  expect(result.error!.issues.length).toEqual(1);
  expect(result.error!.issues[0].message).toEqual(`Invalid input: expected 12n`);
});

test(".value getter", () => {
  expect(z.literal("tuna").value).toEqual("tuna");
  expect(() => z.literal([1, 2, 3]).value).toThrow();
});

test("readonly", () => {
  const a = ["asdf"] as const;
  z.literal(a);
});

test("literal pattern", () => {
  expect(z.literal(1.1)._zod.pattern).toMatchInlineSnapshot(`/\\^\\(1\\\\\\.1\\)\\$/`);

  expect(z.templateLiteral([z.literal(1.1)]).safeParse("1.1")).toMatchInlineSnapshot(`
    {
      "data": "1.1",
      "success": true,
    }
  `);
  expect(z.templateLiteral([z.literal(1.1)]).safeParse("1n1")).toMatchInlineSnapshot(`
    {
      "error": [ZodError: [
      {
        "code": "invalid_format",
        "format": "template_literal",
        "pattern": "^(1\\\\.1)$",
        "path": [],
        "message": "Invalid input"
      }
    ]],
      "success": false,
    }
  `);
});
