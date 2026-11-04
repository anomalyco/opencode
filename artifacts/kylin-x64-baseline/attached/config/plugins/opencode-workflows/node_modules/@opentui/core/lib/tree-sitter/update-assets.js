#!/usr/bin/env bun
// @bun

// src/lib/tree-sitter/assets/update.ts
import { readFile as readFile2, writeFile as writeFile2, mkdir as mkdir2 } from "fs/promises";
import * as path2 from "path";

// src/lib/tree-sitter/download-utils.ts
import { mkdir, readFile, writeFile } from "fs/promises";
import * as path from "path";

class DownloadUtils {
  static hashUrl(url) {
    let hash = 0;
    for (let i = 0;i < url.length; i++) {
      const char = url.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }
  static async downloadOrLoad(source, cacheDir, cacheSubdir, fileExtension, useHashForCache = true, filetype) {
    const isUrl = source.startsWith("http://") || source.startsWith("https://");
    if (isUrl) {
      let cacheFileName;
      if (useHashForCache) {
        const hash = this.hashUrl(source);
        cacheFileName = filetype ? `${filetype}-${hash}${fileExtension}` : `${hash}${fileExtension}`;
      } else {
        cacheFileName = path.basename(source);
      }
      const cacheFile = path.join(cacheDir, cacheSubdir, cacheFileName);
      await mkdir(path.dirname(cacheFile), { recursive: true });
      try {
        const cachedContent = await readFile(cacheFile);
        if (cachedContent.byteLength > 0) {
          console.log(`Loaded from cache: ${cacheFile} (${source})`);
          return { content: cachedContent, filePath: cacheFile };
        }
      } catch (error) {}
      try {
        console.log(`Downloading from URL: ${source}`);
        const response = await fetch(source);
        if (!response.ok) {
          return { error: `Failed to fetch from ${source}: ${response.statusText}` };
        }
        const content = Buffer.from(await response.arrayBuffer());
        try {
          await writeFile(cacheFile, Buffer.from(content));
          console.log(`Cached: ${source}`);
        } catch (cacheError) {
          console.warn(`Failed to cache: ${cacheError}`);
        }
        return { content, filePath: cacheFile };
      } catch (error) {
        return { error: `Error downloading from ${source}: ${error}` };
      }
    } else {
      try {
        console.log(`Loading from local path: ${source}`);
        const content = await readFile(source);
        return { content, filePath: source };
      } catch (error) {
        return { error: `Error loading from local path ${source}: ${error}` };
      }
    }
  }
  static async downloadToPath(source, targetPath) {
    const isUrl = source.startsWith("http://") || source.startsWith("https://");
    await mkdir(path.dirname(targetPath), { recursive: true });
    if (isUrl) {
      try {
        console.log(`Downloading from URL: ${source}`);
        const response = await fetch(source);
        if (!response.ok) {
          return { error: `Failed to fetch from ${source}: ${response.statusText}` };
        }
        const content = Buffer.from(await response.arrayBuffer());
        await writeFile(targetPath, Buffer.from(content));
        console.log(`Downloaded: ${source} -> ${targetPath}`);
        return { content, filePath: targetPath };
      } catch (error) {
        return { error: `Error downloading from ${source}: ${error}` };
      }
    } else {
      try {
        console.log(`Copying from local path: ${source}`);
        const content = await readFile(source);
        await writeFile(targetPath, Buffer.from(content));
        return { content, filePath: targetPath };
      } catch (error) {
        return { error: `Error copying from local path ${source}: ${error}` };
      }
    }
  }
  static async fetchHighlightQueries(sources, cacheDir, filetype) {
    const queryPromises = sources.map((source) => this.fetchHighlightQuery(source, cacheDir, filetype));
    const queryResults = await Promise.all(queryPromises);
    const validQueries = queryResults.filter((query) => query.trim().length > 0);
    return validQueries.join(`
`);
  }
  static async fetchHighlightQuery(source, cacheDir, filetype) {
    const result = await this.downloadOrLoad(source, cacheDir, "queries", ".scm", true, filetype);
    if (result.error) {
      console.error(`Error fetching highlight query from ${source}:`, result.error);
      return "";
    }
    if (result.content) {
      return new TextDecoder().decode(result.content);
    }
    return "";
  }
}

// src/lib/tree-sitter/assets/update.ts
import { parseArgs } from "util";
import { readdir } from "fs/promises";
import { fileURLToPath } from "url";
var __filename2 = fileURLToPath(import.meta.url);
var __dirname2 = path2.dirname(__filename2);
function getDefaultOptions() {
  return {
    configPath: path2.resolve(__dirname2, "../parsers-config"),
    assetsDir: path2.resolve(__dirname2),
    outputPath: path2.resolve(__dirname2, "../default-parsers.ts")
  };
}
async function loadConfig(configPath) {
  let ext = path2.extname(configPath);
  let resolvedConfigPath = configPath;
  if (ext === "") {
    const files = await readdir(path2.dirname(configPath));
    const file = files.find((file2) => file2.startsWith(path2.basename(configPath)) && (file2.endsWith(".json") || file2.endsWith(".ts") || file2.endsWith(".js")));
    if (!file) {
      throw new Error(`No config file found for ${configPath}`);
    }
    resolvedConfigPath = path2.join(path2.dirname(configPath), file);
    ext = path2.extname(resolvedConfigPath);
  }
  if (ext === ".json") {
    const configContent = await readFile2(resolvedConfigPath, "utf-8");
    return JSON.parse(configContent);
  } else if (ext === ".ts" || ext === ".js") {
    const { default: configContent } = await import(resolvedConfigPath);
    return configContent;
  }
  throw new Error(`Unsupported config file extension: ${ext}`);
}
async function downloadLanguage(filetype, languageUrl, assetsDir, outputPath) {
  const languageDir = path2.join(assetsDir, filetype);
  const languageFilename = path2.basename(languageUrl);
  const languagePath = path2.join(languageDir, languageFilename);
  const result = await DownloadUtils.downloadToPath(languageUrl, languagePath);
  if (result.error) {
    throw new Error(`Failed to download language for ${filetype}: ${result.error}`);
  }
  return "./" + path2.relative(path2.dirname(outputPath), languagePath).replaceAll(path2.sep, "/");
}
async function downloadAndCombineQueries(filetype, queryUrls, assetsDir, outputPath, queryType, configPath) {
  const queriesDir = path2.join(assetsDir, filetype);
  const queryPath = path2.join(queriesDir, `${queryType}.scm`);
  const queryContents = [];
  for (let i = 0;i < queryUrls.length; i++) {
    const queryUrl = queryUrls[i];
    if (queryUrl.startsWith("./")) {
      console.log(`    Using local query ${i + 1}/${queryUrls.length}: ${queryUrl}`);
      try {
        const localPath = path2.resolve(path2.dirname(configPath), queryUrl);
        const content = await readFile2(localPath, "utf-8");
        if (content.trim()) {
          queryContents.push(content);
          console.log(`    \u2713 Loaded ${content.split(`
`).length} lines from local file`);
        }
      } catch (error) {
        console.warn(`Failed to read local query from ${queryUrl}: ${error}`);
        continue;
      }
    } else {
      console.log(`    Downloading query ${i + 1}/${queryUrls.length}: ${queryUrl}`);
      try {
        const response = await fetch(queryUrl);
        if (!response.ok) {
          console.warn(`Failed to download query from ${queryUrl}: ${response.statusText}`);
          continue;
        }
        const content = await response.text();
        if (content.trim()) {
          queryContents.push(`; Query from: ${queryUrl}
${content}`);
          console.log(`    \u2713 Downloaded ${content.split(`
`).length} lines`);
        }
      } catch (error) {
        console.warn(`Failed to download query from ${queryUrl}: ${error}`);
        continue;
      }
    }
  }
  const combinedContent = queryContents.join(`

`);
  await writeFile2(queryPath, combinedContent, "utf-8");
  console.log(`  Combined ${queryContents.length} queries into ${queryPath}`);
  return "./" + path2.relative(path2.dirname(outputPath), queryPath).replaceAll(path2.sep, "/");
}
async function generateDefaultParsersFile(parsers, outputPath) {
  const descriptors = parsers.map((parser) => ({
    filetype: parser.filetype,
    ...parser.aliases?.length ? { aliases: parser.aliases } : {},
    queries: {
      highlights: [toPackageRelativeAssetPath(parser.highlightsPath)],
      ...parser.injectionsPath ? { injections: [toPackageRelativeAssetPath(parser.injectionsPath)] } : {}
    },
    wasm: toPackageRelativeAssetPath(parser.languagePath),
    ...parser.injectionMapping ? { injectionMapping: parser.injectionMapping } : {}
  }));
  const assetPaths = [
    ...new Set(parsers.flatMap((parser) => [parser.highlightsPath, parser.languagePath, parser.injectionsPath].filter((assetPath) => assetPath !== undefined).map(toPackageRelativeAssetPath)))
  ];
  const isDefaultOutput = path2.resolve(outputPath) === getDefaultOptions().outputPath;
  const bundledAssetLoaderEntries = assetPaths.map((assetPath) => `  ${JSON.stringify(assetPath)}: () => import(${JSON.stringify(`./${assetPath}`)} as string, { with: { type: "file" } }),`).join(`
`);
  const parserImports = isDefaultOutput ? `import { resolveDefaultParserAsset } from "#opentui/runtime-assets"

import type { FiletypeParserOptions, InjectionMapping } from "./types.js"` : `import { resolveBundledFilePath } from "@opentui/core"
import type { FiletypeParserOptions, InjectionMapping } from "@opentui/core"`;
  const parserAssetLoaders = isDefaultOutput ? "" : `interface FileImportModule {
  readonly default: string
}

const bundledAssetLoaders: Record<string, () => Promise<FileImportModule>> = {
${bundledAssetLoaderEntries}
}

`;
  const parserAssetResolver = isDefaultOutput ? `function resolveParserAsset(relativePath: string): Promise<string> {
  return resolveDefaultParserAsset(relativePath, new URL(\`./\${relativePath}\`, import.meta.url))
}` : `function resolveParserAsset(relativePath: string): Promise<string> {
  const loadBundledFile = bundledAssetLoaders[relativePath]
  if (!loadBundledFile) {
    throw new Error(\`Unknown parser asset: \${JSON.stringify(relativePath)}\`)
  }
  return resolveBundledFilePath(
    relativePath,
    loadBundledFile,
    new URL(\`./\${relativePath}\`, import.meta.url),
    import.meta.url,
    { loadBundledFileFallback: true, useAssetRoot: false },
  )
}`;
  const parserFile = `// This file is generated by assets/update.ts - DO NOT EDIT MANUALLY
// Run 'bun assets/update.ts' to regenerate this file

${parserImports}

${parserAssetLoaders}interface DefaultParserDescriptor {
  readonly filetype: string
  readonly aliases?: readonly string[]
  readonly queries: {
    readonly highlights: readonly string[]
    readonly injections?: readonly string[]
  }
  readonly wasm: string
  readonly injectionMapping?: InjectionMapping
}

const defaultParserDescriptors: readonly DefaultParserDescriptor[] = ${JSON.stringify(descriptors, null, 2)}

export const defaultParserAssetPaths: readonly string[] = [
  ...new Set(
    defaultParserDescriptors.flatMap((parser) => [
      ...parser.queries.highlights,
      parser.wasm,
      ...(parser.queries.injections ?? []),
    ]),
  ),
]

let cachedParsers: Promise<FiletypeParserOptions[]> | undefined

export function getParsers(): Promise<FiletypeParserOptions[]> {
  cachedParsers ??= Promise.all(defaultParserDescriptors.map(resolveDefaultParser))
  return cachedParsers
}

async function resolveDefaultParser(parser: DefaultParserDescriptor): Promise<FiletypeParserOptions> {
  const queries: FiletypeParserOptions["queries"] = {
    highlights: await Promise.all(parser.queries.highlights.map(resolveParserAsset)),
  }
  if (parser.queries.injections) {
    queries.injections = await Promise.all(parser.queries.injections.map(resolveParserAsset))
  }

  return {
    filetype: parser.filetype,
    ...(parser.aliases ? { aliases: [...parser.aliases] } : {}),
    queries,
    wasm: await resolveParserAsset(parser.wasm),
    ...(parser.injectionMapping ? { injectionMapping: parser.injectionMapping } : {}),
  }
}

${parserAssetResolver}
`;
  const bunAssetFile = `// This file is generated by assets/update.ts - DO NOT EDIT MANUALLY
// Run 'bun assets/update.ts' to regenerate this file

import { resolveBundledFilePath } from "../../platform/runtime.js"

interface FileImportModule {
  readonly default: string
}

const bundledAssetLoaders: Record<string, () => Promise<FileImportModule>> = {
${bundledAssetLoaderEntries}
}

export function resolveBundledDefaultParserAsset(relativePath: string, fallbackPath: URL): Promise<string> {
  const loadBundledFile = bundledAssetLoaders[relativePath]
  if (!loadBundledFile) {
    throw new Error(\`Unknown OpenTUI default parser asset: \${JSON.stringify(relativePath)}\`)
  }
  return resolveBundledFilePath(
    \`@opentui/core/\${relativePath}\`,
    loadBundledFile,
    fallbackPath,
    import.meta.url,
  )
}
`;
  const bunAssetOutputPath = path2.join(path2.dirname(outputPath), "default-parser-assets.bun.ts");
  await mkdir2(path2.dirname(outputPath), { recursive: true });
  const writes = [writeFile2(outputPath, parserFile, "utf-8")];
  if (isDefaultOutput) {
    writes.push(writeFile2(bunAssetOutputPath, bunAssetFile, "utf-8"));
  }
  await Promise.all(writes);
  console.log(`Generated ${path2.basename(outputPath)} with ${parsers.length} parsers`);
}
function toPackageRelativeAssetPath(assetPath) {
  return assetPath.replace(/^\.\//, "");
}
async function main(options) {
  const opts = { ...getDefaultOptions(), ...options };
  try {
    console.log("Loading parsers configuration...");
    console.log(`  Config: ${opts.configPath}`);
    console.log(`  Assets Dir: ${opts.assetsDir}`);
    console.log(`  Output: ${opts.outputPath}`);
    const config = await loadConfig(opts.configPath);
    console.log(`Found ${config.parsers.length} parsers to process`);
    const generatedParsers = [];
    for (const parser of config.parsers) {
      console.log(`Processing ${parser.filetype}...`);
      console.log(`  Downloading language...`);
      const languagePath = await downloadLanguage(parser.filetype, parser.wasm, opts.assetsDir, opts.outputPath);
      console.log(`  Downloading ${parser.queries.highlights.length} highlight queries...`);
      const highlightsPath = await downloadAndCombineQueries(parser.filetype, parser.queries.highlights, opts.assetsDir, opts.outputPath, "highlights", opts.configPath);
      let injectionsPath;
      if (parser.queries.injections && parser.queries.injections.length > 0) {
        console.log(`  Downloading ${parser.queries.injections.length} injection queries...`);
        injectionsPath = await downloadAndCombineQueries(parser.filetype, parser.queries.injections, opts.assetsDir, opts.outputPath, "injections", opts.configPath);
      }
      generatedParsers.push({
        filetype: parser.filetype,
        aliases: parser.aliases,
        languagePath,
        highlightsPath,
        injectionsPath,
        injectionMapping: parser.injectionMapping
      });
      console.log(`  \u2713 Completed ${parser.filetype}`);
    }
    console.log("Generating output file...");
    await generateDefaultParsersFile(generatedParsers, opts.outputPath);
    console.log("\u2705 Update completed successfully!");
  } catch (error) {
    console.error("\u274C Update failed:", error);
    process.exit(1);
  }
}
function parseCLIArgs() {
  try {
    const { values } = parseArgs({
      args: process.argv.slice(2),
      options: {
        config: { type: "string" },
        assets: { type: "string" },
        output: { type: "string" },
        help: { type: "boolean" }
      },
      strict: true
    });
    if (values.help) {
      const command = path2.basename(Bun.argv[1] ?? "update-assets.js");
      console.log(`Usage: bun ${command} [options]

Options:
  --config <path>  Path to parsers-config.json
  --assets <path>  Directory where .wasm and .scm files will be downloaded
  --output <path>  Path where the generated TypeScript file will be written
  --help           Show this help message

Examples:
  # Use default paths (for OpenTUI core development)
  bun ${command}

  # Use custom paths (for application integration)
  bun ${command} --config ./my-parsers.json --assets ./src/parsers --output ./src/parsers.ts
`);
      process.exit(0);
    }
    const options = {};
    if (values.config)
      options.configPath = path2.resolve(values.config);
    if (values.assets)
      options.assetsDir = path2.resolve(values.assets);
    if (values.output)
      options.outputPath = path2.resolve(values.output);
    return Object.keys(options).length > 0 ? options : null;
  } catch (error) {
    console.error(`Error parsing arguments: ${error}`);
    console.log("Run with --help for usage information");
    process.exit(1);
  }
}
function runUpdateAssetsCli() {
  const cliOptions = parseCLIArgs();
  return main(cliOptions || undefined);
}
if (false) {}

// src/lib/tree-sitter/update-assets.ts
if (import.meta.main) {
  await runUpdateAssetsCli();
}
export {
  main as updateAssets,
  runUpdateAssetsCli
};

//# debugId=EC6FDBCB61B1DFC664756E2164756E21
//# sourceMappingURL=update-assets.js.map
