import { expect, test } from "bun:test"
import { runInNewContext } from "node:vm"
import { filterStartup, filterReadiness } from "./filter-startup"

test("selects readiness by verified store ID and manifest generation, never by an unpacked identity", () => {
  const id = "odfafepnkmbhccpbejgmiehpchacaeak"
  expect(filterStartup(id, "store", 2)).toBe("background")
  expect(filterStartup(id, "folder", 2)).toBeUndefined()
  expect(filterStartup(id, "store", 3)).toBeUndefined()
  const lite = "ddkjiahejlhfcafbddmgiahcphecmpfh"
  expect(filterStartup(lite, "store", 2)).toBeUndefined()
  expect(filterStartup(lite, "browser", 3)).toBeUndefined()
  expect(filterStartup(lite, "store", 3)).toBe("rulesets")
})

test("loading the background or setting readyToFilter does not release the pane before filtering starts", async () => {
  const startup = Promise.withResolvers<void>()
  const background = { µBlock: { readyToFilter: true, isReadyPromise: startup.promise }, vAPI: { net: {} } }
  const probe = () => runInNewContext(filterReadiness, background)
  const first = probe()
  expect(await Promise.race([first, Promise.resolve("pending")])).toBe("pending")
  startup.resolve()
  expect(await first).toBe(false)
  Object.assign(background.vAPI.net, { suspendableListener: () => {} })
  expect(await probe()).toBe(true)
  background.µBlock.readyToFilter = false
  expect(await probe()).toBe(false)
})
