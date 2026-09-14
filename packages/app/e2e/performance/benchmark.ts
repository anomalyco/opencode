import { expect, test as base, type Browser, type Page, type TestInfo } from "@playwright/test"
import { startChromeTrace } from "./chrome-trace"

type BenchmarkFixtures = {
  report: (metrics: Record<string, unknown>, context?: Record<string, unknown>) => void
  reportState: { payload?: { metrics: Record<string, unknown>; context: Record<string, unknown> } }
  benchmarkResult: void
  traceScope: "page" | "interaction"
}

export type PerformancePageDiagnostics = {
  navigations: string[]
  traceScope: "page" | "interaction"
  startTrace: () => Promise<void>
  stop: () => Promise<string | undefined>
}

const pages = new WeakMap<Page, PerformancePageDiagnostics>()

export const benchmark = base.extend<BenchmarkFixtures>({
  traceScope: ["page", { option: true }],
  reportState: async ({}, use) => use({}),
  report: async ({ reportState }, use) => {
    await use((metrics, context = {}) => {
      if (reportState.payload) throw new Error("Benchmark reported metrics more than once")
      reportState.payload = { metrics, context }
    })
  },
  benchmarkResult: [
    async ({ reportState }, use, testInfo) => {
      await use()
      const missing = !reportState.payload
      console.log(
        `BENCHMARK ${JSON.stringify({
          schemaVersion: 2,
          runID: process.env.OPENCODE_PERFORMANCE_RUN_ID,
          name: benchmarkName(testInfo),
          status: missing ? "failed" : testInfo.status,
          expectedStatus: testInfo.expectedStatus,
          retry: testInfo.retry,
          repeatEachIndex: testInfo.repeatEachIndex,
          context: {
            project: testInfo.project.name,
            platform: process.platform,
            ...reportState.payload?.context,
          },
          metrics: reportState.payload?.metrics ?? null,
          error: missing ? "Benchmark did not report metrics" : undefined,
        })}`,
      )
      if (missing && testInfo.status === testInfo.expectedStatus)
        throw new Error(`Benchmark did not report metrics: ${benchmarkName(testInfo)}`)
    },
    { auto: true },
  ],
  page: async ({ page, traceScope }, use, testInfo) => {
    const name = benchmarkName(testInfo)
    const diagnostics = await observePerformancePage(page, name, traceScope)
    try {
      await use(page)
    } finally {
      try {
        await reportPerformancePage(name, diagnostics, testInfo)
      } finally {
        if (testInfo.status !== testInfo.expectedStatus) {
          await testInfo.attach("performance-navigations", {
            body: JSON.stringify(diagnostics.navigations, null, 2),
            contentType: "application/json",
          })
        }
      }
    }
  },
})

function benchmarkName(testInfo: TestInfo) {
  return testInfo.titlePath.slice(1).join(" > ")
}

export { expect }

async function observePerformancePage(page: Page, name: string, traceScope: "page" | "interaction" = "page") {
  const navigations: string[] = []
  const onNavigation = (frame: ReturnType<Page["mainFrame"]>) => {
    if (frame === page.mainFrame()) navigations.push(frame.url())
  }
  page.on("framenavigated", onNavigation)
  let stopTrace: Awaited<ReturnType<typeof startChromeTrace>>
  let stopping: Promise<string | undefined> | undefined
  const diagnostics: PerformancePageDiagnostics = {
    navigations,
    traceScope,
    async startTrace() {
      stopTrace ??= await startChromeTrace(page, name).catch((error) => {
        page.off("framenavigated", onNavigation)
        throw error
      })
    },
    stop() {
      page.off("framenavigated", onNavigation)
      return (stopping ??= stopTrace?.() ?? Promise.resolve(undefined))
    },
  }
  pages.set(page, diagnostics)
  if (traceScope === "page") await diagnostics.startTrace()
  return diagnostics
}

export async function withBenchmarkPage<T>(
  browser: Browser,
  name: string,
  run: (page: Page) => Promise<T>,
  testInfo?: TestInfo,
) {
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    const diagnostics = await observePerformancePage(page, name)
    try {
      return await run(page)
    } finally {
      await reportPerformancePage(name, diagnostics, testInfo)
    }
  } finally {
    await context.close()
  }
}

async function reportPerformancePage(name: string, diagnostics: PerformancePageDiagnostics, testInfo?: TestInfo) {
  const trace = await diagnostics.stop()
  console.log(
    `BENCHMARK_PAGE ${JSON.stringify({
      schemaVersion: 2,
      runID: process.env.OPENCODE_PERFORMANCE_RUN_ID,
      name,
      test: testInfo ? benchmarkName(testInfo) : undefined,
      retry: testInfo?.retry,
      repeatEachIndex: testInfo?.repeatEachIndex,
      context: {
        platform: process.platform,
        trace,
        traceScope: diagnostics.traceScope,
        selectorTrace: process.env.OPENCODE_PERFORMANCE_SELECTOR_TRACE === "1",
      },
      navigations: diagnostics.navigations,
    })}`,
  )
}

export function benchmarkDiagnostics(page: Page) {
  const diagnostics = pages.get(page)
  if (!diagnostics) throw new Error("Performance diagnostics are not installed for this page")
  return diagnostics
}
