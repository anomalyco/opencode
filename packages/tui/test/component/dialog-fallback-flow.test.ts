import { describe, expect, test } from "bun:test"
import { fallbackPickerRows, listVisionCapableModels } from "../../src/component/dialog-fallback-flow"
import type { ModelShape } from "../../src/util/model"

function model(partial: {
  name?: string
  status?: ModelShape["status"]
  attachment?: boolean
  image?: boolean
  pdf?: boolean
}): ModelShape {
  return {
    id: "m",
    name: partial.name ?? "M",
    status: partial.status ?? "active",
    capabilities: {
      attachment: partial.attachment ?? false,
      reasoning: false,
      toolcall: true,
      temperature: true,
      input: {
        text: true,
        image: partial.image ?? false,
        audio: false,
        video: false,
        pdf: partial.pdf ?? false,
      },
      output: { text: true, image: false, audio: false, video: false, pdf: false },
    },
  } as ModelShape
}

describe("dialog-fallback-flow listVisionCapableModels", () => {
  test("keeps image/pdf models, drops attachment-only and deprecated", () => {
    const listed = listVisionCapableModels([
      {
        id: "p",
        name: "Provider",
        models: {
          vision: model({ name: "Vision", image: true }),
          pdf: model({ name: "PDF", pdf: true }),
          attach: model({ name: "Attach", attachment: true }),
          old: model({ name: "Old", image: true, status: "deprecated" }),
          text: model({ name: "Text" }),
        },
      },
    ])
    expect(listed.map((m) => m.modelID).toSorted()).toEqual(["pdf", "vision"])
  })

  test("preserves nested model ids in keys", () => {
    const listed = listVisionCapableModels([
      {
        id: "provider",
        name: "Provider",
        models: {
          "family/vision": model({ name: "Nested", image: true }),
        },
      },
    ])
    expect(listed).toEqual([
      {
        providerID: "provider",
        modelID: "family/vision",
        title: "Nested",
        category: "Provider",
      },
    ])
  })
})

describe("dialog-fallback-flow fallbackPickerRows", () => {
  test("orders Currently, Clear, then models", () => {
    const current = { providerID: "p", modelID: "v" }
    const models = [
      {
        providerID: "p",
        modelID: "v2",
        title: "V2",
        category: "Provider",
      },
    ]
    expect(
      fallbackPickerRows({
        current,
        clearLabel: "Clear global vision fallback",
        models,
      }),
    ).toEqual([
      { value: "__current__", title: "Currently: p/v" },
      { value: "__clear__", title: "Clear global vision fallback" },
      {
        value: "p/v2",
        title: "V2",
        category: "Provider",
        model: { providerID: "p", modelID: "v2" },
      },
    ])
  })

  test("omits Currently and Clear when unset", () => {
    expect(fallbackPickerRows({ models: [] })).toEqual([])
  })
})
