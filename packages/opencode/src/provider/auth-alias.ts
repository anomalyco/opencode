import type { Config } from "@/config/config"

export function driver(cfg: Config.Info, id: string) {
  const seen = new Set<string>()
  let current = id

  while (true) {
    if (seen.has(current)) return current
    seen.add(current)

    const next = cfg.provider?.[current]?.auth_provider
    if (!next || next === current) return current
    current = next
  }
}

export function aliases(cfg: Config.Info, id: string) {
  return Object.keys(cfg.provider ?? {}).filter((item) => item !== id && driver(cfg, item) === id)
}