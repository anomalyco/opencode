import { DialogProvider } from "@opencode/ui/context/dialog"
import type { Setup } from "@opencode/gui-extensions/sdk"
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import { ExtensionHostProvider, useExtensionHost } from "../src/runtime/extension/host"
import { LanguageProvider } from "../src/runtime/i18n/language"

/** Mounts the real extension host with one extension whose every renderer load settles when the test says so. */
export function mountExtensionHost() {
  const loads: PromiseWithResolvers<{ default: Setup }>[] = []
  const [disabled, setDisabled] = createSignal<ReadonlySet<string>>(new Set())
  const state = { host: undefined as ReturnType<typeof useExtensionHost> | undefined }
  const container = document.createElement("div")
  document.body.appendChild(container)
  function Capture() {
    state.host = useExtensionHost()
    return null
  }
  const dispose = render(
    () => (
      <LanguageProvider locale="en">
        <DialogProvider>
          <ExtensionHostProvider
            definitions={[
              {
                id: "fixture",
                renderer: () => {
                  const load = Promise.withResolvers<{ default: Setup }>()
                  loads.push(load)
                  return load.promise
                },
              },
            ]}
            disabled={disabled}
            services={[]}
          >
            <Capture />
          </ExtensionHostProvider>
        </DialogProvider>
      </LanguageProvider>
    ),
    container,
  )
  return {
    unmount: () => {
      dispose()
      container.remove()
    },
    /** Resolves the nth renderer load (the first by default) with this setup. */
    load: (setup: Setup, index = 0) => loads[index].resolve({ default: setup }),
    /** Rejects the nth renderer load. */
    fail: (index: number, error: unknown) => loads[index].reject(error),
    /** Renderer loads requested so far. */
    count: () => loads.length,
    reload: () => state.host?.reload("fixture"),
    disable: () => setDisabled(new Set(["fixture"])),
    enable: () => setDisabled(new Set<string>()),
    status: () => state.host?.state.status.fixture,
    /** Contributions the host holds for a point; readable after the host unmounts. */
    entries: (point: string) => state.host?.state.entries[point]?.length ?? 0,
  }
}
