import { test, expect } from "bun:test"

import { resolveEnvOverlay, currentProviders } from "@/provider/overlay"
import type { Provider } from "@/provider/provider"
import { ProviderID } from "@/provider/schema"

const baseInfo = (env: string[], source: Provider.Info["source"] = "env"): Provider.Info => ({
  id: ProviderID.make("x"),
  name: "X",
  source,
  env,
  options: {},
  models: {},
})

test("resolveEnvOverlay: no cached, no apiKey -> undefined", () => {
  expect(resolveEnvOverlay(undefined, baseInfo(["KEY"]), undefined)).toBeUndefined()
})

test("resolveEnvOverlay: no cached, apiKey present -> new env entry with key", () => {
  const r = resolveEnvOverlay(undefined, baseInfo(["KEY"]), "abc")
  expect(r?.source).toBe("env")
  expect(r?.key).toBe("abc")
})

test("resolveEnvOverlay: no cached, apiKey present, multi-env candidate -> key undefined", () => {
  const r = resolveEnvOverlay(undefined, baseInfo(["A", "B"]), "abc")
  expect(r?.source).toBe("env")
  expect(r?.key).toBeUndefined()
})

test("resolveEnvOverlay: cached env entry, apiKey removed -> drop", () => {
  const cached = { ...baseInfo(["KEY"]), key: "old" }
  expect(resolveEnvOverlay(cached, baseInfo(["KEY"]), undefined)).toBeUndefined()
})

test("resolveEnvOverlay: cached config entry, apiKey absent -> keep cached untouched", () => {
  const cached = baseInfo(["KEY"], "config")
  expect(resolveEnvOverlay(cached, baseInfo(["KEY"]), undefined)).toBe(cached)
})

test("resolveEnvOverlay: cached config entry without key, single-env apiKey -> fill key, keep source", () => {
  const cached = { ...baseInfo(["KEY"], "config") }
  const r = resolveEnvOverlay(cached, baseInfo(["KEY"]), "abc")
  expect(r?.source).toBe("config")
  expect(r?.key).toBe("abc")
  expect(r).not.toBe(cached)
})

test("resolveEnvOverlay: cached api entry with existing key + env present -> cached wins (auth precedence)", () => {
  const cached = { ...baseInfo(["KEY"], "api"), key: "auth-key" }
  const r = resolveEnvOverlay(cached, baseInfo(["KEY"]), "env-key")
  expect(r).toBe(cached)
})

test("resolveEnvOverlay: cached env entry, same apiKey -> identity (no churn)", () => {
  const cached = { ...baseInfo(["KEY"]), key: "abc" }
  expect(resolveEnvOverlay(cached, baseInfo(["KEY"]), "abc")).toBe(cached)
})

test("resolveEnvOverlay: cached env entry, rotated apiKey -> new entry with new key", () => {
  const cached = { ...baseInfo(["KEY"]), key: "old" }
  const r = resolveEnvOverlay(cached, baseInfo(["KEY"]), "new")
  expect(r?.key).toBe("new")
  expect(r).not.toBe(cached)
})

test("resolveEnvOverlay: cached config entry without key, multi-env apiKey -> cached untouched", () => {
  const cached = baseInfo(["A", "B"], "config")
  const r = resolveEnvOverlay(cached, baseInfo(["A", "B"]), "abc")
  expect(r).toBe(cached)
})

test("resolveEnvOverlay: cached env entry, multi-env candidate -> existing key preserved", () => {
  const cached = { ...baseInfo(["A", "B"]), key: "preserved" }
  const r = resolveEnvOverlay(cached, baseInfo(["A", "B"]), "any-env-value")
  expect(r).toBe(cached)
  expect(r?.key).toBe("preserved")
})

test("currentProviders: late env adds provider drawn from cleanedDatabase", () => {
  const candidate = baseInfo(["FOO_KEY"])
  const r = currentProviders(
    {
      cachedProviders: {} as Record<ProviderID, Provider.Info>,
      cleanedDatabase: { foo: candidate } as Record<ProviderID, Provider.Info>,
    },
    { FOO_KEY: "k" },
  )
  expect(r["foo" as ProviderID]?.source).toBe("env")
  expect(r["foo" as ProviderID]?.key).toBe("k")
})

test("currentProviders: removing env from process drops env-only entry", () => {
  const cached = { ...baseInfo(["FOO_KEY"]), key: "k" }
  const r = currentProviders(
    {
      cachedProviders: { foo: cached } as Record<ProviderID, Provider.Info>,
      cleanedDatabase: { foo: baseInfo(["FOO_KEY"]) } as Record<ProviderID, Provider.Info>,
    },
    {},
  )
  expect(r["foo" as ProviderID]).toBeUndefined()
})

test("currentProviders: cached api entry preserved across env presence/absence", () => {
  const cached = { ...baseInfo(["FOO_KEY"], "api"), key: "auth" }
  const env = currentProviders(
    {
      cachedProviders: { foo: cached } as Record<ProviderID, Provider.Info>,
      cleanedDatabase: { foo: baseInfo(["FOO_KEY"]) } as Record<ProviderID, Provider.Info>,
    },
    { FOO_KEY: "envk" },
  )
  expect(env["foo" as ProviderID]).toBe(cached)

  const noEnv = currentProviders(
    {
      cachedProviders: { foo: cached } as Record<ProviderID, Provider.Info>,
      cleanedDatabase: { foo: baseInfo(["FOO_KEY"]) } as Record<ProviderID, Provider.Info>,
    },
    {},
  )
  expect(noEnv["foo" as ProviderID]).toBe(cached)
})

test("currentProviders: whitespace-only env value treated as absent", () => {
  const r = currentProviders(
    {
      cachedProviders: {} as Record<ProviderID, Provider.Info>,
      cleanedDatabase: { foo: baseInfo(["FOO_KEY"]) } as Record<ProviderID, Provider.Info>,
    },
    { FOO_KEY: "   " },
  )
  expect(r["foo" as ProviderID]).toBeUndefined()
})

test("currentProviders: empty-string env value treated as absent", () => {
  const r = currentProviders(
    {
      cachedProviders: {} as Record<ProviderID, Provider.Info>,
      cleanedDatabase: { foo: baseInfo(["FOO_KEY"]) } as Record<ProviderID, Provider.Info>,
    },
    { FOO_KEY: "" },
  )
  expect(r["foo" as ProviderID]).toBeUndefined()
})

test("currentProviders: surrounding-whitespace env value preserved verbatim (not trimmed)", () => {
  const r = currentProviders(
    {
      cachedProviders: {} as Record<ProviderID, Provider.Info>,
      cleanedDatabase: { foo: baseInfo(["FOO_KEY"]) } as Record<ProviderID, Provider.Info>,
    },
    { FOO_KEY: "  abc  " },
  )
  expect(r["foo" as ProviderID]?.key).toBe("  abc  ")
})

test("currentProviders: blank env skipped, falls through to next env in multi-env list", () => {
  const r = currentProviders(
    {
      cachedProviders: {} as Record<ProviderID, Provider.Info>,
      cleanedDatabase: { foo: baseInfo(["A", "B"]) } as Record<ProviderID, Provider.Info>,
    },
    { A: "  ", B: "real-key" },
  )
  expect(r["foo" as ProviderID]?.source).toBe("env")
  expect(r["foo" as ProviderID]?.key).toBeUndefined()
})
