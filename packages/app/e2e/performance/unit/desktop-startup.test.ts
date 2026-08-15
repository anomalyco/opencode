import { describe, expect, test } from "bun:test"
import { milestoneForLine, summarizeDesktopStartup, type DesktopStartupSample } from "../devex/desktop-startup"

describe("desktop startup benchmark", () => {
  test("recognizes startup milestones in colored output", () => {
    expect(milestoneForLine("\u001b[32melectron main process built successfully\u001b[39m")).toBe("mainBundleReady")
    expect(milestoneForLine("12:30:00.000 > v2 CLI background service ready {")).toBe("serviceReady")
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
