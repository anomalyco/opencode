import { describe, expect, test } from "bun:test"

import { shouldShowSessionSidePanel } from "./session-side-panel-visibility"

describe("shouldShowSessionSidePanel", () => {
  test("hides the panel outside desktop layouts", () => {
    expect(
      shouldShowSessionSidePanel({
        isDesktop: false,
        newLayoutDesigns: true,
        hasSessionID: false,
        hasWorkspaceTabs: true,
      }),
    ).toBe(false)
  })

  test("shows the panel for classic layouts", () => {
    expect(
      shouldShowSessionSidePanel({
        isDesktop: true,
        newLayoutDesigns: false,
        hasSessionID: false,
        hasWorkspaceTabs: false,
      }),
    ).toBe(true)
  })

  test("shows the panel for saved sessions in the new layout", () => {
    expect(
      shouldShowSessionSidePanel({
        isDesktop: true,
        newLayoutDesigns: true,
        hasSessionID: true,
        hasWorkspaceTabs: false,
      }),
    ).toBe(true)
  })

  test("shows the panel when workspace tabs are opened before the session is saved", () => {
    expect(
      shouldShowSessionSidePanel({
        isDesktop: true,
        newLayoutDesigns: true,
        hasSessionID: false,
        hasWorkspaceTabs: true,
      }),
    ).toBe(true)
  })

  test("keeps the panel hidden for brand new sessions without workspace tabs", () => {
    expect(
      shouldShowSessionSidePanel({
        isDesktop: true,
        newLayoutDesigns: true,
        hasSessionID: false,
        hasWorkspaceTabs: false,
      }),
    ).toBe(false)
  })
})
