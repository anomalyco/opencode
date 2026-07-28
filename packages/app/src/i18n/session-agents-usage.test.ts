import { describe, expect, test } from "bun:test"
import path from "node:path"
import { dict } from "./en"

// Every consumer of these keys is JSX, and the dictionaries themselves are `.ts`, so scanning only
// `.tsx` reads real call sites without matching the declarations it is checking them against.
const root = path.join(import.meta.dir, "..")

// Matches `language.t("...")` and the bare `t("...")` form `statusLabel` receives as a parameter.
const call = /\bt\(\s*(["'])(session\.tab\.agents|session\.agents\.[A-Za-z0-9.]+)\1/g

const declared = Object.keys(dict)
  .filter((key) => key === "session.tab.agents" || key.startsWith("session.agents."))
  .sort()

const scan = await (async () => {
  const consumers = new Map<string, string[]>()
  const files: string[] = []
  for await (const file of new Bun.Glob("**/*.tsx").scan({ cwd: root })) {
    files.push(file)
    for (const match of (await Bun.file(path.join(root, file)).text()).matchAll(call)) {
      consumers.set(match[2], [...(consumers.get(match[2]) ?? []), file])
    }
  }
  return { consumers, files }
})()

describe("session.agents i18n usage", () => {
  test("the scan actually walked the source tree", () => {
    expect(scan.files.length).toBeGreaterThan(0)
    expect(declared.length).toBeGreaterThan(0)
    expect(scan.consumers.size).toBeGreaterThan(0)
  })

  test("every key used in a component is declared in en.ts", () => {
    const undeclared = [...scan.consumers]
      .filter(([key]) => !Object.hasOwn(dict, key))
      .map(([key, files]) => `${key} (used in ${files.join(", ")})`)
    expect(undeclared).toEqual([])
  })

  test("every key declared in en.ts has at least one consumer", () => {
    expect(declared.filter((key) => !scan.consumers.has(key))).toEqual([])
  })

  test("declared and used sets are exactly one-to-one", () => {
    expect([...scan.consumers.keys()].sort()).toEqual(declared)
  })
})
