import { describe, expect, test } from "bun:test"
import type { SessionModel } from "@/session/model"
import type { ExecutionModel } from "./model"
import { createExecutionOverviewOpener, executionPresentationVisible } from "./session-execution"

describe("Session execution owner", () => {
  test("SessionScreen renders the production execution owner", async () => {
    const source = await Bun.file(new URL("../session/screen.tsx", import.meta.url)).text()

    expect(source).toContain("<SessionExecutionOwner")
    expect(source).not.toContain("<SessionExecutionProvider")
  })

  test("desktop overview opening reveals the closed panel before selecting Execution and preserves the subview", async () => {
    const calls: string[] = []
    const session = {
      isDesktop: () => true,
      layout: {
        view: () => ({ reviewPanel: { open: () => calls.push("panel") } }),
        tabs: () => ({ open: async () => calls.push("tab") }),
      },
    } as unknown as SessionModel
    const execution = {
      selectSubview: (subview: string) => calls.push(`subview:${subview}`),
    } as unknown as ExecutionModel
    const open = createExecutionOverviewOpener({ session, mobile: { setTab: () => calls.push("mobile") } })

    open(execution)
    await Promise.resolve()
    expect(calls).toEqual(["panel", "tab"])

    open(execution, { agents: true })
    await Promise.resolve()
    expect(calls.slice(2)).toEqual(["subview:agents", "panel", "tab"])
  })

  test("actual presentation visibility covers desktop, mobile, owner, and document state", () => {
    const visible = {
      desktop: true,
      expanded: false,
      reviewPanelOpen: true,
      executionTabActive: true,
      mobileExecution: false,
      activeOwner: true,
      documentVisible: true,
    }
    expect(executionPresentationVisible(visible)).toBe(true)
    expect(executionPresentationVisible({ ...visible, reviewPanelOpen: false })).toBe(false)
    expect(executionPresentationVisible({ ...visible, documentVisible: false })).toBe(false)
    expect(executionPresentationVisible({ ...visible, activeOwner: false })).toBe(false)
    expect(executionPresentationVisible({ ...visible, expanded: true, reviewPanelOpen: false })).toBe(true)
    expect(
      executionPresentationVisible({
        ...visible,
        desktop: false,
        reviewPanelOpen: false,
        executionTabActive: false,
        mobileExecution: true,
      }),
    ).toBe(true)
    expect(
      executionPresentationVisible({
        ...visible,
        desktop: false,
        reviewPanelOpen: false,
        executionTabActive: true,
        mobileExecution: false,
      }),
    ).toBe(false)
  })
})
