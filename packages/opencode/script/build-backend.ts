# Build script to compile backend as standalone binary

import { build } from "esbuild";
import { copyFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const backendDir = join(import.meta.dir, "../../opencode");
const outDir = join(import.meta.dir, "bin");

// Ensure output directory exists
if (!existsSync(outDir)) {
  mkdirSync(outDir, { recursive: true });
}

console.log("Building backend as standalone binary...");

try {
  build({
    entryPoints: [join(backendDir, "src/index.ts")],
    bundle: true,
    outfile: join(outDir, "opencode"),
    platform: "node",
    target: "node18",
    external: [
      "playwright-chromium",
      "playwright-*",
      "*.node",
      "@opencode-ai/*",
      "solid-js",
      "@solid-primitives/*",
      "@kobalte/*",
      "@thisbeyond/*"
    ],
    format: "esm",
    banner: {
      js: "#!/usr/bin/env node",
    },
    minify: false,
    sourcemap: false,
    jsx: "automatic",
    jsxImportSource: "solid-js",
    jsxDev: false,
  });

  console.log("✅ Backend built successfully!");
  console.log(`Output: ${join(outDir, "opencode")}`);
} catch (error) {
  console.error("❌ Build failed:", error);
  process.exit(1);
}
