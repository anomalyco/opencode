import { expect, test } from "bun:test"

import { Provider } from "../../src/provider/provider"

test("normalizeOpenAISchemaRequest normalizes tool parameter schemas", () => {
  const body = {
    tools: [
      {
        type: "function",
        function: {
          name: "search",
          parameters: {
            type: "object",
            required: null,
            properties: {
              query: { type: "string" },
              filters: {
                type: "object",
                properties: {
                  date: {
                    type: "object",
                  },
                },
              },
            },
          },
        },
      },
    ],
  }

  Provider.normalizeOpenAISchemaRequest(body)

  const parameters = body.tools[0].function.parameters as Record<string, unknown>
  const filters = (parameters.properties as Record<string, unknown>).filters as Record<string, unknown>
  const date = (filters.properties as Record<string, unknown>).date as Record<string, unknown>

  expect(parameters.required).toEqual([])
  expect(filters.required).toEqual([])
  expect(date.required).toEqual([])
})

test("normalizeOpenAISchemaRequest normalizes response schemas", () => {
  const body = {
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "summary",
        schema: {
          type: "object",
          properties: {
            result: {
              type: "object",
              required: null,
              additionalProperties: {
                type: "object",
              },
            },
          },
        },
      },
    },
    text: {
      format: {
        type: "json_schema",
        name: "summary",
        schema: {
          type: "object",
          required: null,
        },
      },
    },
  }

  Provider.normalizeOpenAISchemaRequest(body)

  const schema = body.response_format.json_schema.schema as Record<string, unknown>
  const result = (schema.properties as Record<string, unknown>).result as Record<string, unknown>
  const additional = result.additionalProperties as Record<string, unknown>
  const textSchema = body.text.format.schema as Record<string, unknown>

  expect(schema.required).toEqual([])
  expect(result.required).toEqual([])
  expect(additional.required).toEqual([])
  expect(textSchema.required).toEqual([])
})

test("normalizeOpenAISchemaRequest keeps valid required arrays unchanged", () => {
  const body = {
    tools: [
      {
        type: "function",
        function: {
          name: "echo",
          parameters: {
            type: "object",
            required: ["message"],
            properties: {
              message: { type: "string" },
            },
          },
        },
      },
    ],
  }

  Provider.normalizeOpenAISchemaRequest(body)

  expect(body.tools[0].function.parameters.required).toEqual(["message"])
})
