import { expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import type { MountedSession } from "@opencode/plugin/gui"
import { syncCatalog } from "../../gui-plugins/src/context/catalog"

function setup() {
  const [connected, setConnected] = createSignal(true)
  const [active, setActive] = createSignal(true)
  const loads: string[] = []

  const sync = async (ref: { directory: string }) => {
    loads.push(ref.directory)
  }

  const data = {
    location: {
      syncInfo: async () => {},
      default: () => ({ directory: "/default" }),
      provider: { sync },
      model: { sync: async () => {} },
    },
  }

  const value = {
    directory: "/repo",
    server: {
      get connected() {
        return connected()
      },
      data,
    },
  }

  // SAFETY: syncCatalog reads only `directory` and the `server` fields above.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
  const session = value as unknown as MountedSession

  const dispose = createRoot((dispose) => {
    syncCatalog(() => session, active)

    return dispose
  })

  return { loads, setConnected, setActive, dispose }
}

test("a detached view loads its catalogs on reconnect only once selected again", () => {
  const input = setup()

  try {
    expect(input.loads).toEqual(["/repo"])

    input.setActive(false)
    input.setActive(true)
    expect(input.loads).toEqual(["/repo"])

    input.setActive(false)
    input.setConnected(false)
    input.setConnected(true)
    expect(input.loads).toEqual(["/repo"])

    input.setActive(true)
    expect(input.loads).toEqual(["/repo", "/repo"])
  } finally {
    input.dispose()
  }
})
