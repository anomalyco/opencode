#!/usr/bin/env node

// Produces a structured JSON inventory of a repository for the onboarding skill.
// Gathers file tree, manifest data, framework detection, entry points, scripts,
// existing documentation, and test infrastructure — all deterministic work that
// shouldn't burn model tokens.
//
// Usage: node inventory.mjs [--root <path>]
//
// Output: JSON to stdout

import { readdir, readFile, access } from "node:fs/promises";
import { join, basename, resolve } from "node:path";

const args = process.argv.slice(2);

function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}

const root = flag("root", process.cwd());

// ── Exclusions ────────────────────────────────────────────────────────────────

const EXCLUDED_DIRS = new Set([
  "node_modules", ".git", "vendor", "target", "dist", "build",
  "__pycache__", ".next", ".cache", ".turbo", ".nuxt", ".output",
  ".svelte-kit", ".parcel-cache", "coverage", ".pytest_cache",
  ".mypy_cache", ".tox", "venv", ".venv", "env", ".env",
  "bower_components", ".gradle", ".idea", ".vscode",
  "Pods", "DerivedData", "xcuserdata",
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function readJson(p) {
  try {
    return JSON.parse(await readFile(p, "utf-8"));
  } catch { return null; }
}

async function readText(p) {
  try { return await readFile(p, "utf-8"); } catch { return null; }
}

async function listDir(dir, { includeDotfiles = false } = {}) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    if (includeDotfiles) return entries;
    return entries.filter(e => !e.name.startsWith(".") || e.name === ".github");
  } catch { return []; }
}

async function listDirNames(dir) {
  const entries = await listDir(dir);
  return entries
    .filter(e => e.isDirectory() && !EXCLUDED_DIRS.has(e.name))
    .map(e => e.name + "/");
}

async function listFileNames(dir, opts) {
  const entries = await listDir(dir, opts);
  return entries.filter(e => e.isFile()).map(e => e.name);
}

async function globShallow(dir, extensions) {
  const files = await listFileNames(dir);
  if (!extensions) return files;
  return files.filter(f => extensions.some(ext => f.endsWith(ext)));
}

// ── Project Name ──────────────────────────────────────────────────────────────

async function detectName() {
  const pkg = await readJson(join(root, "package.json"));
  if (pkg?.name) return pkg.name;

  const cargo = await readText(join(root, "Cargo.toml"));
  if (cargo) {
    const m = cargo.match(/\[package\][\s\S]*?name\s*=\s*"([^"]+)"/);
    if (m) return m[1];
  }

  const gomod = await readText(join(root, "go.mod"));
  if (gomod) {
    const m = gomod.match(/^module\s+(.+)/m);
    if (m) {
      const parts = m[1].split("/");
      // Skip Go major-version suffix (v2, v3, etc.)
      let last = parts.pop();
      if (/^v\d+$/.test(last) && parts.length > 0) last = parts.pop();
      return last;
    }
  }

  const pyproject = await readText(join(root, "pyproject.toml"));
  if (pyproject) {
    const m = pyproject.match(/name\s*=\s*"([^"]+)"/);
    if (m) return m[1];
  }

  const gemspec = (await globShallow(root, [".gemspec"]))[0];
  if (gemspec) {
    const content = await readText(join(root, gemspec));
    if (content) {
      const m = content.match(/\.name\s*=\s*["']([^"']+)["']/);
      if (m) return m[1];
    }
  }

  return basename(resolve(root));
}

// ── Language & Framework Detection ────────────────────────────────────────────

const MANIFEST_MAP = [
  { file: "package.json", ecosystem: "Node.js" },
  { file: "tsconfig.json", ecosystem: "TypeScript" },
  { file: "go.mod", ecosystem: "Go" },
  { file: "Cargo.toml", ecosystem: "Rust" },
  { file: "Gemfile", ecosystem: "Ruby" },
  { file: "requirements.txt", ecosystem: "Python" },
  { file: "pyproject.toml", ecosystem: "Python" },
  { file: "Pipfile", ecosystem: "Python" },
  { file: "setup.py", ecosystem: "Python" },
  { file: "mix.exs", ecosystem: "Elixir" },
  { file: "composer.json", ecosystem: "PHP" },
  { file: "pubspec.yaml", ecosystem: "Dart/Flutter" },
  { file: "Package.swift", ecosystem: "Swift" },
  { file: "pom.xml", ecosystem: "Java" },
  { file: "build.gradle", ecosystem: "JVM" },
  { file: "build.gradle.kts", ecosystem: "Kotlin/JVM" },
  { file: "CMakeLists.txt", ecosystem: "C/C++" },
  { file: "Makefile", ecosystem: null }, // too generic to infer language
  { file: "deno.json", ecosystem: "Deno" },
  { file: "deno.jsonc", ecosystem: "Deno" },
];

// Layer 3: Config-file-based framework detection/confirmation.
// These config files are strong signals even when dependencies are ambiguous.
// Pattern follows Vercel's fs-detectors and Netlify's framework-info.
const CONFIG_FILE_FRAMEWORKS = [
  { file: "next.config.js", framework: "Next.js" },
  { file: "next.config.mjs", framework: "Next.js" },
  { file: "next.config.ts", framework: "Next.js" },
  { file: "nuxt.config.ts", framework: "Nuxt" },
  { file: "nuxt.config.js", framework: "Nuxt" },
  { file: "vite.config.ts", framework: "Vite" },
  { file: "vite.config.js", framework: "Vite" },
  { file: "vite.config.mts", framework: "Vite" },
  { file: "astro.config.mjs", framework: "Astro" },
  { file: "astro.config.ts", framework: "Astro" },
  { file: "svelte.config.js", framework: "SvelteKit" },
  { file: "svelte.config.ts", framework: "SvelteKit" },
  { file: "gatsby-config.js", framework: "Gatsby" },
  { file: "gatsby-config.ts", framework: "Gatsby" },
  { file: "angular.json", framework: "Angular" },
  { file: "remix.config.js", framework: "Remix" },
  { file: "remix.config.ts", framework: "Remix" },
  { file: "ember-cli-build.js", framework: "Ember" },
  { file: "quasar.config.js", framework: "Quasar" },
  { file: "ionic.config.json", framework: "Ionic" },
  { file: "electron-builder.json", framework: "Electron" },
  { file: "electron-builder.yml", framework: "Electron" },
  { file: "tauri.conf.json", framework: "Tauri" },
  { file: "expo-env.d.ts", framework: "Expo" },
  { file: "app.json", framework: null }, // too ambiguous alone
  { file: "webpack.config.js", framework: "Webpack" },
  { file: "webpack.config.ts", framework: "Webpack" },
  { file: "rollup.config.js", framework: "Rollup" },
  { file: "turbo.json", framework: "Turborepo" },
  // Python
  { file: "manage.py", framework: "Django" },
  // Ruby
  { file: "config/routes.rb", framework: "Rails" },
  { file: "config.ru", framework: "Rack" },
  // PHP
  { file: "artisan", framework: "Laravel" },
  { file: "symfony.lock", framework: "Symfony" },
  // Elixir
  { file: "config/config.exs", framework: "Phoenix" },
];

// Known frameworks detectable from package.json dependencies.
// Sourced from Vercel's frameworks.ts and Netlify's framework-info definitions.
const NODE_FRAMEWORKS = {
  // Meta-frameworks / SSR
  "next": "Next.js", "nuxt": "Nuxt", "@sveltejs/kit": "SvelteKit",
  "@remix-run/node": "Remix", "remix": "Remix", "gatsby": "Gatsby",
  "astro": "Astro", "@builder.io/qwik": "Qwik",
  "@tanstack/react-start": "TanStack Start",
  "@analogjs/platform": "Analog",
  // UI libraries
  "react": "React", "vue": "Vue", "svelte": "Svelte",
  "@angular/core": "Angular", "solid-js": "Solid",
  "preact": "Preact", "lit": "Lit",
  // Server frameworks
  "express": "Express", "fastify": "Fastify", "hono": "Hono",
  "koa": "Koa", "@nestjs/core": "NestJS", "h3": "H3",
  "nitro": "Nitro", "@elysiajs/core": "Elysia", "elysia": "Elysia",
  // Build tools
  "vite": "Vite", "esbuild": "esbuild",
  "webpack": "Webpack", "turbo": "Turborepo",
  // Desktop / Mobile
  "electron": "Electron", "tauri": "Tauri",
  "expo": "Expo", "react-native": "React Native",
  // Documentation / Static
  "vitepress": "VitePress", "vuepress": "VuePress",
  "@docusaurus/core": "Docusaurus", "@storybook/core": "Storybook",
  "11ty": "Eleventy", "@11ty/eleventy": "Eleventy",
  // E-commerce
  "@shopify/hydrogen": "Hydrogen",
};

// Exclusion rules: if these packages are present, suppress the indicated framework.
// Prevents false positives from monorepo wrappers. (Pattern from Netlify)
const NODE_FRAMEWORK_EXCLUSIONS = {
  "Next.js": ["@nrwl/next"], // Nx wrapper -- different build config
};

const NODE_TEST_FRAMEWORKS = {
  "jest": "Jest", "vitest": "Vitest", "mocha": "Mocha",
  "@playwright/test": "Playwright", "cypress": "Cypress",
  "ava": "AVA", "tap": "tap", "bun:test": "Bun test",
};

async function detectLanguagesAndFrameworks() {
  const languages = new Set();
  const frameworks = [];
  let packageManager = null;
  let testFramework = null;

  const rootFiles = await listFileNames(root);

  for (const { file, ecosystem } of MANIFEST_MAP) {
    if (rootFiles.includes(file) && ecosystem) {
      languages.add(ecosystem);
    }
  }

  // package.json deep inspection
  const pkg = await readJson(join(root, "package.json"));
  if (pkg) {
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    for (const [dep, fw] of Object.entries(NODE_FRAMEWORKS)) {
      if (allDeps[dep]) {
        // Check exclusion rules before adding
        const exclusions = NODE_FRAMEWORK_EXCLUSIONS[fw];
        if (exclusions && exclusions.some(ex => allDeps[ex])) continue;

        const ver = allDeps[dep].replace(/[\^~>=<]/g, "").split(" ")[0];
        frameworks.push(ver ? `${fw} ${ver}` : fw);
      }
    }

    for (const [dep, name] of Object.entries(NODE_TEST_FRAMEWORKS)) {
      if (allDeps[dep]) { testFramework = name; break; }
    }
  }

  // Package manager detection -- runs independently of package.json
  // so workspace roots with only a lockfile are still detected.
  if (rootFiles.includes("bun.lockb") || rootFiles.includes("bun.lock")) packageManager = "bun";
  else if (rootFiles.includes("pnpm-lock.yaml")) packageManager = "pnpm";
  else if (rootFiles.includes("yarn.lock")) packageManager = "yarn";
  else if (rootFiles.includes("package-lock.json")) packageManager = "npm";

  // Ruby framework detection
  if (languages.has("Ruby")) {
    const gemfile = await readText(join(root, "Gemfile"));
    if (gemfile) {
      if (/gem\s+['"]rails['"]/.test(gemfile)) frameworks.push("Rails");
      if (/gem\s+['"]sinatra['"]/.test(gemfile)) frameworks.push("Sinatra");
      if (/gem\s+['"]hanami['"]/.test(gemfile)) frameworks.push("Hanami");
      if (/gem\s+['"]grape['"]/.test(gemfile)) frameworks.push("Grape");
      if (/gem\s+['"]roda['"]/.test(gemfile)) frameworks.push("Roda");

      // Ruby test frameworks
      if (/gem\s+['"]rspec['"]/.test(gemfile)) testFramework = testFramework || "RSpec";
      else if (/gem\s+['"]minitest['"]/.test(gemfile)) testFramework = testFramework || "Minitest";
    }
  }

  // Python framework detection (covers deps in requirements.txt, pyproject.toml, Pipfile)
  if (languages.has("Python")) {
    const reqs = await readText(join(root, "requirements.txt"));
    const pyproject = await readText(join(root, "pyproject.toml"));
    const pipfile = await readText(join(root, "Pipfile"));
    const combined = (reqs || "") + (pyproject || "") + (pipfile || "");

    if (/\bdjango\b/i.test(combined)) frameworks.push("Django");
    if (/\bfastapi\b/i.test(combined)) frameworks.push("FastAPI");
    if (/\bflask\b/i.test(combined)) frameworks.push("Flask");
    if (/\bstarlette\b/i.test(combined)) frameworks.push("Starlette");
    if (/\bstreamlit\b/i.test(combined)) frameworks.push("Streamlit");
    if (/\bgradio\b/i.test(combined)) frameworks.push("Gradio");
    if (/\bcelery\b/i.test(combined)) frameworks.push("Celery");
    if (/\bsanic\b/i.test(combined)) frameworks.push("Sanic");
    if (/\btornado\b/i.test(combined)) frameworks.push("Tornado");

    if (/\bpytest\b/i.test(combined)) testFramework = testFramework || "pytest";
    if (rootFiles.includes("pytest.ini") || rootFiles.includes("conftest.py"))
      testFramework = testFramework || "pytest";
    if (/\bunittest\b/i.test(combined)) testFramework = testFramework || "unittest";
  }

  // Go framework detection
  if (languages.has("Go")) {
    const gomod = await readText(join(root, "go.mod"));
    if (gomod) {
      if (/github\.com\/gin-gonic\/gin/.test(gomod)) frameworks.push("Gin");
      if (/github\.com\/labstack\/echo/.test(gomod)) frameworks.push("Echo");
      if (/github\.com\/gofiber\/fiber/.test(gomod)) frameworks.push("Fiber");
      if (/github\.com\/gorilla\/mux/.test(gomod)) frameworks.push("Gorilla Mux");
      if (/github\.com\/go-chi\/chi/.test(gomod)) frameworks.push("Chi");
      if (/google\.golang\.org\/grpc/.test(gomod)) frameworks.push("gRPC");
      if (/github\.com\/bufbuild\/connect-go/.test(gomod)) frameworks.push("Connect");
    }
    testFramework = testFramework || "go test";
  }

  // Rust framework detection
  if (languages.has("Rust")) {
    const cargo = await readText(join(root, "Cargo.toml"));
    if (cargo) {
      if (/\bactix-web\b/.test(cargo)) frameworks.push("Actix Web");
      if (/\baxum\b/.test(cargo)) frameworks.push("Axum");
      if (/\brocket\b/.test(cargo)) frameworks.push("Rocket");
      if (/\bwarp\b/.test(cargo)) frameworks.push("Warp");
      if (/\btokio\b/.test(cargo)) frameworks.push("Tokio");
      if (/\btauri\b/.test(cargo)) frameworks.push("Tauri");
    }
  }

  // PHP framework detection
  if (languages.has("PHP")) {
    const composer = await readJson(join(root, "composer.json"));
    if (composer) {
      const allDeps = { ...composer.require, ...composer["require-dev"] };
      if (allDeps["laravel/framework"]) frameworks.push("Laravel");
      if (allDeps["symfony/framework-bundle"]) frameworks.push("Symfony");
      if (allDeps["slim/slim"]) frameworks.push("Slim");
      if (allDeps["phpunit/phpunit"]) testFramework = testFramework || "PHPUnit";
      if (allDeps["pestphp/pest"]) testFramework = testFramework || "Pest";
    }
  }

  // Elixir framework detection
  if (languages.has("Elixir")) {
    const mixfile = await readText(join(root, "mix.exs"));
    if (mixfile) {
      if (/:phoenix\b/.test(mixfile)) frameworks.push("Phoenix");
      if (/:plug\b/.test(mixfile)) frameworks.push("Plug");
    }
  }

  // Rust test framework
  if (languages.has("Rust")) {
    testFramework = testFramework || "cargo test";
  }

  // Fallback: infer test framework from the test script command
  if (!testFramework && pkg?.scripts?.test) {
    const testCmd = pkg.scripts.test;
    if (/\bbun\s+test\b/.test(testCmd)) testFramework = "bun test";
    else if (/\bjest\b/.test(testCmd)) testFramework = "Jest";
    else if (/\bvitest\b/.test(testCmd)) testFramework = "Vitest";
    else if (/\bmocha\b/.test(testCmd)) testFramework = "Mocha";
    else if (/\bpytest\b/.test(testCmd)) testFramework = "pytest";
    else if (/\brspec\b/.test(testCmd)) testFramework = "RSpec";
  }

  // Layer 3: Config-file-based framework confirmation/detection.
  // Catches frameworks missed by dependency scanning and confirms ambiguous cases.
  const frameworkNames = new Set(frameworks.map(f => f.split(" ")[0]));
  const uncheckedConfigs = CONFIG_FILE_FRAMEWORKS.filter(
    ({ framework }) => framework && !frameworkNames.has(framework)
  );
  const configResults = await Promise.all(
    uncheckedConfigs.map(async ({ file, framework }) => ({
      framework,
      found: await exists(join(root, file)),
    }))
  );
  for (const { framework, found } of configResults) {
    if (found && !frameworkNames.has(framework)) {
      frameworks.push(framework);
      frameworkNames.add(framework);
    }
  }

  return {
    languages: [...languages],
    frameworks,
    packageManager,
    testFramework,
  };
}

// ── Directory Structure ───────────────────────────────────────────────────────

async function getStructure() {
  const topLevel = [];
  const srcLayout = {};

  const entries = await listDir(root);
  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    if (entry.isDirectory()) {
      topLevel.push(entry.name + "/");
    } else {
      topLevel.push(entry.name);
    }
  }

  // One level deeper into common source directories
  const srcDirs = ["src", "lib", "app", "pkg", "internal", "cmd", "server", "api"];
  for (const dir of srcDirs) {
    const dirPath = join(root, dir);
    if (await exists(dirPath)) {
      const children = await listDirNames(dirPath);
      const files = await listFileNames(dirPath);
      if (children.length > 0 || files.length > 0) {
        srcLayout[dir] = {
          dirs: children,
          files: files.slice(0, 10), // cap file listing
        };
      }
    }
  }

  return { topLevel, srcLayout };
}

// ── Entry Points ──────────────────────────────────────────────────────────────

// Helper: check a batch of candidate paths, return those that exist.
async function filterExisting(candidates) {
  const results = await Promise.all(
    candidates.map(async (p) => (await exists(join(root, p))) ? p : null)
  );
  return results.filter(Boolean);
}

async function findEntryPoints(languages) {
  const langSet = new Set(languages);

  // Universal entry points — check root and src/ in one batch
  const universalCandidates = [
    "index.ts", "index.js", "index.mjs", "index.tsx", "index.jsx",
    "main.ts", "main.js", "main.mjs", "main.tsx", "main.jsx",
    "app.ts", "app.js", "app.mjs", "app.tsx", "app.jsx",
    "server.ts", "server.js", "server.mjs",
  ];

  const allCandidates = [
    ...universalCandidates,
    ...universalCandidates.map(f => `src/${f}`),
  ];

  // Language-specific candidates — add to the same batch
  if (langSet.has("Node.js") || langSet.has("TypeScript") || langSet.has("Deno")) {
    allCandidates.push(
      "app/page.tsx", "app/page.jsx", "app/layout.tsx", "app/layout.jsx",
      "src/app/page.tsx", "src/app/page.jsx", "src/app/layout.tsx", "src/app/layout.jsx",
      "pages/index.tsx", "pages/index.jsx", "pages/index.js",
      "src/pages/index.tsx", "src/pages/index.jsx",
    );
  }

  if (langSet.has("Python")) {
    allCandidates.push(
      "main.py", "app.py", "manage.py", "run.py", "wsgi.py", "asgi.py",
      "src/main.py", "src/app.py",
    );
  }

  if (langSet.has("Ruby")) {
    allCandidates.push(
      "config.ru", "config/routes.rb", "config/application.rb",
      "bin/rails", "Rakefile",
    );
  }

  if (langSet.has("Go")) {
    allCandidates.push("main.go");
  }

  if (langSet.has("Rust")) {
    allCandidates.push("src/main.rs", "src/lib.rs");
  }

  // Single parallel batch for all fixed-path candidates
  const entryPoints = await filterExisting(allCandidates);

  // Node/TS: also check package.json main/module fields
  if (langSet.has("Node.js") || langSet.has("TypeScript") || langSet.has("Deno")) {
    const pkg = await readJson(join(root, "package.json"));
    for (const field of [pkg?.main, pkg?.module]) {
      if (field && !entryPoints.includes(field) && await exists(join(root, field))) {
        entryPoints.push(field);
      }
    }
  }

  // Python: __main__.py in src subdirectories (requires listing)
  if (langSet.has("Python")) {
    const srcEntries = await listDir(join(root, "src"));
    const pyMains = await filterExisting(
      srcEntries.filter(e => e.isDirectory()).map(e => `src/${e.name}/__main__.py`)
    );
    entryPoints.push(...pyMains);
  }

  // Go: cmd/*/main.go (requires listing)
  if (langSet.has("Go")) {
    const cmdDir = join(root, "cmd");
    if (await exists(cmdDir)) {
      const cmds = await listDir(cmdDir);
      const goMains = await filterExisting(
        cmds.filter(c => c.isDirectory()).map(c => `cmd/${c.name}/main.go`)
      );
      entryPoints.push(...goMains);
    }
  }

  return [...new Set(entryPoints)];
}

// ── Scripts / Commands ────────────────────────────────────────────────────────

async function detectScripts() {
  const scripts = {};

  // package.json scripts
  const pkg = await readJson(join(root, "package.json"));
  if (pkg?.scripts) {
    const important = ["dev", "start", "build", "test", "lint", "serve",
                        "preview", "typecheck", "check", "format", "migrate"];
    for (const key of important) {
      if (pkg.scripts[key]) scripts[key] = pkg.scripts[key];
    }
    // Also include any scripts not in our list but keep it bounded
    for (const [key, val] of Object.entries(pkg.scripts)) {
      if (!scripts[key] && Object.keys(scripts).length < 15) {
        scripts[key] = val;
      }
    }
  }

  // Makefile targets -- always include alongside npm scripts for polyglot repos
  const makefile = await readText(join(root, "Makefile"));
  if (makefile) {
    const targets = makefile.match(/^([a-zA-Z_][\w-]*)\s*:/gm);
    if (targets) {
      for (const t of targets.slice(0, 15)) {
        const name = t.replace(":", "").trim();
        if (!scripts[`make ${name}`]) scripts[`make ${name}`] = "(Makefile target)";
      }
    }
  }

  // Procfile
  const procfile = await readText(join(root, "Procfile"));
  if (procfile) {
    for (const line of procfile.split("\n")) {
      const m = line.match(/^(\w+):\s*(.+)/);
      if (m) scripts[`Procfile:${m[1]}`] = m[2].trim();
    }
  }

  return scripts;
}

// ── Documentation Discovery ──────────────────────────────────────────────────

// Extract the first markdown heading from a file (cheap I/O, avoids model reads).
async function extractTitle(filePath) {
  try {
    const content = await readFile(filePath, "utf-8");
    // Match first ATX heading (# Title)
    const m = content.match(/^#{1,3}\s+(.+)/m);
    return m ? m[1].trim() : null;
  } catch { return null; }
}

async function findDocs() {
  const seen = new Set();
  const paths = [];

  function add(path) {
    if (!seen.has(path)) { seen.add(path); paths.push(path); }
  }

  // Root markdown files
  const rootFiles = await globShallow(root, [".md"]);
  for (const f of rootFiles) add(f);

  // Common doc directories — only top-level entries; subdirs are discovered
  // via the nested scan below, so no need to list nested paths like
  // "docs/solutions" here (which caused duplicates).
  const docDirs = ["docs", "doc", "documentation", "wiki", ".github"];
  for (const dir of docDirs) {
    const dirPath = join(root, dir);
    if (await exists(dirPath)) {
      const files = await globShallow(dirPath, [".md"]);
      for (const f of files.slice(0, 10)) add(`${dir}/${f}`);
      // One level deeper
      const subdirs = await listDirNames(dirPath);
      for (const sub of subdirs.slice(0, 5)) {
        const subName = sub.replace("/", "");
        const subFiles = await globShallow(join(dirPath, subName), [".md"]);
        for (const f of subFiles.slice(0, 5)) add(`${dir}/${subName}/${f}`);
      }
    }
  }

  // Extract titles in parallel so the model can triage without reading each file
  const docs = await Promise.all(
    paths.map(async (p) => {
      const title = await extractTitle(join(root, p));
      return title ? { path: p, title } : { path: p };
    })
  );

  return docs;
}

// ── Test Infrastructure ───────────────────────────────────────────────────────

async function findTestInfra() {
  const dirs = [];
  const config = [];

  // Test directories
  const testDirs = ["tests", "test", "spec", "__tests__", "e2e",
                     "integration", "src/tests", "src/test", "src/__tests__"];
  for (const dir of testDirs) {
    if (await exists(join(root, dir))) dirs.push(dir + "/");
  }

  // Test config files
  const testConfigs = [
    "jest.config.js", "jest.config.ts", "jest.config.mjs",
    "vitest.config.js", "vitest.config.ts", "vitest.config.mts",
    ".rspec", "pytest.ini", "conftest.py", "setup.cfg",
    "phpunit.xml", "karma.conf.js", "cypress.config.js", "cypress.config.ts",
    "playwright.config.js", "playwright.config.ts",
  ];
  const rootFiles = await listFileNames(root, { includeDotfiles: true });
  for (const f of testConfigs) {
    if (rootFiles.includes(f)) config.push(f);
  }

  return { dirs, config };
}

// ── Monorepo Detection ────────────────────────────────────────────────────────

async function detectMonorepo() {
  const rootFiles = await listFileNames(root);
  const signals = [];

  const pkg = await readJson(join(root, "package.json"));
  if (pkg?.workspaces) {
    signals.push("npm/yarn workspaces");
  }

  if (rootFiles.includes("pnpm-workspace.yaml")) signals.push("pnpm workspaces");
  if (rootFiles.includes("nx.json")) signals.push("Nx");
  if (rootFiles.includes("lerna.json")) signals.push("Lerna");
  if (rootFiles.includes("turbo.json")) signals.push("Turborepo");

  const cargo = await readText(join(root, "Cargo.toml"));
  if (cargo && /\[workspace\]/.test(cargo)) signals.push("Cargo workspace");

  if (signals.length === 0) {
    // Check for conventional monorepo directories
    const monoIndicators = ["apps", "packages", "services", "modules", "libs"];
    let found = 0;
    for (const dir of monoIndicators) {
      if (await exists(join(root, dir))) found++;
    }
    if (found >= 2) signals.push("convention-based (multiple top-level package dirs)");
  }

  if (signals.length === 0) return null;

  // List workspaces
  const workspaces = [];
  const wsDirs = ["apps", "packages", "services", "modules", "libs", "plugins"];
  for (const dir of wsDirs) {
    const dirPath = join(root, dir);
    if (await exists(dirPath)) {
      const children = await listDirNames(dirPath);
      for (const c of children.slice(0, 20)) {
        workspaces.push(`${dir}/${c}`);
      }
    }
  }

  return { signals, workspaces };
}

// ── Infrastructure & External Dependencies ────────────────────────────────────

async function findInfrastructure() {
  const rootFiles = await listFileNames(root, { includeDotfiles: true });
  const envFiles = [];
  const configFiles = [];
  const services = [];

  // Environment files (signal for external dependencies)
  const envCandidates = [
    ".env.example", ".env.sample", ".env.template", ".env.local.example",
    ".env.development", ".env.production",
  ];
  for (const f of envCandidates) {
    if (rootFiles.includes(f)) envFiles.push(f);
  }

  // Docker / container config (reveals databases, caches, queues)
  const dockerFiles = [
    "docker-compose.yml", "docker-compose.yaml",
    "docker-compose.dev.yml", "docker-compose.dev.yaml",
    "docker-compose.override.yml", "Dockerfile",
  ];
  for (const f of dockerFiles) {
    if (rootFiles.includes(f)) configFiles.push(f);
  }

  // Deployment / infrastructure config
  const infraFiles = [
    "fly.toml", "vercel.json", "netlify.toml", "render.yaml",
    "railway.json", "app.yaml", "serverless.yml", "sam-template.yaml",
    "Procfile", "nixpacks.toml",
  ];
  for (const f of infraFiles) {
    if (rootFiles.includes(f)) configFiles.push(f);
  }

  // Detect common services from docker-compose
  for (const dcFile of ["docker-compose.yml", "docker-compose.yaml"]) {
    const dc = await readText(join(root, dcFile));
    if (dc) {
      if (/postgres/i.test(dc)) services.push("PostgreSQL");
      if (/mysql|mariadb/i.test(dc)) services.push("MySQL");
      if (/mongo/i.test(dc)) services.push("MongoDB");
      if (/redis/i.test(dc)) services.push("Redis");
      if (/rabbitmq/i.test(dc)) services.push("RabbitMQ");
      if (/kafka/i.test(dc)) services.push("Kafka");
      if (/elasticsearch/i.test(dc)) services.push("Elasticsearch");
      if (/minio|localstack/i.test(dc)) services.push("S3-compatible storage");
      if (/mailhog|mailpit/i.test(dc)) services.push("Email (dev)");
      break;
    }
  }

  // Detect services from env example files
  for (const envFile of envFiles) {
    const content = await readText(join(root, envFile));
    if (content) {
      if (/DATABASE_URL|DB_HOST|POSTGRES/i.test(content) && !services.includes("PostgreSQL") && !services.includes("MySQL"))
        services.push("Database (see env config)");
      if (/REDIS/i.test(content) && !services.includes("Redis"))
        services.push("Redis");
      if (/STRIPE/i.test(content)) services.push("Stripe");
      if (/OPENAI|ANTHROPIC|CLAUDE/i.test(content)) services.push("AI/LLM API");
      if (/AWS_|S3_/i.test(content) && !services.includes("S3-compatible storage"))
        services.push("AWS/S3");
      if (/SENDGRID|MAILGUN|POSTMARK|RESEND/i.test(content))
        services.push("Email service");
      if (/TWILIO/i.test(content)) services.push("Twilio");
      if (/SENTRY/i.test(content)) services.push("Sentry");
      if (/AUTH0|CLERK|SUPABASE_/i.test(content)) services.push("Auth service");
      break; // Only read the first env example
    }
  }

  return {
    envFiles,
    configFiles,
    services: [...new Set(services)],
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const [
    name,
    langInfo,
    structure,
    docs,
    testInfra,
    scripts,
    monorepo,
    infrastructure,
  ] = await Promise.all([
    detectName(),
    detectLanguagesAndFrameworks(),
    getStructure(),
    findDocs(),
    findTestInfra(),
    detectScripts(),
    detectMonorepo(),
    findInfrastructure(),
  ]);

  const entryPoints = await findEntryPoints(langInfo.languages);

  const inventory = {
    name,
    languages: langInfo.languages,
    frameworks: langInfo.frameworks,
    packageManager: langInfo.packageManager,
    testFramework: langInfo.testFramework,
    monorepo,
    structure,
    entryPoints,
    scripts,
    docs,
    testInfra,
    infrastructure,
  };

  process.stdout.write(JSON.stringify(inventory) + "\n");
}

main().catch(err => {
  // Always exit 0 with valid JSON, even on error
  process.stdout.write(JSON.stringify({
    error: err.message,
    name: basename(root),
    languages: [],
    frameworks: [],
    packageManager: null,
    testFramework: null,
    monorepo: null,
    structure: { topLevel: [], srcLayout: {} },
    entryPoints: [],
    scripts: {},
    docs: [],
    testInfra: { dirs: [], config: [] },
    infrastructure: { envFiles: [], configFiles: [], services: [] },
  }) + "\n");
});
