import { createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { persisted, Persist } from "@/utils/persist"

export interface Preset {
  id: string
  name: string
  content: string
  order: number
  createdAt: string
  updatedAt: string
}

export interface PresetsConfig {
  presets: Preset[]
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export function resolveVariables(content: string, values: Record<string, string>): string {
  return content.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? `{${key}}`)
}

export function extractVariables(content: string): string[] {
  const matches = content.match(/\{(\w+)\}/g)
  if (!matches) return []
  return [...new Set(matches.map((m) => m.slice(1, -1)))]
}

export function createPresetsStore() {
  const [store, setStore, _, ready] = persisted(
    Persist.global("presets"),
    createStore<PresetsConfig>({ presets: [] }),
  )

  const presets = createMemo(() => [...(store.presets ?? [])].sort((a, b) => a.order - b.order))

  const add = (name: string, content: string): Preset => {
    const all = store.presets ?? []
    const maxOrder = all.length > 0 ? Math.max(...all.map((p) => p.order)) : 0
    const now = new Date().toISOString()
    const preset: Preset = {
      id: generateId(),
      name,
      content,
      order: maxOrder + 1,
      createdAt: now,
      updatedAt: now,
    }
    setStore("presets", [...all, preset])
    return preset
  }

  const update = (id: string, patch: Partial<Pick<Preset, "name" | "content">>) => {
    const now = new Date().toISOString()
    setStore(
      "presets",
      (store.presets ?? []).map((p) => (p.id === id ? { ...p, ...patch, updatedAt: now } : p)),
    )
  }

  const remove = (id: string) => {
    setStore(
      "presets",
      (store.presets ?? []).filter((p) => p.id !== id),
    )
  }

  const moveUp = (id: string) => {
    const all = [...(store.presets ?? [])].sort((a, b) => a.order - b.order)
    const idx = all.findIndex((p) => p.id === id)
    if (idx <= 0) return
    const tmp = all[idx].order
    all[idx] = { ...all[idx], order: all[idx - 1].order }
    all[idx - 1] = { ...all[idx - 1], order: tmp }
    setStore("presets", all)
  }

  const moveDown = (id: string) => {
    const all = [...(store.presets ?? [])].sort((a, b) => a.order - b.order)
    const idx = all.findIndex((p) => p.id === id)
    if (idx < 0 || idx >= all.length - 1) return
    const tmp = all[idx].order
    all[idx] = { ...all[idx], order: all[idx + 1].order }
    all[idx + 1] = { ...all[idx + 1], order: tmp }
    setStore("presets", all)
  }

  return {
    presets,
    ready,
    add,
    update,
    remove,
    moveUp,
    moveDown,
  }
}

export type PresetsStore = ReturnType<typeof createPresetsStore>
