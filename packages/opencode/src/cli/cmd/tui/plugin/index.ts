import type { TuiPluginApi, TuiPluginInstallResult, TuiPluginStatus } from "@opencode-ai/plugin/tui"
import type { TuiConfig } from "@/cli/cmd/tui/config/tui"
import type { RouteMap } from "./api"

// Lazy wrappers for heavy modules - only loaded when actually used

async function loadRuntime() {
  const mod = await import("./runtime")
  return mod.TuiPluginRuntime
}

async function loadApi() {
  const mod = await import("./api")
  return mod.createTuiApi
}

// Re-export type only - no runtime cost
export type { RouteMap } from "./api"

// Lazy wrapper for TuiPluginRuntime - methods deferred until called
export namespace TuiPluginRuntime {
  export const Slot = {
    name: "app" as const,
  }

  export async function init(input: { api: TuiPluginApi; config: TuiConfig.Info }) {
    const Runtime = await loadRuntime()
    return Runtime.init(input)
  }

  export function list(): TuiPluginStatus[] {
    // Runtime not loaded yet, return empty
    return []
  }

  export async function activatePlugin(id: string) {
    const Runtime = await loadRuntime()
    return Runtime.activatePlugin(id)
  }

  export async function deactivatePlugin(id: string) {
    const Runtime = await loadRuntime()
    return Runtime.deactivatePlugin(id)
  }

  export async function addPlugin(spec: string) {
    const Runtime = await loadRuntime()
    return Runtime.addPlugin(spec)
  }

  export async function installPlugin(spec: string, options?: { global?: boolean }): Promise<TuiPluginInstallResult> {
    const Runtime = await loadRuntime()
    return Runtime.installPlugin(spec, options)
  }

  export async function dispose() {
    const Runtime = await loadRuntime()
    return Runtime.dispose()
  }
}

// Lazy wrapper for createTuiApi - module loaded on first call
let createTuiApiCached: ((input: Parameters<typeof import("./api").createTuiApi>[0]) => TuiPluginApi) | undefined

export async function createTuiApi(input: Parameters<typeof import("./api").createTuiApi>[0]): Promise<TuiPluginApi> {
  if (!createTuiApiCached) {
    createTuiApiCached = await loadApi()
  }
  return createTuiApiCached(input)
}
