import { describe, expect, test } from "bun:test"
import { inlineThemePreload } from "../../../vite.js"
import { milestoneForLine, summarizeDesktopStartup, type DesktopStartupSample } from "../devex/desktop-startup"

describe("desktop startup benchmark", () => {
  test.each(["/oc-theme-preload.js", "./oc-theme-preload.js"])("inlines %s before the renderer runs", (path) => {
    const html = inlineThemePreload(`<script id="oc-theme-preload-script" src="${path}"></script>`)
    expect(html).not.toContain(" src=")
    expect(html).toContain("opencode-color-scheme")
  })

  test("recognizes startup milestones in colored output", () => {
    const cases = [
      ["bunRootScript", "$ bun --cwd packages/desktop dev"],
      ["bunDesktopScript", "$ bun ./scripts/dev.ts"],
      ["desktopPrepared", "Copied dev icons from"],
      ["mainBundleReady", "electron main process built successfully"],
      ["preloadBundleReady", "electron preload scripts built successfully"],
      ["rendererDevServerReady", "dev server running for the electron renderer process at:"],
      ["electronSpawnStarted", "starting electron app..."],
      ["debugEndpointReady", "DevTools listening on ws://"],
      ["electronStarted", "app starting"],
      ["layersReady", "layers ready"],
      ["windowVisible", "main window visible"],
      ["serviceEnsureStarted", "starting v2 background service"],
      ["serviceSpawnRequested", "v2 CLI background service starting"],
      ["serviceReady", "v2 CLI background service ready"],
      ["rendererViteConnected", "[vite] connected."],
    ] as const
    cases.forEach(([milestone, line]) => {
      expect(milestoneForLine(`\u001b[32m${line}\u001b[39m`)).toBe(milestone)
    })
    expect(milestoneForLine("12:30:00.000 › v2 CLI background service ready {")).toBe("serviceReady")
    expect(milestoneForLine("unrelated output")).toBeUndefined()
  })

  test("keeps raw samples and reports median absolute deviation", () => {
    const samples = [24, 20, 22, 28, 26].map((commandToHomeReadyMs, index) => sample(index + 1, commandToHomeReadyMs))
    expect(summarizeDesktopStartup(samples).commandToHomeReadyMs).toEqual({
      min: 20,
      median: 24,
      max: 28,
      medianAbsoluteDeviation: 2,
    })
  })
})

function sample(run: number, commandToHomeReadyMs: number): DesktopStartupSample {
  const milestonesMs = {
    bunRootScript: 1,
    bunDesktopScript: 2,
    desktopPrepared: 3,
    mainBundleReady: 4,
    preloadBundleReady: 5,
    rendererDevServerReady: 6,
    electronSpawnStarted: 7,
    debugEndpointReady: 8,
    electronStarted: 9,
    layersReady: 10,
    windowVisible: 11,
    serviceEnsureStarted: 12,
    serviceSpawnRequested: 13,
    serviceReady: 14,
    rendererViteConnected: 15,
    homeReady: commandToHomeReadyMs,
  }
  return {
    run,
    commandToHomeReadyMs,
    milestonesMs,
    phasesMs: {
      desktopPreparation: 3,
      viteMainBundle: 1,
      vitePreloadBundle: 1,
      rendererServerStartup: 1,
      electronStartup: 2,
      serviceSpawnWait: 1,
      serviceProcessStartup: 1,
      rendererStartup: commandToHomeReadyMs - 15,
      visibleWindowToHome: commandToHomeReadyMs - 11,
    },
    service: { version: "2.0.0-local-test", url: "http://127.0.0.1:3000", pid: run },
  }
}
