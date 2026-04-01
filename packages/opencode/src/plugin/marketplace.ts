// 18.5: Marketplace client — fetch plugin index from configurable URL, search, install
import { BunProc } from "@/bun"

export namespace Marketplace {
  const DEFAULT_URL = "https://opencode.ai/plugins/index.json"

  export type Entry = {
    id: string
    name: string
    description: string
    version: string
    author?: string
    tags?: string[]
    repository?: string
  }

  /** Fetch the plugin index from the marketplace URL */
  export async function index(url = DEFAULT_URL): Promise<Entry[]> {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Marketplace fetch failed: ${res.status} ${res.statusText}`)
    const data = await res.json()
    return Array.isArray(data) ? (data as Entry[]) : []
  }

  /** Search the marketplace index by query string */
  export async function search(query: string, url?: string): Promise<Entry[]> {
    const all = await index(url)
    const q = query.toLowerCase()
    return all.filter(
      (e) =>
        e.id.toLowerCase().includes(q) ||
        e.name.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        e.tags?.some((t) => t.toLowerCase().includes(q)),
    )
  }

  /** Install a plugin from the marketplace by package id */
  export async function install(pkg: string, version = "latest"): Promise<string> {
    return BunProc.install(pkg, version, { ignoreScripts: true })
  }
}
