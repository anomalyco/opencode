/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { testRender, type JSX } from "@opentui/solid"
import { onMount, type ParentProps } from "solid-js"
import { tmpdir } from "../fixture/fixture"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { TestTuiContexts } from "../fixture/tui-environment"
import { TuiConfigProvider } from "../../src/config"
import { KVProvider, useKV } from "../../src/context/kv"
import { ThemeProvider, useTheme } from "../../src/context/theme"
import { CompactionProgress } from "../../src/component/compaction-progress"
import { ContextCountdown } from "../../src/component/context-countdown"

const spinnerFrames = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/

describe("compaction indicators", () => {
  test("renders active compaction progress with fixed elapsed seconds", async () => {
    const frame = await renderFrame(() => <CompactionProgress active={true} elapsedSeconds={12} width={40} />)

    expect(frame).toContain("Compacting conversation")
    expect(frame).toContain("12s")
  })

  test("renders nothing when compaction progress is inactive", async () => {
    const frame = await renderFrame(() => <CompactionProgress active={false} elapsedSeconds={12} width={40} />)

    expect(frame).not.toContain("Compacting")
    expect(visibleLines(frame)).toEqual([])
  })

  test("renders static compaction progress when animations are disabled", async () => {
    const frame = await renderFrame(() => <CompactionProgress active={true} elapsedSeconds={12} width={40} />, {
      animationsEnabled: false,
    })

    expect(frame).toContain("⋯ Compacting conversation... 12s")
    expect(frame).toContain("━━━━━━━━")
    expect(frame).not.toMatch(spinnerFrames)
  })

  test("renders safely at narrow widths", async () => {
    const medium = await renderFrame(() => <CompactionProgress active={true} elapsedSeconds={12} width={30} />)
    const narrow4 = await renderFrame(() => <CompactionProgress active={true} elapsedSeconds={12} width={4} />)

    expect(medium).toContain("Compacting conversation")
    expect(visibleLines(medium)).toHaveLength(2)
    expect(medium).toMatch(/[━─]{2,}/)
    expect(narrow4).toContain("Compacting conversation")
    expect(visibleLines(narrow4)).toHaveLength(1)
  })

  test("renders context countdown percentage from fixed token counts", async () => {
    const frame = await renderFrame(() => <ContextCountdown used={800} window={1000} width={40} />)

    expect(visibleLines(frame)[0]).toBe("Context 80%")
  })

  test("renders context countdown auto-compact marker when threshold is provided", async () => {
    const frame = await renderFrame(() => <ContextCountdown used={900} window={1000} threshold={900} width={40} />)

    expect(frame).toContain("Context 90%")
    expect(frame).toContain("auto-compact ~90%")
  })

  test("clamps context countdown above the window", async () => {
    const frame = await renderFrame(() => <ContextCountdown used={1200} window={1000} width={40} />)

    expect(visibleLines(frame)[0]).toBe("Context 100%")
  })

  test("renders nothing when context window is unavailable", async () => {
    const frame = await renderFrame(() => <ContextCountdown used={800} window={0} width={40} />)

    expect(frame).not.toContain("Context")
    expect(visibleLines(frame)).toEqual([])
  })
})

async function renderFrame(component: () => JSX.Element, input: RenderInput = {}) {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, JSON.stringify({}))

  let resolveReady: () => void
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve
  })

  const app = await testRender(
    () =>
      withTuiContexts(
        () => (
          <ReadySignal animationsEnabled={input.animationsEnabled} onReady={resolveReady}>
            {component()}
          </ReadySignal>
        ),
        tmp.path,
      ),
    { width: input.width ?? 80, height: input.height ?? 6 },
  )

  try {
    await app.renderOnce()
    await ready
    await app.renderOnce()
    return app.captureCharFrame()
  } finally {
    app.renderer.destroy()
  }
}

function withTuiContexts(component: () => JSX.Element, state: string) {
  return (
    <TestTuiContexts paths={{ state }}>
      <TuiConfigProvider config={createTuiResolvedConfig()}>
        <KVProvider>
          <ThemeProvider mode="dark" source={{ discover: async () => ({}) }}>
            {component()}
          </ThemeProvider>
        </KVProvider>
      </TuiConfigProvider>
    </TestTuiContexts>
  )
}

function ReadySignal(props: ParentProps<{ animationsEnabled?: boolean; onReady: () => void }>) {
  useTheme()
  const kv = useKV()

  onMount(() => {
    if (props.animationsEnabled !== undefined) kv.set("animations_enabled", props.animationsEnabled)
    props.onReady()
  })

  return <>{props.children}</>
}

function visibleLines(frame: string) {
  return frame
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
}

type RenderInput = {
  animationsEnabled?: boolean
  height?: number
  width?: number
}
