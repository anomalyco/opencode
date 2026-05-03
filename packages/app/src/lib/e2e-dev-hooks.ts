declare global {
  interface Window {
    /** Dev / Playwright only: real `runPyodide` (same as SSE path). */
    __veritlyE2ePyodide?: {
      run: (code: string, timeoutMs: number) => Promise<{ output: string; exitCode: number }>
    }
  }
}

/** Registers `window.__veritlyE2ePyodide` for Playwright; no-op in production builds. */
export function installE2eDevPyodideHook() {
  if (typeof window === "undefined" || !import.meta.env.DEV) return
  void import("@/lib/run-pyodide").then((m) => {
    window.__veritlyE2ePyodide = { run: m.runPyodide }
  })
}

export {}
