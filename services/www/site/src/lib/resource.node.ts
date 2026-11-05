// `vite dev`'s stand-in for resource.cloudflare.ts: the same shape, read from process.env
// (STAGE and any secrets you export), and waitUntil that just awaits.
export type Resources = { App: { stage: "production" | "dev" } } & Record<string, { value: string }>

export const waitUntil = async (promise: Promise<unknown>) => {
  await promise
}

export const Resource = new Proxy({} as Resources, {
  get(_target, name: string) {
    if (name === "App") return { stage: process.env.STAGE === "production" ? "production" : "dev" }
    const value = process.env[name]
    if (!value) throw new Error(`"${name}" is not set in the environment`)
    return { value }
  },
})
