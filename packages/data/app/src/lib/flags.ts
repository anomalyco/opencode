import { Resource } from "@opencode/data-core/resource"

// The data site's feature flags, decided when it's built: on in local builds (`vite dev`, STAGE unset) and on every
// stage but production, off in production. DATA_FLAGS names flags to force either way, as in `share` or `-share`.
// vite.config.ts passes the result to the app as import.meta.env.DATA_FLAGS; read it with dataFlag() (lib/flag.ts).
export const registry = {
  share: "Share and embed cards for each section of the home page: the share editor, /data/embed and /data/oembed.",
} as const satisfies Record<string, string>

export type DataFlag = keyof typeof registry

export function enabledDataFlags() {
  const named = (process.env.DATA_FLAGS ?? "").split(",").map((item) => item.trim())
  const production = process.env.STAGE ? Resource.App.stage === "production" : false
  return (Object.keys(registry) as DataFlag[]).filter(
    (key) => named.includes(key) || (!production && !named.includes(`-${key}`)),
  )
}
