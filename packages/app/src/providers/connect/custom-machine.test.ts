import { describe, expect, test } from "bun:test"
import {
  CUSTOM_MODELS_TIMEOUT_MS,
  CUSTOM_SUBMIT_IDLE,
  customProviderID,
  selectCustomSubmitView,
  transitionCustomSubmit,
  validateCustomProvider,
  type CustomProviderFields,
  type CustomSubmitEvent,
  type CustomSubmitState,
} from "./custom-machine"

const fields: CustomProviderFields = {
  name: " Acme Gateway ",
  id: "acme",
  idEdited: false,
  package: "@opencode/ai/providers/openai-compatible",
  baseURL: " https://llm.acme.example/v1 ",
  apiKey: "",
  models: [
    { key: "m1", id: " qwen3-coder ", name: " Qwen 3 Coder " },
    { key: "m2", id: "", name: "" },
  ],
  headers: [{ key: "h1", name: "", value: "" }],
}

const input = {
  id: "acme",
  name: "Acme Gateway",
  package: "@opencode/ai/providers/openai-compatible",
  baseURL: "https://llm.acme.example/v1",
  models: [{ id: "qwen3-coder", name: "Qwen 3 Coder" }],
} as const

describe("customProviderID", () => {
  test("slugs a display name", () => {
    expect(customProviderID("Acme Gateway")).toBe("acme-gateway")
    expect(customProviderID("  My LLM (local) ")).toBe("my-llm-local")
    expect(customProviderID("--Über_proxy!!")).toBe("ber_proxy")
    expect(customProviderID("")).toBe("")
  })
})

describe("validateCustomProvider", () => {
  test("trims fields and drops empty rows and the empty key", () => {
    expect(validateCustomProvider(fields, new Set())).toEqual({ type: "valid", input })
  })

  test("keeps the key, model names and headers that were filled in", () => {
    expect(
      validateCustomProvider(
        {
          ...fields,
          apiKey: " sk-acme ",
          models: [{ key: "m1", id: "llama-4", name: "" }],
          headers: [{ key: "h1", name: "x-team", value: "core" }],
        },
        new Set(),
      ),
    ).toEqual({
      type: "valid",
      input: { ...input, apiKey: "sk-acme", headers: { "x-team": "core" }, models: [{ id: "llama-4" }] },
    })
  })

  test("reports every invalid field at once", () => {
    expect(
      validateCustomProvider(
        {
          ...fields,
          name: " ",
          id: "Acme Gateway",
          baseURL: "llm.acme.example",
          models: [
            { key: "m1", id: "a", name: "" },
            { key: "m2", id: "a", name: "" },
            { key: "m3", id: "", name: "Named only" },
          ],
          headers: [{ key: "h1", name: "x-team", value: "" }],
        },
        new Set(),
      ),
    ).toEqual({
      type: "invalid",
      errors: {
        name: "required",
        id: "id.invalid",
        baseURL: "url.invalid",
        "models.m2": "model.duplicate",
        "models.m3": "required",
        "headers.h1": "header.incomplete",
      },
    })
  })

  test("needs a model, an http(s) URL and an ID nothing else uses", () => {
    expect(
      validateCustomProvider({ ...fields, baseURL: "ftp://llm.acme.example", models: [] }, new Set(["acme"])),
    ).toEqual({
      type: "invalid",
      errors: { id: "id.taken", baseURL: "url.invalid", models: "models.required" },
    })
    expect(validateCustomProvider({ ...fields, id: "", baseURL: "" }, new Set())).toEqual({
      type: "invalid",
      errors: { id: "required", baseURL: "required" },
    })
  })
})

describe("transitionCustomSubmit", () => {
  const run = (events: readonly CustomSubmitEvent[], state: CustomSubmitState = CUSTOM_SUBMIT_IDLE) =>
    events.reduce(
      (result, event) => {
        const next = transitionCustomSubmit(result.state, event)
        return { state: next.state, effects: [...result.effects, ...next.effects] }
      },
      { state, effects: [] as ReturnType<typeof transitionCustomSubmit>["effects"][number][] },
    )

  test("saves, waits for the models, then hands over the first one", () => {
    const result = run([
      { type: "submitted", input },
      { type: "save.succeeded", attempt: 1 },
      { type: "models.loaded", attempt: 1, firstModel: "acme:qwen3-coder" },
    ])

    expect(result.state).toEqual({ status: "done", attempt: 1 })
    expect(result.effects).toEqual([
      { type: "save", attempt: 1, input },
      { type: "timer.start", attempt: 1, timeoutMs: CUSTOM_MODELS_TIMEOUT_MS },
      { type: "timer.stop" },
      { type: "created", providerID: "acme", firstModel: "acme:qwen3-coder" },
    ])
  })

  test("still finishes when the models never load", () => {
    const result = run([
      { type: "submitted", input },
      { type: "save.succeeded", attempt: 1 },
      { type: "timed-out", attempt: 1 },
    ])

    expect(result.state.status).toBe("done")
    expect(result.effects.at(-1)).toEqual({ type: "created", providerID: "acme", firstModel: undefined })
  })

  test("a failed save returns to the form with the error, and can be retried", () => {
    const failed = run([
      { type: "submitted", input },
      { type: "save.failed", attempt: 1, error: "Provider already exists: acme" },
    ])

    expect(failed.state).toEqual({ status: "editing", attempt: 1, error: "Provider already exists: acme" })
    expect(selectCustomSubmitView(failed.state)).toEqual({
      busy: false,
      phase: undefined,
      error: "Provider already exists: acme",
    })

    const retried = run([{ type: "submitted", input }], failed.state)
    expect(retried.state).toEqual({ status: "saving", attempt: 2, providerID: "acme" })
    expect(selectCustomSubmitView(retried.state)).toEqual({ busy: true, phase: "saving", error: undefined })
  })

  test("ignores a second submit while saving and results from an earlier attempt", () => {
    const saving = run([{ type: "submitted", input }]).state

    expect(transitionCustomSubmit(saving, { type: "submitted", input }).state).toBe(saving)
    expect(transitionCustomSubmit(saving, { type: "save.succeeded", attempt: 0 }).state).toBe(saving)

    const loading = run([{ type: "save.succeeded", attempt: 1 }], saving).state
    expect(selectCustomSubmitView(loading)).toEqual({ busy: true, phase: "loading", error: undefined })
    expect(transitionCustomSubmit(loading, { type: "timed-out", attempt: 0 }).state).toBe(loading)
  })

  test("closing while waiting stops the timer and drops late results", () => {
    const loading = run([
      { type: "submitted", input },
      { type: "save.succeeded", attempt: 1 },
    ]).state
    const disposed = transitionCustomSubmit(loading, { type: "disposed" })

    expect(disposed).toEqual({ state: { status: "disposed", attempt: 1 }, effects: [{ type: "timer.stop" }] })
    expect(
      transitionCustomSubmit(disposed.state, { type: "models.loaded", attempt: 1, firstModel: "acme:x" }).effects,
    ).toEqual([])
  })
})
