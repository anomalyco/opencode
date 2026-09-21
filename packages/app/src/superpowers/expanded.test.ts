import { expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createExecutionExpansion } from "./expanded"
import { createExecutionModel } from "./model"

async function flush() {
  for (let index = 0; index < 10; index += 1) await Promise.resolve()
}

test("collapse restores the tab, width, and focus saved before expansion", async () => {
  const [tab, setTab] = createSignal<string | undefined>("file://a.ts")
  const [width, setWidth] = createSignal(600)
  const trigger = document.createElement("button")
  document.body.appendChild(trigger)
  const dispose = createRoot((dispose) => {
    const model = createExecutionModel()
    const expansion = createExecutionExpansion({
      model: () => model,
      key: () => "root",
      activeTab: tab,
      selectTab: setTab,
      panelWidth: width,
      resizePanel: setWidth,
    })
    trigger.focus()
    expansion.expand()
    expect(model.expanded()).toBe(true)
    setTab("file://b.ts")
    setWidth(900)
    expansion.collapse()
    expect(model.expanded()).toBe(false)
    return dispose
  })
  await flush()
  expect(tab()).toBe("file://a.ts")
  expect(width()).toBe(600)
  expect(document.activeElement).toBe(trigger)
  trigger.remove()
  dispose()
})

test("a root switch drops the saved presentation state instead of restoring it", async () => {
  const [tab, setTab] = createSignal<string | undefined>("file://a.ts")
  const [width, setWidth] = createSignal(600)
  const [key, setKey] = createSignal("root")
  const dispose = createRoot((dispose) => {
    const model = createExecutionModel()
    const expansion = createExecutionExpansion({
      model: () => model,
      key,
      activeTab: tab,
      selectTab: setTab,
      panelWidth: width,
      resizePanel: setWidth,
    })
    expansion.expand()
    setTab("file://b.ts")
    setWidth(900)
    setKey("other-root")
    model.setExpanded(false)
    return dispose
  })
  await flush()
  expect(tab()).toBe("file://b.ts")
  expect(width()).toBe(900)
  dispose()
})

test("expansion without a model is a no-op", () => {
  createRoot((dispose) => {
    const expansion = createExecutionExpansion({
      model: () => undefined,
      key: () => "root",
      activeTab: () => undefined,
      selectTab: () => undefined,
      panelWidth: () => 600,
      resizePanel: () => undefined,
    })
    expansion.expand()
    expansion.collapse()
    dispose()
  })
})
