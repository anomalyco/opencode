import { expect, test } from "bun:test"
import { canSubmitDialogSelection, type DialogSelectOption } from "../src/ui/dialog-select"
import { modelCatalogAttentionHandler } from "../src/component/dialog-model"

test("empty selection notifies the interested dialog", () => {
  let calls = 0
  expect(canSubmitDialogSelection(undefined, () => calls++)).toBe(false)
  expect(calls).toBe(1)
})

test("available selection submits without empty notification", () => {
  let calls = 0
  const option: DialogSelectOption<string> = { title: "Model", value: "model" }
  expect(canSubmitDialogSelection(option, () => calls++)).toBe(true)
  expect(calls).toBe(0)
})

test("empty model confirmation triggers only for a loading catalog", () => {
  let calls = 0
  const trigger = () => calls++

  expect(canSubmitDialogSelection(undefined, modelCatalogAttentionHandler("loading", trigger))).toBe(false)
  expect(calls).toBe(1)
  expect(canSubmitDialogSelection(undefined, modelCatalogAttentionHandler("partial", trigger))).toBe(false)
  expect(canSubmitDialogSelection(undefined, modelCatalogAttentionHandler("complete", trigger))).toBe(false)
  expect(calls).toBe(1)
})

test("ordinary empty model searches remain silent after the catalog settles", () => {
  let calls = 0
  expect(canSubmitDialogSelection(undefined, modelCatalogAttentionHandler("complete", () => calls++))).toBe(false)
  expect(calls).toBe(0)
})
