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
      ["serviceEnsureStarted", "starting v2 background service"],
      ["serviceSpawnRequested", "v2 CLI background service starting"],
      ["serviceReady", "v2 CLI background service ready"],
      ["backgroundLoadingReady", "loading task finished"],
      ["rendererViteConnected", "[vite] connected."],
      ["rendererInitializationStarted", "awaiting server ready"],
      ["rendererInitializationReady", "server ready"],
      ["windowVisible", "main window visible"],
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
    serviceEnsureStarted: 10,
    serviceSpawnRequested: 11,
    serviceReady: 12,
    backgroundLoadingReady: 13,
    rendererViteConnected: 14,
    rendererInitializationStarted: 15,
    rendererInitializationReady: 16,
    windowVisible: 17,
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
      rendererStartup: commandToHomeReadyMs - 14,
      visibleWindowToHome: commandToHomeReadyMs - 17,
    },
    service: { version: "2.0.0-local-test", url: "http://127.0.0.1:3000", pid: run },
  }
}
