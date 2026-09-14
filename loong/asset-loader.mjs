import { pathToFileURL } from "node:url";
import { existsSync, statSync, appendFileSync, realpathSync, readFileSync, writeFileSync as _wfs } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, sep } from "node:path";
import * as path from "node:path";

function logLine(msg) {
  try {
    appendFileSync("/tmp/loader.log", msg + "\n");
  } catch {}
}

const ASSET_EXTENSIONS = /\.(mp3|wav|ogg|oga|m4a|flac|aac|png|jpe?g|gif|svg|webp|avif|ico|ttf|otf|woff2?|eot|pdf|mp4|webm|mov)$/i;
const TEXT_EXTENSIONS = /\.(txt|md|csv)$/i;
const isAssetUrl = (url) => ASSET_EXTENSIONS.test(String(url).split("?")[0]);

const EXT_CANDIDATES = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"];

function repoRootOfUrl(parentUrl) {
  try {
    const u = new URL(parentUrl);
    const segments = u.pathname.split("/");
    const idx = segments.indexOf("packages");
    if (idx >= 0 && segments[idx + 1] === "opencode") {
      return segments.slice(0, idx).join(sep);
    }
  } catch {}
  return null;
}

function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function resolveFile(baseDir, rel) {
  const path = join(baseDir, rel);
  for (const ext of EXT_CANDIDATES) {
    const candidate = path + ext;
    if (isFile(candidate)) {
      return candidate;
    }
  }
  // TS convention: import "./x.js" refers to the x.ts / x.tsx source.
  if (/\.js$/i.test(path)) {
    const base = path.replace(/\.js$/i, "");
    for (const ext of [".ts", ".tsx", ".mjs"]) {
      const candidate = base + ext;
      if (isFile(candidate)) return candidate;
    }
  }
  for (const ext of ["", ".ts", ".tsx", ".js", ".mjs", ".jsx", ".cjs"]) {
    const idx = join(path, "index" + ext);
    if (isFile(idx)) return idx;
  }
  return null;
}

function resolveBare(specifier, parentUrl) {
  try {
    const parts = specifier.split("/")
    const scoped = specifier.startsWith("@")
    const pkgSegs = scoped ? parts.slice(0, 2) : parts.slice(0, 1)
    const sub = parts.slice(scoped ? 2 : 1).join("/")
    let dir = path.dirname(new URL(parentUrl).pathname)
    try { dir = realpathSync(dir) } catch {}
    for (;;) {
      const pkgRoot = path.join(dir, "node_modules", ...pkgSegs)
      if (existsSync(path.join(pkgRoot, "package.json"))) {
        const found = resolveFile(pkgRoot, sub || ".")
        if (found) return found
        if (!sub) {
          try {
            const pj = JSON.parse(readFileSync(path.join(pkgRoot, "package.json")))
            const main = pj && pj.main
            if (typeof main === "string") {
              const m = resolveFile(pkgRoot, main)
              if (m) return m
            }
          } catch {}
        }
      }
      const up = path.dirname(dir)
      if (up === dir) return null
      dir = up
    }
  } catch {
    return null
  }
}

async function resolveImpl(specifier, context, nextResolve) {
  if (typeof specifier === "string") {
    if (specifier === "." || specifier === ".." || specifier.startsWith("./") || specifier.startsWith("../")) {
      try {
        const parent = new URL(context.parentURL).pathname;
        const baseDir = path.dirname(parent);
        const found = resolveFile(baseDir, specifier);
        logLine("RESOLVE-REL spec=" + specifier + " parent=" + parent + " baseDir=" + baseDir + " found=" + (found || "null"));
        if (found) {
          return { url: pathToFileURL(found).href, shortCircuit: true };
        }
      } catch (e) { logLine("RESOLVE-REL-ERR spec=" + specifier + " " + (e && e.message)); }
    } else if (specifier.startsWith("@/")) {
      const root = repoRootOfUrl(context.parentURL);
      if (root) {
        const found = resolveFile(join(root, "packages", "opencode", "src"), specifier.slice(2));
        if (found) {
          return { url: pathToFileURL(found).href, shortCircuit: true };
        }
      }
    } else if (specifier.startsWith("bun:")) {
      logLine("RESOLVE-BUN specifier=" + specifier + " parent=" + (context.parentURL || ""));
      if (specifier === "bun:ffi") {
        return { url: new URL("./bun-ffi-shim.mjs", import.meta.url).href, shortCircuit: true };
      }
      if (specifier === "bun:sqlite") {
        return { url: new URL("./bun-sqlite-shim.mjs", import.meta.url).href, shortCircuit: true };
      }
    } else if (specifier === "bun") {
      logLine("RESOLVE-BUN-PKG parent=" + (context.parentURL || ""));
      return { url: new URL("./bun-shim.mjs", import.meta.url).href, shortCircuit: true };
    } else if (specifier.endsWith(".node")) {
      try {
        return { url: new URL(specifier, context.parentURL).href, shortCircuit: true };
      } catch {}
    } else if (!specifier.startsWith("node:")) {
      if (specifier.endsWith(".json")) {
        const found = resolveBare(specifier, context.parentURL);
        if (found) {
          return { url: pathToFileURL(found).href, shortCircuit: true };
        }
      }
      // Node-first, CJS-style (symlink-realpath + package.main) fallback:
      // exports mappings must win over our manual resolution.
      try {
        return await nextResolve(specifier, context);
      } catch (e) {
        const found = resolveBare(specifier, context.parentURL);
        if (found) {
          logLine("RESOLVE-BARE spec=" + specifier + " -> " + found);
          return { url: pathToFileURL(found).href, shortCircuit: true };
        }
        throw e;
      }
    }
  }
  return nextResolve(specifier, context);
}

async function loadImpl(url, context, nextLoad) {
  const cleanUrl = String(url).split("?")[0];
  if (cleanUrl.endsWith(".node")) {
    return {
      format: "module",
      source:
        "export const available = () => false;\nexport const init = () => Promise.resolve();\nexport default { available: () => false, init: () => Promise.resolve() };",
      shortCircuit: true,
    };
  }
  const attrs = context.attributes ?? context.importAttributes ?? {};
  const filePath = new URL(url).pathname;
  if (attrs.type === "file" || isAssetUrl(cleanUrl)) {
    return {
      format: "module",
      source:
        "export default " +
        JSON.stringify(filePath) +
        ";\nexport const path = " +
        JSON.stringify(filePath) +
        ";",
      shortCircuit: true,
    };
  }
  if (TEXT_EXTENSIONS.test(cleanUrl)) {
    const contents = await readFile(filePath, "utf8");
    return {
      format: "module",
      source:
        "export default " +
        JSON.stringify(contents) +
        ";\nexport const raw = " +
        JSON.stringify(contents) +
        ";",
      shortCircuit: true,
    };
  }
  if (cleanUrl.endsWith(".wasm")) {
    return {
      format: "module",
      source:
        "export default " +
        JSON.stringify(filePath) +
        ";\nexport const path = " +
        JSON.stringify(filePath) +
        ";",
      shortCircuit: true,
    };
  }
  if (cleanUrl.endsWith(".json")) {
    const contents = await readFile(filePath, "utf8");
    return { format: "json", source: contents, shortCircuit: true };
  }
  try {
    return await nextLoad(url, context);
  } catch (e) {
    logLine("NEXTLOAD-ERR url=" + url + " msg=" + (e && e.message));
    throw e;
  }
}

const _PROF = { resolve: 0, resolveMs: 0, load: 0, loadMs: 0 }
if (process.env.OC_PROFILE) {
  setInterval(() => { try { _wfs("/tmp/prof-asset.json", JSON.stringify(_PROF)) } catch {} }, 3000)
}
function _withProf(k, impl) {
  return async (...a) => {
    const t = Date.now()
    try { return await impl(...a) } finally {
      _PROF[k]++; _PROF[k + "Ms"] += Date.now() - t
    }
  }
}
export const resolve = _withProf("resolve", resolveImpl)
export const load = _withProf("load", loadImpl)
