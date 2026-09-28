import { expect, test } from "bun:test"
import { Effect } from "effect"
import type { FormFields } from "@opencode/client"
import { answerForm } from "../src/commands/handlers/auth/form"

test("resolves hidden defaults without an interactive terminal", async () => {
  const fields = [
    { type: "string", key: "server", hidden: true, default: "https://example.com/console" },
    { type: "boolean", key: "enabled", hidden: true, default: false },
    { type: "integer", key: "count", hidden: true, default: 0 },
    { type: "string", key: "optional", hidden: true },
  ] satisfies FormFields
  expect(await Effect.runPromise(answerForm(fields))).toEqual({
    server: "https://example.com/console",
    enabled: false,
    count: 0,
  })
  expect(await Effect.runPromise(answerForm(fields, ["server=https://staging.example.com/console"]))).toEqual({
    server: "https://staging.example.com/console",
    enabled: false,
    count: 0,
  })
})

test("parses typed answers and evaluates conditions in form order", async () => {
  const fields = [
    { type: "string", key: "deployment", options: [{ value: "enterprise", label: "Enterprise" }] },
    { type: "string", key: "host", when: [{ key: "deployment", op: "eq", value: "enterprise" }] },
    { type: "boolean", key: "enabled" },
    { type: "integer", key: "count", minimum: 0 },
    { type: "number", key: "rate" },
    { type: "multiselect", key: "scopes", options: [{ value: "read", label: "Read" }] },
  ] satisfies FormFields
  expect(
    await Effect.runPromise(
      answerForm(fields, [
        "host=example.com",
        "deployment=enterprise",
        "enabled=false",
        "count=0",
        "rate=1.5",
        'scopes=["read"]',
      ]),
    ),
  ).toEqual({ deployment: "enterprise", host: "example.com", enabled: false, count: 0, rate: 1.5, scopes: ["read"] })
})

test("preserves empty strings and equals signs in supplied text", async () => {
  expect(
    await Effect.runPromise(
      answerForm(
        [
          { type: "string", key: "server" },
          { type: "string", key: "optional" },
        ],
        ["server=https://example.com/console?tenant=a=b", "optional="],
      ),
    ),
  ).toEqual({ server: "https://example.com/console?tenant=a=b", optional: "" })
})

const invalidAnswers: { fields: FormFields | undefined; supplied: string[]; error: string }[] = [
  { fields: undefined, supplied: ["missing-separator"], error: "Expected --answer key=value" },
  { fields: undefined, supplied: ["=missing-key"], error: "Expected --answer key=value" },
  { fields: undefined, supplied: ["unknown=value"], error: "Unknown form field: unknown" },
  {
    fields: [{ type: "string", key: "known" }],
    supplied: ["unknown=value"],
    error: "Unknown form field: unknown",
  },
  {
    fields: [
      { type: "boolean", key: "enabled", hidden: true, default: false },
      { type: "string", key: "host", when: [{ key: "enabled", op: "eq", value: true }] },
    ],
    supplied: ["host=example.com"],
    error: "Form field is not active: host",
  },
  { fields: [{ type: "integer", key: "count" }], supplied: ["count=1.5"], error: "Expected an integer" },
  { fields: [{ type: "boolean", key: "enabled" }], supplied: ["enabled=yes"], error: "Expected a JSON value" },
  {
    fields: [{ type: "string", key: "server", format: "uri", hidden: true }],
    supplied: ["server=not a URL"],
    error: "Expected a URL",
  },
  {
    fields: [{ type: "string", key: "required", hidden: true, required: true }],
    supplied: [],
    error: "Answer required",
  },
  {
    fields: [{ type: "multiselect", key: "scopes", options: [{ value: "read", label: "Read" }] }],
    supplied: ['scopes=["write"]'],
    error: "Select only available options",
  },
  {
    fields: [{ type: "external", key: "approve", url: "https://example.com" }],
    supplied: ["approve=true"],
    error: "requires interactive confirmation",
  },
]

test.each(invalidAnswers)("rejects invalid form answers: $error", async (input) => {
  await expect(Effect.runPromise(answerForm(input.fields, input.supplied))).rejects.toThrow(input.error)
})
