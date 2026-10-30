// Bun and Node's EnvHttpProxyAgent read lowercase `no_proxy` alone whenever set, so both spellings
// receive one merged list. Preserves `*` intact because EnvHttpProxyAgent checks `noProxy === "*"`.
export function ensureLoopbackNoProxy() {
  const raw = [process.env.NO_PROXY, process.env.no_proxy, "127.0.0.1,localhost,::1"].flatMap((value) =>
    (value?.split(",") ?? []).flatMap((item) => {
      const trimmed = item.trim()

      return trimmed ? [trimmed] : []
    }),
  )

  if (raw.includes("*")) {
    process.env.NO_PROXY = "*"
    process.env.no_proxy = "*"

    return
  }

  const seen = new Set<string>()

  const merged = raw
    .filter((item) => {
      const key = item.toLowerCase()

      if (seen.has(key)) return false
      seen.add(key)

      return true
    })
    .join(",")

  process.env.NO_PROXY = merged
  process.env.no_proxy = merged
}
