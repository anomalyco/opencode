import { defineConfig } from "vite"
import solid from "vite-plugin-solid"
import tailwindcss from "@tailwindcss/vite"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"
import path from "node:path"

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  publicDir: fileURLToPath(new URL("../../../public", import.meta.url)),
  plugins: [
    solid(),
    tailwindcss(),
    {
      name: "patch-group-counters",
      enforce: "pre",
      load(id) {
        if (!process.env.PATCH_REVISION) return
        const root = fileURLToPath(new URL("../../../../..", import.meta.url))
        const file = path.relative(root, id).replaceAll("\\", "/")
        if (
          ![
            "packages/session-ui/src/components/apply-patch-file.ts",
            "packages/session-ui/src/tools/tool-renderer.tsx",
          ].includes(file)
        )
          return
        return execFileSync("git", ["show", `${process.env.PATCH_REVISION}:${file}`], { cwd: root, encoding: "utf8" })
      },
      transform(code, id) {
        if (process.env.PATCH_COUNTERS !== "1") return
        const functions = id.replaceAll("\\", "/").endsWith("/apply-patch-file.ts")
          ? ["patchFileGroups"]
          : id.replaceAll("\\", "/").endsWith("/session-diff.ts")
            ? ["normalize", "completePatchContents"]
            : id.replaceAll("\\", "/").endsWith("/diff/line.js")
              ? ["diffLines"]
              : []
        for (const name of functions) {
          const pattern = new RegExp(`(export function ${name}\\([^)]*\\)[^{]*\\{)`)
          if (!pattern.test(code)) throw new Error(`Missing instrumented function ${name} in ${id}`)
          code = code.replace(pattern, `$1 performance.mark("patch-counter:${name}");`)
        }
        return functions.length ? { code, map: null } : undefined
      },
    },
  ],
  resolve: { dedupe: ["solid-js", "@solidjs/meta"] },
  worker: { format: "es" },
  build: { outDir: process.env.PATCH_BUILD_DIR, emptyOutDir: true, sourcemap: true },
})
