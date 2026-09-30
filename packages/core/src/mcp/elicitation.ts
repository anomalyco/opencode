export * as McpElicitation from "./elicitation.js"

import { Effect } from "effect"
import { waitForAbort } from "@opencode/util/process"
import { Form } from "../form.js"
import type { McpClient } from "./client.js"

const URL_FIELD_KEY = "elicitation"

/** Answers one connection's elicitation requests with forms owned by `sessionID`. */
export const handler = (forms: Form.Interface, sessionID: string): McpClient.ElicitationHandler => {
  // Legacy era only: pending URL-mode elicitation forms, settled by notifications/elicitation/complete.
  const pending = new Map<string, Form.ID>()
  return {
    create: (request) =>
      Effect.gen(function* () {
        if (request.params.mode === "url") {
          const formID = Form.ID.create()
          // Legacy only: 2026-07-28 has no elicitationId and no completion notification, so the form
          // settles when the user confirms and the SDK retries the tool call itself.
          const elicitationID: string | undefined = request.params.elicitationId
          if (elicitationID !== undefined) pending.set(elicitationID, formID)
          return yield* forms
            .ask({
              id: formID,
              sessionID,
              title: `${request.server} is requesting input`,
              metadata: {
                kind: "mcp-elicitation",
                server: request.server,
                ...(elicitationID === undefined ? {} : { elicitationID }),
                message: request.params.message,
              },
              fields: [{ key: URL_FIELD_KEY, type: "external", url: request.params.url }],
            })
            .pipe(
              Effect.raceFirst(waitForAbort(request.signal)),
              Effect.ensuring(Effect.sync(() => elicitationID !== undefined && pending.delete(elicitationID))),
              Effect.map(
                (state): McpClient.ElicitationResult => ({
                  action: state.status === "answered" ? "accept" : "cancel",
                }),
              ),
            )
        }
        const params = request.params
        const [field, ...fields] = Object.entries(params.requestedSchema.properties).map(([key, property]) =>
          toField(key, property, params.requestedSchema.required?.includes(key) === true),
        )
        if (!field) return { action: "accept", content: {} }
        return yield* forms
          .ask({
            sessionID,
            title: `${request.server} is requesting input`,
            metadata: { kind: "mcp-elicitation", server: request.server, message: params.message },
            fields: [field, ...fields],
          })
          .pipe(
            Effect.raceFirst(waitForAbort(request.signal)),
            Effect.map((state): McpClient.ElicitationResult => {
              if (state.status !== "answered") return { action: "cancel" }
              return {
                action: "accept",
                content: Object.fromEntries(
                  Object.entries(state.answer).map(
                    ([key, value]): [string, NonNullable<McpClient.ElicitationResult["content"]>[string]] =>
                      typeof value === "object" ? [key, Array.from(value)] : [key, value],
                  ),
                ),
              }
            }),
          )
      }),
    complete: (request) =>
      Effect.gen(function* () {
        const formID = pending.get(request.elicitationID)
        if (!formID) return
        yield* forms.reply({ id: formID, answer: { [URL_FIELD_KEY]: true } }).pipe(Effect.ignore)
      }),
  }
}

// Schema `optional` strips undefined-valued properties on encode, so fields can assign
// optional properties directly instead of conditionally spreading them.
function toField(key: string, property: ElicitationProperty, required: boolean): Form.Field {
  // Some servers emit machine titles like "string with format email"; prefer description/key over those.
  const machineTitle = /^(boolean|string|number|integer|array|object)(\s+with\b.*|\s+in\b.*)?$/i
  const title =
    property.title && !machineTitle.test(property.title.trim()) ? property.title : (property.description ?? key)
  const base = {
    key,
    title,
    description: property.description === title ? undefined : property.description,
    required: required || undefined,
  }
  switch (property.type) {
    case "boolean":
      return { ...base, type: "boolean", default: property.default }
    case "number":
    case "integer":
      return {
        ...base,
        type: property.type,
        minimum: property.minimum,
        maximum: property.maximum,
        default: property.default,
      }
    case "array":
      return {
        ...base,
        type: "multiselect",
        options:
          "anyOf" in property.items
            ? property.items.anyOf.map((option) => ({ value: option.const, label: option.title }))
            : property.items.enum.map((value) => ({ value, label: value })),
        custom: false,
        minItems: property.minItems,
        maxItems: property.maxItems,
        default: property.default,
      }
    case "string": {
      const options =
        "oneOf" in property
          ? property.oneOf.map((option) => ({ value: option.const, label: option.title }))
          : "enum" in property
            ? property.enum.map((value, index) => ({
                value,
                label: ("enumNames" in property ? property.enumNames?.[index] : undefined) ?? value,
              }))
            : undefined
      return {
        ...base,
        type: "string",
        format: "format" in property ? property.format : undefined,
        minLength: "minLength" in property ? property.minLength : undefined,
        maxLength: "maxLength" in property ? property.maxLength : undefined,
        default: property.default,
        options,
        custom: options ? false : undefined,
      }
    }
  }
}

type ElicitationProperty = McpClient.ElicitationFormParams["requestedSchema"]["properties"][string]
