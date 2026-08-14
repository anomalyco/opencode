import { expect, test } from "bun:test"
import { QueryClient } from "@tanstack/solid-query"
import { ServerScope } from "@/utils/server-scope"
import { createCatalogSync } from "./catalog"
import { pathKey } from "@/utils/path-key"

test("invalidates the catalog for the event location", async () => {
  const queryClient = new QueryClient()
  const one = [ServerScope.local, "/one", "providers"] as const
  const integrations = [ServerScope.local, "/one", "integrations"] as const
  const two = [ServerScope.local, "/two", "providers"] as const
  queryClient.setQueryData(one, { providers: ["one"] })
  queryClient.setQueryData(integrations, { integrations: ["one"] })
  queryClient.setQueryData(two, { providers: ["two"] })
  const catalog = createCatalogSync({
    scope: ServerScope.local,
    queryClient,
    active: () => [pathKey("/one"), pathKey("/two")],
    load: async () => {},
  })

  catalog.handleEvent({ type: "catalog.updated", directory: "/one" })
  await Bun.sleep(0)

  expect(queryClient.getQueryState(one)?.isInvalidated).toBe(true)
  expect(queryClient.getQueryState(integrations)?.isInvalidated).toBe(true)
  expect(queryClient.getQueryState(two)?.isInvalidated).toBe(false)
})

test("invalidates global and active catalogs after connection", async () => {
  const queryClient = new QueryClient()
  const global = [ServerScope.local, null, "providers"] as const
  const active = [ServerScope.local, "/active", "providers"] as const
  const passive = [ServerScope.local, "/passive", "providers"] as const
  queryClient.setQueryData(global, {})
  queryClient.setQueryData(active, {})
  queryClient.setQueryData(passive, {})
  const catalog = createCatalogSync({
    scope: ServerScope.local,
    queryClient,
    active: () => [pathKey("/active")],
    load: async () => {},
  })

  catalog.handleEvent({ type: "server.connected", directory: "global" })
  await Bun.sleep(0)

  expect(queryClient.getQueryState(global)?.isInvalidated).toBe(true)
  expect(queryClient.getQueryState(active)?.isInvalidated).toBe(true)
  expect(queryClient.getQueryState(passive)?.isInvalidated).toBe(false)
})
