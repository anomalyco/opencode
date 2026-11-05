// src/node-assets.ts
import { statSync } from "node:fs";
import { dirname, join as join2, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// src/node-asset-target.ts
var NATIVE_FILE_NAMES = {
  darwin: "libopentui.dylib",
  linux: "libopentui.so",
  win32: "opentui.dll"
};
function getNativeAssetDescriptor(target) {
  if (!Object.hasOwn(NATIVE_FILE_NAMES, target.platform) || target.arch !== "arm64" && target.arch !== "x64") {
    throw new Error(`Unsupported OpenTUI Node asset target: ${String(target.platform)}-${String(target.arch)}`);
  }
  if (target.libc !== undefined && target.libc !== "glibc" && target.libc !== "musl") {
    throw new Error(`Unsupported libc for OpenTUI Node assets: ${String(target.libc)}`);
  }
  if (target.platform !== "linux" && target.libc !== undefined) {
    throw new Error(`OpenTUI Node asset target libc is only supported on Linux, got ${target.platform}`);
  }
  const libcSuffix = target.platform === "linux" && target.libc === "musl" ? "-musl" : "";
  const packageName = `@opentui/core-${target.platform}-${target.arch}${libcSuffix}`;
  const fileName = NATIVE_FILE_NAMES[target.platform];
  return {
    key: `${packageName}/${fileName}`,
    packageName,
    fileName
  };
}

// src/platform/assets.ts
import { isAbsolute, join } from "node:path";

// src/lib/singleton.ts
var singletonCacheSymbol = Symbol.for("@opentui/core/singleton");
function singleton(key, factory) {
  const bag = globalThis[singletonCacheSymbol] ??= {};
  if (!(key in bag)) {
    bag[key] = factory();
  }
  return bag[key];
}

// src/lib/env.ts
var envRegistry = singleton("env-registry", () => ({}));
function registerEnvVar(config) {
  const existing = envRegistry[config.name];
  if (existing) {
    if (existing.description !== config.description || existing.type !== config.type || existing.default !== config.default) {
      throw new Error(`Environment variable "${config.name}" is already registered with different configuration. ` + `Existing: ${JSON.stringify(existing)}, New: ${JSON.stringify(config)}`);
    }
    return;
  }
  envRegistry[config.name] = config;
}
function normalizeBoolean(value) {
  const lowerValue = value.toLowerCase();
  return ["true", "1", "on", "yes"].includes(lowerValue);
}
function parseEnvValue(config) {
  const envValue = process.env[config.name];
  if (envValue === undefined && config.default !== undefined) {
    return config.default;
  }
  if (envValue === undefined) {
    throw new Error(`Required environment variable ${config.name} is not set. ${config.description}`);
  }
  switch (config.type) {
    case "boolean":
      return typeof envValue === "boolean" ? envValue : normalizeBoolean(envValue);
    case "number":
      const numValue = Number(envValue);
      if (isNaN(numValue)) {
        throw new Error(`Environment variable ${config.name} must be a valid number, got: ${envValue}`);
      }
      return numValue;
    case "string":
    default:
      return envValue;
  }
}

class EnvStore {
  parsedValues = new Map;
  get(key) {
    if (this.parsedValues.has(key)) {
      return this.parsedValues.get(key);
    }
    if (!(key in envRegistry)) {
      throw new Error(`Environment variable ${key} is not registered.`);
    }
    try {
      const value = parseEnvValue(envRegistry[key]);
      this.parsedValues.set(key, value);
      return value;
    } catch (error) {
      throw new Error(`Failed to parse env var ${key}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  has(key) {
    return key in envRegistry;
  }
  clearCache() {
    this.parsedValues.clear();
  }
}
var envStore = singleton("env-store", () => new EnvStore);
var env = new Proxy({}, {
  get(target, prop) {
    if (typeof prop !== "string") {
      return;
    }
    return envStore.get(prop);
  },
  has(target, prop) {
    return envStore.has(prop);
  },
  ownKeys() {
    return Object.keys(envRegistry);
  },
  getOwnPropertyDescriptor(target, prop) {
    if (envStore.has(prop)) {
      return {
        enumerable: true,
        configurable: true,
        get: () => envStore.get(prop)
      };
    }
    return;
  }
});

// src/platform/assets.ts
registerEnvVar({
  name: "OTUI_ASSET_ROOT",
  description: "Absolute directory containing relocatable OpenTUI runtime assets",
  type: "string",
  default: ""
});
function validateAssetKey(key) {
  if (key.length === 0 || isAbsolute(key) || key.includes("\\") || key.split("/").includes("..")) {
    throw new Error(`Invalid OpenTUI asset key: ${JSON.stringify(key)}`);
  }
}

// src/platform/runtime-assets.node.ts
var CORE_ASSET_PREFIX = "@opentui/core/";
var PARSER_WORKER_ASSET_KEY = `${CORE_ASSET_PREFIX}parser.worker.js`;

// src/lib/tree-sitter/default-parsers.ts
var defaultParserDescriptors = [
  {
    filetype: "javascript",
    aliases: ["javascriptreact"],
    queries: { highlights: ["assets/javascript/highlights.scm"] },
    wasm: "assets/javascript/tree-sitter-javascript.wasm"
  },
  {
    filetype: "typescript",
    aliases: ["typescriptreact"],
    queries: { highlights: ["assets/typescript/highlights.scm"] },
    wasm: "assets/typescript/tree-sitter-typescript.wasm"
  },
  {
    filetype: "markdown",
    queries: {
      highlights: ["assets/markdown/highlights.scm"],
      injections: ["assets/markdown/injections.scm"]
    },
    wasm: "assets/markdown/tree-sitter-markdown.wasm",
    injectionMapping: {
      nodeTypes: { inline: "markdown_inline", pipe_table_cell: "markdown_inline" },
      infoStringMap: {
        javascript: "javascript",
        js: "javascript",
        jsx: "javascriptreact",
        javascriptreact: "javascriptreact",
        typescript: "typescript",
        ts: "typescript",
        tsx: "typescriptreact",
        typescriptreact: "typescriptreact",
        markdown: "markdown",
        md: "markdown"
      }
    }
  },
  {
    filetype: "markdown_inline",
    queries: { highlights: ["assets/markdown_inline/highlights.scm"] },
    wasm: "assets/markdown_inline/tree-sitter-markdown_inline.wasm"
  },
  {
    filetype: "zig",
    queries: { highlights: ["assets/zig/highlights.scm"] },
    wasm: "assets/zig/tree-sitter-zig.wasm"
  }
];
var defaultParserAssetPaths = [
  ...new Set(defaultParserDescriptors.flatMap((parser) => [
    ...parser.queries.highlights,
    parser.wasm,
    ...parser.queries.injections ?? []
  ]))
];

// src/node-assets.ts
var CORE_PREFIX = "@opentui/core/";
var PARSER_WORKER_KEY = `${CORE_PREFIX}parser.worker.js`;
var TREE_SITTER_WASM_KEY = "web-tree-sitter/tree-sitter.wasm";
function getNodeAssets(target) {
  const native = getNativeAssetDescriptor(target);
  const coreRoot = resolveCoreRuntimeRoot();
  const nativeRoot = dirname(resolvePackageEntry(native.packageName));
  const assets = [
    { key: native.key, source: join2(nativeRoot, native.fileName) },
    { key: PARSER_WORKER_KEY, source: join2(coreRoot, "parser.worker.js") },
    ...defaultParserAssetPaths.map((relativePath) => ({
      key: `${CORE_PREFIX}${relativePath}`,
      source: join2(coreRoot, relativePath)
    })),
    { key: TREE_SITTER_WASM_KEY, source: resolvePackageEntry(TREE_SITTER_WASM_KEY) }
  ];
  const keys = new Set;
  for (const asset of assets) {
    validateAssetKey(asset.key);
    if (keys.has(asset.key)) {
      throw new Error(`Duplicate OpenTUI Node asset key: ${JSON.stringify(asset.key)}`);
    }
    keys.add(asset.key);
    let isFile = false;
    try {
      isFile = statSync(asset.source).isFile();
    } catch {}
    if (!isFile) {
      throw new Error(`Missing OpenTUI Node asset ${JSON.stringify(asset.key)} at ${JSON.stringify(asset.source)}`);
    }
  }
  return assets.toSorted((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
}
function resolveCoreRuntimeRoot() {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const candidates = [moduleDirectory, resolve(moduleDirectory, "../dist")];
  return candidates.find((candidate) => statIsFile(join2(candidate, "parser.worker.js"))) ?? moduleDirectory;
}
function resolvePackageEntry(specifier) {
  return fileURLToPath(import.meta.resolve(specifier));
}
function statIsFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
export {
  getNodeAssets
};

//# debugId=CA3D232D897F070364756E2164756E21
//# sourceMappingURL=node-assets.js.map
