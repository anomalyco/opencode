import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig, searchForWorkspaceRoot } from "vite"
import solid from "vite-plugin-solid"
import { storyIndex } from "./src/index-plugin"

// Serves one story at a time for the component tests, the way Storybook's iframe did, without Storybook. The app's
// browsing UI for stories is the components lab in the app itself.
const here = path.dirname(fileURLToPath(import.meta.url))
const packages = path.resolve(here, "..")
const app = path.resolve(packages, "app/src")
const mocks = path.resolve(here, "mocks")
const roots = ["ui", "session-ui", "app", "gui-extensions"].map((name) => path.resolve(packages, name, "src"))

// Component tests import real modules by URL (`source("../src/…")`, `new URL("./x.fixture.tsx", import.meta.url)`),
// past the mock aliases. Read those paths from the specs so the dependency optimizer crawls exactly what they load.
const componentTestModules = readdirSync(packages)
  .map((name) => path.join(packages, name, "component-tests"))
  .filter((dir) => existsSync(dir))
  .flatMap((dir) =>
    readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".spec.ts"))
      .flatMap((file) =>
        Array.from(readFileSync(path.join(dir, file), "utf8").matchAll(/["'](\.{1,2}\/[^"']+\.tsx?)["']/g), (match) =>
          path.resolve(dir, path.dirname(file), match[1]!),
        ),
      ),
  )

const entry = (file: string) => path.relative(here, file).replaceAll("\\", "/")

export default defineConfig({
  plugins: [solid(), tailwindcss(), storyIndex(roots)],
  publicDir: path.resolve(packages, "app/public"),
  optimizeDeps: {
    // Vite finds a dependency on its first import and reloads every open page, which would abort a component test
    // mid-import. Crawl the stories, the workers (the scan does not follow `new Worker(new URL(…))`), the modules the
    // component tests load, and the frame, so the first browser request never discovers a new dependency.
    entries: [
      "../{ui,session-ui,app,gui-extensions}/src/**/*.{stories.tsx,worker.ts}",
      ...new Set(componentTestModules.map(entry)),
      "index.html",
    ],
  },
  resolve: {
    dedupe: ["solid-js", "solid-js/web", "@solidjs/meta", "@tanstack/solid-query"],
    // Stories render without a server, router or project: these modules give them fixed data instead.
    alias: [
      { find: "@solidjs/router", replacement: path.resolve(mocks, "solid-router.tsx") },
      { find: /^@\/providers\/models\/selection$/, replacement: path.resolve(mocks, "app/context/local.ts") },
      { find: /^@\/workspaces\/files\/model$/, replacement: path.resolve(mocks, "app/context/file.ts") },
      { find: /^@\/shell\/state\/layout$/, replacement: path.resolve(mocks, "app/context/layout.ts") },
      { find: /^@\/workspaces\/location$/, replacement: path.resolve(mocks, "app/context/location.ts") },
      { find: /^@\/composer\/comments$/, replacement: path.resolve(mocks, "app/context/comments.ts") },
      { find: /^@\/shell\/commands\/command$/, replacement: path.resolve(mocks, "app/context/command.ts") },
      { find: /^@\/runtime\/platform\/platform$/, replacement: path.resolve(mocks, "app/context/platform.ts") },
      { find: /^@\/runtime\/server\/sync$/, replacement: path.resolve(mocks, "app/context/server-sync.ts") },
      { find: /^@\/runtime\/server\/client$/, replacement: path.resolve(mocks, "app/context/server-sdk.ts") },
      { find: /^@\/runtime\/server\/current$/, replacement: path.resolve(mocks, "app/context/server-current.ts") },
      { find: /^@\/providers\/catalog\/providers$/, replacement: path.resolve(mocks, "app/hooks/use-providers.ts") },
      {
        find: /^@\/providers\/models\/unpaid$/,
        replacement: path.resolve(mocks, "app/components/dialog-select-model-unpaid.tsx"),
      },
      { find: "@", replacement: app },
    ],
  },
  worker: {
    format: "es",
  },
  server: {
    host: "127.0.0.1",
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd()), packages],
    },
  },
})
