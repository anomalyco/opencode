import { beforeEach, describe, expect, test } from "bun:test"
import { applyTheme, getActiveTheme, removeTheme } from "./loader"
import type { DesktopTheme } from "./types"

const theme = {
  name: "Test",
  id: "oc-test",
  light: {
    seeds: {
      neutral: "#808080",
      primary: "#4f46e5",
      success: "#16a34a",
      warning: "#ca8a04",
      error: "#dc2626",
      info: "#0284c7",
      interactive: "#2563eb",
      diffAdd: "#15803d",
      diffDelete: "#b91c1c",
    },
  },
  dark: {
    seeds: {
      neutral: "#9ca3af",
      primary: "#818cf8",
      success: "#22c55e",
      warning: "#eab308",
      error: "#ef4444",
      info: "#38bdf8",
      interactive: "#60a5fa",
      diffAdd: "#4ade80",
      diffDelete: "#f87171",
    },
  },
} satisfies DesktopTheme

type Node = {
  id: string
  textContent: string
  remove: () => void
}

declare global {
  var __themeStats: {
    setTheme: () => number
    removedTheme: () => number
  }
}

const createDoc = () => {
  const map = new Map<string, Node>()
  let themeAttrSet = 0
  let themeAttrRemoved = 0
  const root = {
    attrs: new Map<string, string>(),
    setAttribute(k: string, v: string) {
      if (k === "data-theme") themeAttrSet++
      this.attrs.set(k, v)
    },
    getAttribute(k: string) {
      return this.attrs.get(k) ?? null
    },
    removeAttribute(k: string) {
      if (k === "data-theme") themeAttrRemoved++
      this.attrs.delete(k)
    },
    style: {
      setProperty() {},
      removeProperty() {},
    },
  }

  return {
    document: {
      documentElement: root,
      head: {
        appendChild(node: Node) {
          map.set(node.id, node)
        },
      },
      createElement() {
        const node: Node = {
          id: "",
          textContent: "",
          remove() {
            map.delete(node.id)
          },
        }
        return node
      },
      getElementById(id: string) {
        return map.get(id) ?? null
      },
    },
    stats: {
      setTheme: () => themeAttrSet,
      removedTheme: () => themeAttrRemoved,
    },
  }
}

beforeEach(() => {
  const env = createDoc()
  globalThis.document = env.document as unknown as Document
  globalThis.__themeStats = env.stats
})

describe("theme loader", () => {
  test("does not mutate data-theme attribute", () => {
    applyTheme(theme)
    removeTheme()
    expect(globalThis.__themeStats.setTheme()).toBe(0)
    expect(globalThis.__themeStats.removedTheme()).toBe(0)
  })

  test("tracks active theme without html attribute", () => {
    applyTheme(theme)
    expect(getActiveTheme()?.id).toBe("oc-test")
    removeTheme()
    expect(getActiveTheme()).toBeNull()
  })
})
