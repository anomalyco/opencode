import { readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { solidStart } from "@solidjs/start/config"
import { nitro } from "nitro/vite"
import { defineConfig, type PluginOption } from "vite"
import { stageHeaders } from "./src/lib/noindex"

export default defineConfig({
  base: "/data/",
  plugins: [
    solidStart({ middleware: "./src/middleware.ts" }) as PluginOption,
    nitro({
      // The Worker owns opencode.ai/data/* directly, so static assets are uploaded under /data like the pages that
      // reference them. Nitro's baseURL would do this too, but its router would then stop serving /<locale>/data.
      output: { publicDir: "{{ output.dir }}/public/data" },
      compatibilityDate: "2024-09-19",
      preset: "cloudflare-module",
      cloudflare: {
        nodeCompat: true,
      },
    }),
    {
      // Cloudflare only reads _headers at the assets root, but Nitro writes it into publicDir with unprefixed paths.
      name: "stats:headers",
      buildApp: {
        order: "post",
        async handler() {
          const source = path.join(import.meta.dirname, ".output/public/data/_headers")
          // The stage's headers for the assets the Worker never sees (src/lib/noindex.ts).
          const stage = Object.entries(stageHeaders()).map(([name, value]) => `  ${name}: ${value}\n`)
          await writeFile(
            path.join(import.meta.dirname, ".output/public/_headers"),
            (await readFile(source, "utf8")).replace(/^\//gm, "/data/") +
              (stage.length ? `\n/data/*\n${stage.join("")}` : ""),
          )
          await rm(source)
        },
      },
    },
  ],
  server: {
    allowedHosts: true,
  },
  build: {
    minify: "esbuild",
    cssMinify: true,
  },
})
