import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config"

// Node builtins that workerd does not implement natively resolve to unenv
// polyfills (the same ones wrangler bundles). The rest of the node:* surface
// comes from workerd's nodejs_compat, allowlisted through the (patched)
// module fallback service: see patches/@cloudflare%2Fvitest-pool-workers.
import { createRequire } from "node:module"

const resolve = createRequire(import.meta.url).resolve
const unenv = (name: string) => resolve(`unenv/node/${name}`)
const mockProxy = resolve("unenv/mock/proxy")

export default defineWorkersConfig({
  // Core imports markdown files as text (bun `with { type: "text" }`); serve
  // them as string modules.
  plugins: [
    {
      name: "markdown-as-text",
      enforce: "pre",
      transform(code, id) {
        if (!id.endsWith(".md")) return null
        return { code: `export default ${JSON.stringify(code)};`, map: null }
      },
    },
  ],
  resolve: {
    alias: [
      { find: "node:os", replacement: unenv("os") },
      { find: "node:console", replacement: unenv("console") },
      { find: "node:child_process", replacement: unenv("child_process") },
      { find: "node:v8", replacement: unenv("v8") },
      { find: "node:http2", replacement: unenv("http2") },
      { find: "node:worker_threads", replacement: unenv("worker_threads") },
      // unenv's readline statically imports node:readline/promises, which the
      // fallback service cannot map from a raw-served file; nothing in the
      // workerd profile reads from a terminal, so mock the whole surface.
      { find: /^node:readline(\/promises)?$/, replacement: mockProxy },
      // @effect/platform-node's sqlite module; the profile's database runs on
      // Durable Object storage instead.
      { find: "node:sqlite", replacement: mockProxy },
      // @effect/platform-node's barrel eagerly imports its undici HttpClient;
      // the workerd profile only ever uses FetchHttpClient.
      { find: /^undici$/, replacement: mockProxy },
      // mime-types requires mime-db's JSON database at require time; keep the
      // lookup surface but back it with a static shim.
      { find: /^mime-types$/, replacement: new URL("./test/shims/mime-types.mjs", import.meta.url).pathname },
      // util/npm.ts imports the npm toolchain at module scope; plugin installs
      // never happen in the workerd profile (plugin discovery is precompiled-only),
      // and @npmcli/config touches process.stdout.isTTY during module init.
      { find: /^@npmcli\/config(\/.*)?$/, replacement: mockProxy },
      { find: /^@npmcli\/arborist(\/.*)?$/, replacement: mockProxy },
      { find: /^pacote(\/.*)?$/, replacement: mockProxy },
    ],
  },
  test: {
    testTimeout: 120_000,

    poolOptions: {
      workers: {
        singleWorker: true,
        // The booted opencode app layer keeps background fibers (and thus the
        // DO's SQLite WAL) alive across tests; isolated storage cannot pop
        // its stack frames around a live Durable Object. The spike's tests
        // build on each other sequentially instead.
        isolatedStorage: false,
        wrangler: { configPath: "./wrangler.jsonc" },
      },
    },
  },
})
