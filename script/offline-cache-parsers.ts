#!/usr/bin/env bun

/**
 * 离线解析器缓存下载脚本
 *
 * 在有外网的开发机上执行，将 parsers-config.ts 中引用的所有
 * tree-sitter WASM 文件和 SCM 查询文件下载到本地目录，
 * 供离线部署时随同二进制一起分发。
 *
 * 用法:
 *   bun run script/offline-cache-parsers.ts [--output <dir>]
 *
 * 默认输出目录: <project-root>/offline-cache/parsers
 */

import fs from "fs"
import path from "path"
import parsersConfig from "../packages/opencode/parsers-config"

const args = process.argv.slice(2)
const outputIdx = args.indexOf("--output")
const CACHE_DIR =
  outputIdx !== -1 && args[outputIdx + 1]
    ? path.resolve(args[outputIdx + 1])
    : path.resolve(import.meta.dirname, "../offline-cache/parsers")

let downloaded = 0
let skipped = 0
let failed = 0

async function download(url: string, dest: string) {
  if (fs.existsSync(dest)) {
    skipped++
    console.log(`  [SKIP] ${path.basename(dest)}`)
    return true
  }
  console.log(`  [GET]  ${url}`)
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(60000),
      headers: { "User-Agent": "opencode-offline-cache/1.0" },
    })
    if (!res.ok) {
      failed++
      console.error(`  [FAIL] HTTP ${res.status}: ${url}`)
      return false
    }
    await fs.promises.mkdir(path.dirname(dest), { recursive: true })
    await fs.promises.writeFile(dest, Buffer.from(await res.arrayBuffer()))
    downloaded++
    return true
  } catch (err) {
    failed++
    console.error(`  [FAIL] ${err instanceof Error ? err.message : err}: ${url}`)
    return false
  }
}

async function main() {
  console.log(`Offline parser cache directory: ${CACHE_DIR}\n`)
  await fs.promises.mkdir(CACHE_DIR, { recursive: true })

  // Write a manifest for traceability
  const manifest: Record<string, { wasm?: string; queries?: Record<string, string[]> }> = {}

  for (const parser of parsersConfig.parsers) {
    const ft = parser.filetype
    console.log(`[${ft}]`)
    manifest[ft] = {}

    // Download WASM
    const wasmName = path.basename(new URL(parser.wasm).pathname)
    const wasmDest = path.join(CACHE_DIR, ft, wasmName)
    const wasmOk = await download(parser.wasm, wasmDest)
    if (wasmOk) {
      manifest[ft].wasm = wasmName
    }

    // Download query files
    if (parser.queries) {
      manifest[ft].queries = {}
      for (const [queryType, urls] of Object.entries(parser.queries)) {
        const queryNames: string[] = []
        for (const url of urls) {
          const queryName = `${queryType}.scm`
          const queryDest = path.join(CACHE_DIR, ft, queryName)
          const queryOk = await download(url, queryDest)
          if (queryOk) {
            queryNames.push(queryName)
          }
        }
        if (queryNames.length > 0) {
          manifest[ft].queries![queryType] = queryNames
        }
      }
    }
  }

  // Cache the tree-sitter core WASM from npm packages
  console.log(`\n[_core]`)
  const coreWasmSearchPaths = [
    "../node_modules/web-tree-sitter/tree-sitter.wasm",
    "../packages/opencode/node_modules/web-tree-sitter/tree-sitter.wasm",
    "../node_modules/.cache/web-tree-sitter/tree-sitter.wasm",
  ]
  let coreCached = false
  for (const p of coreWasmSearchPaths) {
    const resolved = path.resolve(import.meta.dirname, p)
    if (fs.existsSync(resolved)) {
      const coreDest = path.join(CACHE_DIR, "_core", "tree-sitter.wasm")
      if (!fs.existsSync(coreDest)) {
        await fs.promises.mkdir(path.dirname(coreDest), { recursive: true })
        await fs.promises.copyFile(resolved, coreDest)
        console.log(`  [COPY] tree-sitter.wasm <- ${resolved}`)
        downloaded++
      } else {
        console.log(`  [SKIP] tree-sitter.wasm (already cached)`)
        skipped++
      }
      coreCached = true
      break
    }
  }
  if (!coreCached) {
    console.warn(`  [WARN] tree-sitter.wasm not found in node_modules. It will be bundled via Bun compile.`)
  }

  // Write manifest
  const manifestPath = path.join(CACHE_DIR, "manifest.json")
  await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2))
  console.log(`\n  Manifest: ${manifestPath}`)

  // Summary
  console.log(`\n${"=".repeat(60)}`)
  console.log(`Downloaded: ${downloaded} files`)
  console.log(`Skipped: ${skipped} files`)
  if (failed > 0) {
    console.log(`Failed: ${failed} files`)
    console.log(`\nWarning: Some files failed to download.`)
    process.exit(1)
  }
  console.log(`\nCache dir: ${CACHE_DIR}`)
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
