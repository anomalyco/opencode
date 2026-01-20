import { describe, expect, test } from "bun:test"
import { schemaToFields, type FormField } from "../../../src/cli/cmd/tui/routes/session/elicitation-schema"
import type { Elicitation } from "../../../src/mcp/elicitation"

describe("schemaToFields", () => {
  test("converts string field", () => {
    const schema: Elicitation.RequestedSchema = {
      type: "object",
      properties: {
        name: {
          type: "string",
          title: "Your Name",
          description: "Enter your name",
        },
      },
    }

    const fields = schemaToFields(schema)

    expect(fields.length).toBe(1)
    expect(fields[0].key).toBe("name")
    expect(fields[0].type).toBe("string")
    expect(fields[0].title).toBe("Your Name")
    expect(fields[0].description).toBe("Enter your name")
    expect(fields[0].required).toBe(false)
  })

  test("converts string field with validation constraints", () => {
    const schema: Elicitation.RequestedSchema = {
      type: "object",
      properties: {
        email: {
          type: "string",
          title: "Email",
          format: "email",
          minLength: 5,
          maxLength: 100,
        },
      },
    }

    const fields = schemaToFields(schema)

    expect(fields[0].format).toBe("email")
    expect(fields[0].minLength).toBe(5)
    expect(fields[0].maxLength).toBe(100)
  })

  test("converts number field", () => {
    const schema: Elicitation.RequestedSchema = {
      type: "object",
      properties: {
        age: {
          type: "number",
          title: "Age",
          description: "Your age",
          minimum: 0,
          maximum: 150,
        },
      },
    }

    const fields = schemaToFields(schema)

    expect(fields[0].type).toBe("number")
    expect(fields[0].minimum).toBe(0)
    expect(fields[0].maximum).toBe(150)
  })

  test("converts integer field as number type", () => {
    const schema: Elicitation.RequestedSchema = {
      type: "object",
      properties: {
        count: {
          type: "integer",
          title: "Count",
        },
      },
    }

    const fields = schemaToFields(schema)

    expect(fields[0].type).toBe("number")
  })

  test("converts boolean field", () => {
    const schema: Elicitation.RequestedSchema = {
      type: "object",
      properties: {
        subscribe: {
          type: "boolean",
          title: "Subscribe",
          description: "Subscribe to newsletter",
          default: true,
        },
      },
    }

    const fields = schemaToFields(schema)

    expect(fields[0].type).toBe("boolean")
    expect(fields[0].default).toBe(true)
  })

  test("converts enum field with oneOf", () => {
    const schema: Elicitation.RequestedSchema = {
      type: "object",
      properties: {
        color: {
          type: "string",
          title: "Favorite Color",
          oneOf: [
            { const: "red", title: "Red" },
            { const: "green", title: "Green" },
            { const: "blue", title: "Blue" },
          ],
        },
      },
    }

    const fields = schemaToFields(schema)

    expect(fields[0].type).toBe("enum")
    expect(fields[0].options).toEqual([
      { value: "red", label: "Red" },
      { value: "green", label: "Green" },
      { value: "blue", label: "Blue" },
    ])
  })

  test("converts enum field with plain enum array", () => {
    const schema: Elicitation.RequestedSchema = {
      type: "object",
      properties: {
        size: {
          type: "string",
          title: "Size",
          enum: ["small", "medium", "large"],
        },
      },
    }

    const fields = schemaToFields(schema)

    expect(fields[0].type).toBe("enum")
    expect(fields[0].options).toEqual([
      { value: "small", label: "small" },
      { value: "medium", label: "medium" },
      { value: "large", label: "large" },
    ])
  })

  test("converts enum field with enumNames", () => {
    const schema: Elicitation.RequestedSchema = {
      type: "object",
      properties: {
        size: {
          type: "string",
          title: "Size",
          enum: ["s", "m", "l"],
          enumNames: ["Small", "Medium", "Large"],
        },
      },
    }

    const fields = schemaToFields(schema)

    expect(fields[0].options).toEqual([
      { value: "s", label: "Small" },
      { value: "m", label: "Medium" },
      { value: "l", label: "Large" },
    ])
  })

  test("converts multiselect array field with anyOf", () => {
    const schema: Elicitation.RequestedSchema = {
      type: "object",
      properties: {
        features: {
          type: "array",
          title: "Features",
          items: {
            anyOf: [
              { const: "dark_mode", title: "Dark Mode" },
              { const: "notifications", title: "Notifications" },
            ],
          },
        },
      },
    }

    const fields = schemaToFields(schema)

    expect(fields[0].type).toBe("multiselect")
    expect(fields[0].options).toEqual([
      { value: "dark_mode", label: "Dark Mode" },
      { value: "notifications", label: "Notifications" },
    ])
  })

  test("converts multiselect array field with enum items", () => {
    const schema: Elicitation.RequestedSchema = {
      type: "object",
      properties: {
        tags: {
          type: "array",
          title: "Tags",
          items: {
            enum: ["urgent", "important", "normal"],
          },
        },
      },
    }

    const fields = schemaToFields(schema)

    expect(fields[0].type).toBe("multiselect")
    expect(fields[0].options).toEqual([
      { value: "urgent", label: "urgent" },
      { value: "important", label: "important" },
      { value: "normal", label: "normal" },
    ])
  })

  test("marks required fields", () => {
    const schema: Elicitation.RequestedSchema = {
      type: "object",
      properties: {
        name: { type: "string", title: "Name" },
        email: { type: "string", title: "Email" },
        phone: { type: "string", title: "Phone" },
      },
      required: ["name", "email"],
    }

    const fields = schemaToFields(schema)

    const nameField = fields.find((f) => f.key === "name")
    const emailField = fields.find((f) => f.key === "email")
    const phoneField = fields.find((f) => f.key === "phone")

    expect(nameField?.required).toBe(true)
    expect(emailField?.required).toBe(true)
    expect(phoneField?.required).toBe(false)
  })

  test("uses key as title when title is not provided", () => {
    const schema: Elicitation.RequestedSchema = {
      type: "object",
      properties: {
        username: { type: "string" },
      },
    }

    const fields = schemaToFields(schema)

    expect(fields[0].title).toBe("username")
  })

  test("handles default values", () => {
    const schema: Elicitation.RequestedSchema = {
      type: "object",
      properties: {
        name: { type: "string", title: "Name", default: "John" },
        count: { type: "number", title: "Count", default: 5 },
        active: { type: "boolean", title: "Active", default: true },
      },
    }

    const fields = schemaToFields(schema)

    expect(fields.find((f) => f.key === "name")?.default).toBe("John")
    expect(fields.find((f) => f.key === "count")?.default).toBe(5)
    expect(fields.find((f) => f.key === "active")?.default).toBe(true)
  })

  test("handles empty properties", () => {
    const schema: Elicitation.RequestedSchema = {
      type: "object",
      properties: {},
    }

    const fields = schemaToFields(schema)

    expect(fields).toEqual([])
  })

  test("handles multiple fields", () => {
    const schema: Elicitation.RequestedSchema = {
      type: "object",
      properties: {
        name: { type: "string", title: "Name" },
        age: { type: "number", title: "Age" },
        active: { type: "boolean", title: "Active" },
        color: {
          type: "string",
          title: "Color",
          oneOf: [{ const: "red", title: "Red" }],
        },
      },
      required: ["name"],
    }

    const fields = schemaToFields(schema)

    expect(fields.length).toBe(4)
    expect(fields.map((f) => f.type)).toEqual(["string", "number", "boolean", "enum"])
  })
})
