export * as BrowserServe from "./serve.js"

import { stat } from "node:fs/promises"
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path"
import { Tool } from "@opencode/schema/tool"
import { Effect } from "effect"

type Root = { readonly token: string; readonly directory: string }

// Local files reach the desktop's tabs as http pages on the server's loopback, which the desktop already reaches
// through its server-network tunnel. Each served directory gets an unguessable path prefix; nothing else is served.
export const make = Effect.fn("BrowserServe.make")(function* (directory: string) {
  const roots = new Map<string, Root>()
  const state: { server?: ReturnType<typeof Bun.serve> } = {}
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      void state.server?.stop(true)
      state.server = undefined
    }),
  )

  const start = () =>
    (state.server ??= Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (request) => {
        const url = new URL(request.url)
        const [, token, ...rest] = url.pathname.split("/")
        const root = Array.from(roots.values()).find((item) => item.token === token)
        if (!root || (request.method !== "GET" && request.method !== "HEAD"))
          return new Response("Not found", { status: 404 })
        const relative = normalize(decodeURIComponent(rest.join("/")))
        if (relative.startsWith("..") || relative.includes(`${sep}..${sep}`))
          return new Response("Not found", { status: 404 })
        const path = join(root.directory, relative)
        const file = Bun.file(path)
        const index = Bun.file(join(path, "index.html"))
        const target = (await file.exists()) ? file : (await index.exists()) ? index : undefined
        if (!target) return new Response("Not found", { status: 404 })
        return new Response(request.method === "HEAD" ? null : target, {
          headers: { "content-type": target.type, "cache-control": "no-store" },
        })
      },
    }))

  return {
    /** An http URL the desktop tab can load for a server-local file, serving the folder it lives in. */
    url: (input: string) =>
      Effect.tryPromise({
        try: async () => {
          const path = resolve(directory, input)
          const info = await stat(path)
          if (!info.isFile()) throw new Error("The path names a directory. Pass the HTML file inside it.")
          // Inside the workspace the whole workspace is served, so `../shared/style.css` still resolves.
          const inside = !relative(directory, path).startsWith("..") && !isAbsolute(relative(directory, path))
          const base = inside ? directory : dirname(path)
          const root = roots.get(base) ?? { token: crypto.randomUUID(), directory: base }
          roots.set(base, root)
          const server = start()
          const file = relative(base, path).split(/[\\/]/).map(encodeURIComponent).join("/")
          return `http://127.0.0.1:${server.port}/${root.token}/${file}`
        },
        catch: (error) =>
          new Tool.Error({
            message: `Cannot serve ${input} to the browser: ${error instanceof Error ? error.message : String(error)}. The path is server-local, relative to the workspace or absolute; check that the file exists on the server.`,
            error,
          }),
      }),
  }
})

export type Serve = Effect.Success<ReturnType<typeof make>>
