/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { createMemo, createSignal, For, Show, onCleanup } from "solid-js"
import { type Renderable as RenderableType } from "@opentui/core"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { OpencodeKeymapProvider, registerOpencodeKeymap, useBindings, useKeymapSelector } from "../../../src/keymap"
import { TuiConfigProvider } from "../../../src/config"
import { TestTuiContexts } from "../../fixture/tui-environment"

/**
 * Repro for the two-pane model dialog freeze.
 *
 * User report: arrow-key switching between Ollama Cloud and OpenRouter
 * (~300 models) ~13 times gradually freezes the dialog.
 *
 * Mirrors the real dialog's reactive graph: options rebuild + footer action
 * cascade (useKeymapSelector + useBindings) that earlier harnesses omitted.
 */
async function mountRepro(rowCount: number) {
  let registerCount = 0
  let stateEventCount = 0
  let layerCount = 0

  function countRenderables(node: RenderableType | undefined): number {
    if (!node) return 0
    let count = 1
    for (const child of node.getChildren()) {
      count += countRenderables(child)
    }
    return count
  }

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const resolvedConfig = createTuiResolvedConfig({ leader_timeout: 1000 })
    const off = registerOpencodeKeymap(keymap, renderer, resolvedConfig)
    onCleanup(off)

    const origRegister = keymap.registerLayer.bind(keymap)
    ;(keymap as any).registerLayer = (layer: any) => {
      registerCount++
      layerCount++
      const dispose = origRegister(layer)
      return () => {
        layerCount--
        dispose()
      }
    }
    keymap.on("state", () => {
      stateEventCount++
    })

    return (
      <TestTuiContexts>
        <OpencodeKeymapProvider keymap={keymap}>
          <TuiConfigProvider config={resolvedConfig}>
            <ReproInner />
          </TuiConfigProvider>
        </OpencodeKeymapProvider>
      </TestTuiContexts>
    )
  }

  function ReproInner() {
    const renderer = useRenderer()
    const [providerID, setProviderID] = createSignal("provider-a")
    const [rightSelected, setRightSelected] = createSignal(0)
    const [focusedPane, setFocusedPane] = createSignal<"search" | "left" | "right">("right")
    const [inputMode, setInputMode] = createSignal<"keyboard" | "mouse">("keyboard")
    const [hidden, setHidden] = createSignal<string[]>([])

    const options = createMemo(() => {
      const pid = providerID()
      // Match the production fix: plain string footers (not JSX) per row.
      return Array.from({ length: rowCount }, (_, i) => ({
        value: { providerID: pid, modelID: `model-${i}` },
        title: `Model ${i}`,
        footer: "Free 128k",
        muted: hidden().includes(`model-${i}`),
        onSelect: () => {},
      }))
    })

    const selectedIsHidden = createMemo(() => {
      const opt = options()[rightSelected()]
      return !!opt && opt.muted === true
    })
    const isHiddenMode = createMemo(() => false)
    const actions = createMemo(() => [
      {
        command: "model.dialog.hide",
        title: selectedIsHidden() || isHiddenMode() ? "Unhide" : "Hide",
        hidden: false,
        singleKey: true,
        onTrigger: () => {},
      },
      {
        command: "model.dialog.favorite",
        title: "Favorite",
        hidden: false,
        singleKey: false,
        onTrigger: () => {},
      },
      {
        command: "model.dialog.note",
        title: "Note",
        hidden: false,
        singleKey: true,
        onTrigger: () => {},
      },
      {
        command: "model.dialog.variant",
        title: "Variants",
        hidden: !selectedIsHidden(),
        singleKey: true,
        onTrigger: () => {},
      },
    ])
    const shownActions = createMemo(() => actions().filter((a) => !a.hidden))
    const modifierActions = createMemo(() => shownActions().filter((a) => !a.singleKey))
    const singleKeyActions = createMemo(() => shownActions().filter((a) => a.singleKey))

    const actionBindings = useKeymapSelector((km) =>
      km.getCommandBindings({
        visibility: "registered",
        commands: shownActions().map((a) => a.command),
      }),
    )
    const actionLabels = createMemo(() => {
      const labels = new Map<string, string>()
      for (const a of shownActions()) {
        const b = actionBindings().get(a.command)
        if (b && b.length > 0) labels.set(a.command, "label")
      }
      return labels
    })
    const visibleActions = createMemo(() =>
      shownActions()
        .map((a) => ({ ...a, label: actionLabels().get(a.command) ?? "" }))
        .filter((a) => a.label),
    )

    useBindings(() => {
      const visible = modifierActions()
      return {
        commands: visible.map((a) => ({
          name: a.command,
          title: a.title,
          category: "Model dialog",
          run() {
            a.onTrigger()
          },
        })),
        bindings: [] as any[],
      }
    })

    useBindings(() => ({
      commands: singleKeyActions().map((a) => ({
        name: a.command,
        title: a.title,
        category: "Model dialog",
        run() {
          a.onTrigger()
        },
      })),
      bindings: [] as any[],
    }))

    let lastKey = ""
    createMemo(() => {
      const key = providerID()
      if (key !== lastKey) {
        lastKey = key
        setRightSelected(0)
        setInputMode("keyboard")
      }
      const len = options().length
      if (len > 0 && rightSelected() >= len) setRightSelected(len - 1)
    })

    ;(globalThis as any).__setProvider = setProviderID
    ;(globalThis as any).__getRenderableCount = () => countRenderables(renderer.root)
    ;(globalThis as any).__getCounts = () => ({ registerCount, stateEventCount, layerCount })
    ;(globalThis as any).__getVisibleActions = () => visibleActions().length
    void setHidden
    void focusedPane
    void setFocusedPane

    return (
      <box flexDirection="column">
        <scrollbox maxHeight={20}>
          <For each={options()}>
            {(option, index) => {
              const active = createMemo(() => rightSelected() === index() && focusedPane() === "right")
              return (
                <box
                  flexDirection="column"
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={active() ? "#fab283" : "#00000000"}
                  onMouseMove={() => setInputMode("mouse")}
                  onMouseOver={() => {
                    if (inputMode() !== "mouse") return
                    setRightSelected(index())
                  }}
                >
                  <box flexDirection="row">
                    <text>{option.title}</text>
                    <Show when={option.footer}>
                      <box flexShrink={0}>
                        <Show when={typeof option.footer === "string"} fallback={<>{option.footer}</>}>
                          <text>{option.footer as string}</text>
                        </Show>
                      </box>
                    </Show>
                  </box>
                </box>
              )
            }}
          </For>
        </scrollbox>
        <For each={visibleActions()}>
          {(item) => (
            <text>
              <b>{item.title}</b> {item.label}
            </text>
          )}
        </For>
      </box>
    )
  }

  const app = await testRender(() => <Harness />, { kittyKeyboard: true })

  return {
    app,
    setProvider: (id: string) => ((globalThis as any).__setProvider as (id: string) => void)(id),
    getRenderableCount: () => ((globalThis as any).__getRenderableCount as () => number)(),
    getCounts: () =>
      (
        (globalThis as any).__getCounts as () => {
          registerCount: number
          stateEventCount: number
          layerCount: number
        }
      )(),
    getVisibleActions: () => ((globalThis as any).__getVisibleActions as () => number)(),
    cleanup: () => {
      delete (globalThis as any).__setProvider
      delete (globalThis as any).__getRenderableCount
      delete (globalThis as any).__getCounts
      delete (globalThis as any).__getVisibleActions
      app.renderer.destroy()
    },
  }
}

describe("model dialog freeze — accumulation with keymap", () => {
  test("counts stay bounded across 15 provider switches (50 rows)", async () => {
    const repro = await mountRepro(50)
    try {
      const renderableCounts: number[] = []
      const registerCounts: number[] = []
      const layerCounts: number[] = []
      const stateEventCounts: number[] = []

      renderableCounts.push(repro.getRenderableCount())
      registerCounts.push(repro.getCounts().registerCount)
      layerCounts.push(repro.getCounts().layerCount)
      stateEventCounts.push(repro.getCounts().stateEventCount)
      void repro.getVisibleActions()

      for (let i = 0; i < 15; i++) {
        repro.setProvider(i % 2 === 0 ? "provider-a" : "provider-b")
        void repro.getVisibleActions()
        renderableCounts.push(repro.getRenderableCount())
        const counts = repro.getCounts()
        registerCounts.push(counts.registerCount)
        layerCounts.push(counts.layerCount)
        stateEventCounts.push(counts.stateEventCount)
      }

      console.log("renderable:", renderableCounts)
      console.log("register:", registerCounts)
      console.log("live layers:", layerCounts)
      console.log("state events:", stateEventCounts)

      const totalRGrowth = renderableCounts.at(-1)! - renderableCounts[0]!
      const layerGrowth = layerCounts.at(-1)! - layerCounts[0]!
      expect(totalRGrowth).toBeLessThan(50)
      expect(layerGrowth).toBeLessThan(5)
    } finally {
      repro.cleanup()
    }
  }, 30000)

  test("300-row rebuild cost does not grow unboundedly across 13 switches", async () => {
    const repro = await mountRepro(300)
    try {
      const durations: number[] = []
      for (let i = 0; i < 13; i++) {
        const start = performance.now()
        repro.setProvider(i % 2 === 0 ? "provider-a" : "provider-b")
        void repro.getVisibleActions()
        durations.push(performance.now() - start)
      }

      console.log("switch durations ms:", durations.map((d) => d.toFixed(1)).join(", "))
      const early = durations.slice(0, 3).reduce((a, b) => a + b, 0) / 3
      const late = durations.slice(-3).reduce((a, b) => a + b, 0) / 3
      // Late switches should not be dramatically slower than early ones.
      // A growing allocator / leak shows up as late >> early.
      expect(late).toBeLessThan(early * 8 + 50)
    } finally {
      repro.cleanup()
    }
  }, 60000)
})
