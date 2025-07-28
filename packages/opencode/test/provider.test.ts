import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { Provider } from "../src/provider/provider";

describe("Gemini Schema Transformation", () => {
  test("should remove default from union schemas", () => {
    const schema = z.union([z.string(), z.number()]).default("test");
    const jsonSchema = Provider.transformToolSchema(schema, "google")!;

    expect(jsonSchema["default"]).toBeUndefined();
    expect(Array.isArray(jsonSchema["type"])).toBe(true);
    expect(jsonSchema["type"]).toContain("string");
    expect(jsonSchema["type"]).toContain("number");
  });

  test("should remove default from anyOf schemas", () => {
    const schema = z.union([z.string(), z.object({ id: z.number() })]).default(
      "test",
    );
    const jsonSchema = Provider.transformToolSchema(schema, "google")!;

    expect(jsonSchema["default"]).toBeUndefined();
    expect(jsonSchema["anyOf"]).toBeDefined();
  });

  test("should remove additionalProperties", () => {
    const schema = z
      .object({
        name: z.string(),
        age: z.number(),
      })
      .strict();

    const jsonSchema = Provider.transformToolSchema(schema, "google")!;
    expect(jsonSchema["additionalProperties"]).toBeUndefined();
  });

  test("should preserve basic schema functionality", () => {
    const zodSchema = z.object({
      name: z.string(),
      age: z.number().optional(),
    });
    const result = zodSchema.parse({ name: "John", age: 30 });
    expect(result).toEqual({ name: "John", age: 30 });

    const result2 = zodSchema.parse({ name: "Jane" });
    expect(result2).toEqual({ name: "Jane" });
  });

  test("should handle a complex case with Gemini", () => {
    // NOTE: From the GitHub MCP server
    const input = {
      body: {
        description: "Review comment text",
        type: "string",
      },
      comments: {
        description:
          "Line-specific comments array of objects to place comments on pull request changes. Requires path and body. For line comments use line or position. For multi-line comments use start_line and line with optional side parameters.",
        type: "array",
        items: {
          additionalProperties: false,
          properties: {
            body: {
              description: "comment body",
              type: "string",
            },
            line: {
              anyOf: [{ type: "number" }, { type: "null" }],
              description:
                "line number in the file to comment on. For multi-line comments, the end of the line range",
            },
            path: {
              description: "path to the file",
              type: "string",
            },
            position: {
              anyOf: [{ type: "number" }, { type: "null" }],
              description: "position of the comment in the diff",
            },
            side: {
              anyOf: [{ type: "string" }, { type: "null" }],
              description:
                "The side of the diff on which the line resides. For multi-line comments, this is the side for the end of the line range. (LEFT or RIGHT)",
            },
            start_line: {
              anyOf: [{ type: "number" }, { type: "null" }],
              description:
                "The first line of the range to which the comment refers. Required for multi-line comments.",
            },
            start_side: {
              anyOf: [{ type: "string" }, { type: "null" }],
              description:
                "The side of the diff on which the start line resides for multi-line comments. (LEFT or RIGHT)",
            },
          },
          required: [
            "path",
            "body",
            "position",
            "line",
            "side",
            "start_line",
            "start_side",
          ],
          type: "object",
        },
      },
      commitId: {
        description: "SHA of commit to review",
        type: "string",
      },
      event: {
        description: "Review action to perform",
        enum: ["APPROVE", "REQUEST_CHANGES", "COMMENT"],
        type: "string",
      },
      owner: {
        description: "Repository owner",
        type: "string",
      },
      pullNumber: {
        description: "Pull request number",
        type: "number",
      },
    };

    const fullJsonSchema = {
      type: "object" as const,
      properties: input,
      required: Object.keys(input),
    };

    const jsonSchema = Provider.transformToolSchema(fullJsonSchema, "google")!;
    delete (jsonSchema as any)["$schema"]; // Don't compare this

    // The expected schema after Gemini-specific sanitization.
    // Notably, =additionalProperties= is removed from =comments.items=.
    const expected = {
      type: "object",
      properties: {
        body: {
          description: "Review comment text",
          type: "string",
        },
        comments: {
          description:
            "Line-specific comments array of objects to place comments on pull request changes. Requires path and body. For line comments use line or position. For multi-line comments use start_line and line with optional side parameters.",
          type: "array",
          items: {
            properties: {
              body: {
                description: "comment body",
                type: "string",
              },
              line: {
                anyOf: [{ type: "number" }, { type: "null" }],
                description:
                  "line number in the file to comment on. For multi-line comments, the end of the line range",
              },
              path: {
                description: "path to the file",
                type: "string",
              },
              position: {
                anyOf: [{ type: "number" }, { type: "null" }],
                description: "position of the comment in the diff",
              },
              side: {
                anyOf: [{ type: "string" }, { type: "null" }],
                description:
                  "The side of the diff on which the line resides. For multi-line comments, this is the side for the end of the line range. (LEFT or RIGHT)",
              },
              start_line: {
                anyOf: [{ type: "number" }, { type: "null" }],
                description:
                  "The first line of the range to which the comment refers. Required for multi-line comments.",
              },
              start_side: {
                anyOf: [{ type: "string" }, { type: "null" }],
                description:
                  "The side of the diff on which the start line resides for multi-line comments. (LEFT or RIGHT)",
              },
            },
            required: [
              "path",
              "body",
              "position",
              "line",
              "side",
              "start_line",
              "start_side",
            ],
            type: "object",
          },
        },
        commitId: {
          description: "SHA of commit to review",
          type: "string",
        },
        event: {
          description: "Review action to perform",
          enum: ["APPROVE", "REQUEST_CHANGES", "COMMENT"],
          type: "string",
        },
        owner: {
          description: "Repository owner",
          type: "string",
        },
        pullNumber: {
          description: "Pull request number",
          type: "number",
        },
      },
      required: Object.keys(input),
    };

    expect(jsonSchema).toEqual(expected);
  });
});
