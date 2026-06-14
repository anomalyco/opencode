/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { JSX } from "solid-js"
import { writeFileSync } from "node:fs"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { KVProvider } from "../../../src/context/kv"
import { ThemeProvider } from "../../../src/context/theme"
import { TuiConfigProvider } from "../../../src/config"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { BudgetReadout } from "../../../src/component/budget-status"
import { AceReadout } from "../../../src/component/ace-status"

describe("health indicator readouts", () => {
  describe("BudgetReadout", () => {
    test("renders spend vs cap with percentage", async () => {
      const frame = await renderFrame(() => <BudgetReadout cost={3.2} cap={5} warnAt={[0.5, 0.8]} />)
      expect(frame).toContain("$3.20")
      expect(frame).toContain("$5.00")
      expect(frame).toContain("(64%)")
    })

    test("renders nothing without a configured cap", async () => {
      const frame = await renderFrame(() => <BudgetReadout cost={3.2} cap={undefined} />)
      expect(frame.trim()).toBe("")
    })

    test("renders an over-budget reading past 100%", async () => {
      const frame = await renderFrame(() => <BudgetReadout cost={6} cap={5} warnAt={[0.5, 0.8]} />)
      expect(frame).toContain("$6.00")
      expect(frame).toContain("(120%)")
    })
  })

  describe("AceReadout", () => {
    test("renders pressure counts and the k_eff growth factor", async () => {
      const frame = await renderFrame(() => (
        <AceReadout mode="monitor" toolCalls={12} spawns={3} activeSubagents={2} kEff={1.2} />
      ))
      expect(frame).toContain("ACE monitor")
      expect(frame).toContain("12tc")
      expect(frame).toContain("3sp")
      expect(frame).toContain("2active")
      expect(frame).toContain("k1.20")
    })

    test("omits k_eff when undefined and active count when zero", async () => {
      const frame = await renderFrame(() => (
        <AceReadout mode="fixed-cap" toolCalls={4} spawns={0} activeSubagents={0} />
      ))
      expect(frame).toContain("ACE fixed-cap 4tc 0sp")
      expect(frame).not.toContain("active")
      expect(frame).not.toContain("k")
    })

    test("renders a block notice when blocked", async () => {
      const frame = await renderFrame(() => (
        <AceReadout mode="reject-escalate" toolCalls={9} spawns={5} activeSubagents={1} blocked="spawn blocked" />
      ))
      expect(frame).toContain("ACE block spawn blocked")
    })
  })

  test("captures a combined footer-style frame artifact", async () => {
    const frame = await renderFrame(
      () => (
        <box flexDirection="row" gap={2}>
          <BudgetReadout cost={3.2} cap={5} warnAt={[0.5, 0.8]} />
          <AceReadout mode="monitor" toolCalls={12} spawns={3} activeSubagents={2} kEff={1.2} />
        </box>
      ),
      { width: 60, height: 3 },
    )
    const artifact = visibleLines(frame).join("\n")
    // Visible artifact for the PR; also printed to the test log.
    console.log("\n--- footer health indicator ---\n" + artifact + "\n-------------------------------\n")
    writeFileSync("/tmp/health-indicator-frame.txt", artifact + "\n")
    expect(artifact).toContain("$3.20/$5.00 (64%)")
    expect(artifact).toContain("ACE monitor 12tc 3sp 2active k1.20")
  })
})

async function renderFrame(component: () => JSX.Element, size = { width: 40, height: 3 }) {
  const app = await testRender(() => withTheme(component), size)
  try {
    await app.renderOnce()
    await new Promise((resolve) => setTimeout(resolve, 25))
    await app.renderOnce()
    // The first render in a suite can capture a blank frame before layout settles;
    // retry until content appears.
    for (let attempt = 0; attempt < 5; attempt++) {
      const frame = app.captureCharFrame()
      if (frame.trim().length > 0) return frame
      await new Promise((resolve) => setTimeout(resolve, 25))
      await app.renderOnce()
    }
    return app.captureCharFrame()
  } finally {
    app.renderer.destroy()
  }
}

function withTheme(component: () => JSX.Element) {
  return (
    <TestTuiContexts>
      <TuiConfigProvider config={createTuiResolvedConfig()}>
        <KVProvider>
          <ThemeProvider mode="dark">{component()}</ThemeProvider>
        </KVProvider>
      </TuiConfigProvider>
    </TestTuiContexts>
  )
}

function visibleLines(frame: string) {
  return frame
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
}
