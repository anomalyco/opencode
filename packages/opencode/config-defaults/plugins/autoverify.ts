/**
 * autoverify: autonomous, multi-language project verification after code edits.
 *
 * After any edit-class tool it runs (non-blocking, background, debounced,
 * concurrency-capped) every check applicable to the project and appends concise
 * cached results to the tool output. It detects the ecosystem by manifest/config
 * files, and only runs an external tool when the project is configured for it
 * (a script, a manifest, or a test/spec directory) so it does not spam false
 * "command not found" failures.
 *
 * Each ecosystem registers up to three real checks: typecheck/build, lint, and
 * test (the actual test runner of that ecosystem). Per-file import/syntax/type
 * errors are already surfaced instantly by the LSP.
 */
import type { Plugin } from "@opencode-ai/plugin"
import { existsSync, readFileSync, readdirSync } from "fs"
import { join } from "path"
import { spawn } from "child_process"

const EDIT_TOOLS = new Set([
  "edit", "write", "multiedit", "patch_apply", "bulk_edit", "notebook_edit", "apply_patch",
])

const DEBOUNCE_MS = 8000
const MAX_AGE_S = 240
const MAX_CONCURRENT = 3

type Job = { key: string; label: string; cmd: string; timeout: number }
type St = { result: string | null; runAt: number; running: boolean }
const state = new Map<string, St>()

function getSt(key: string): St {
  let s = state.get(key)
  if (!s) {
    s = { result: null, runAt: 0, running: false }
    state.set(key, s)
  }
  return s
}

function readPkg(dir: string): any | null {
  try {
    return JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))
  } catch {
    return null
  }
}
function readText(dir: string, file: string): string {
  try {
    return readFileSync(join(dir, file), "utf8")
  } catch {
    return ""
  }
}
function entries(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}
function has(dir: string, ...files: string[]): boolean {
  return files.some((f) => existsSync(join(dir, f)))
}
function subdir(dir: string, ...names: string[]): boolean {
  return names.some((n) => existsSync(join(dir, n)))
}
function detectPm(dir: string): string {
  if (has(dir, "bun.lock", "bun.lockb")) return "bun"
  if (has(dir, "pnpm-lock.yaml")) return "pnpm"
  if (has(dir, "yarn.lock")) return "yarn"
  return "npm"
}
function dep(pkg: any, name: string): boolean {
  return Boolean(pkg?.dependencies?.[name] || pkg?.devDependencies?.[name])
}

const FAST = 90000
const SLOW = 180000
const VSLOW = 300000

function buildJobs(dir: string): Job[] {
  const jobs: Job[] = []
  const add = (key: string, label: string, cmd: string, timeout = FAST) =>
    jobs.push({ key, label, cmd, timeout })
  const list = entries(dir)
  const hasExt = (ext: string) => list.some((f) => f.toLowerCase().endsWith(ext))

  // ---- JS / TS / web frameworks ----
  const pkg = readPkg(dir)
  if (pkg) {
    const pm = detectPm(dir)
    const s = pkg.scripts ?? {}
    if (typeof s.typecheck === "string") add("js:typecheck", "typecheck", pm + " run typecheck")
    else if (typeof s.check === "string") add("js:typecheck", "typecheck", pm + " run check")
    else if (dep(pkg, "astro")) add("js:typecheck", "astro check", "npx --no-install astro check")
    else if (has(dir, "tsconfig.json")) add("js:typecheck", "tsc", "npx --no-install tsc --noEmit")
    if (typeof s.lint === "string") add("js:lint", "lint", pm + " run lint")
    else if (has(dir, "biome.json", "biome.jsonc")) add("js:lint", "biome", "npx --no-install biome check .")
    else if (has(dir, ".eslintrc", ".eslintrc.json", ".eslintrc.js", ".eslintrc.cjs", ".eslintrc.yml", "eslint.config.js", "eslint.config.mjs", "eslint.config.cjs", "eslint.config.ts"))
      add("js:lint", "eslint", "npx --no-install eslint .")
    else if (has(dir, ".oxlintrc.json")) add("js:lint", "oxlint", "npx --no-install oxlint")
    if (has(dir, ".stylelintrc", ".stylelintrc.json", ".stylelintrc.js", "stylelint.config.js", "stylelint.config.cjs"))
      add("css:lint", "stylelint", "npx --no-install stylelint \"**/*.{css,scss,sass}\"")
    if (typeof s.test === "string") add("js:test", "test", pm + " run test", SLOW)
    else if (dep(pkg, "vitest")) add("js:test", "vitest", "npx --no-install vitest run", SLOW)
    else if (dep(pkg, "jest")) add("js:test", "jest", "npx --no-install jest", SLOW)
  }

  // ---- Python ----
  if (has(dir, "pyproject.toml", "requirements.txt", "setup.py", "setup.cfg", "Pipfile") || hasExt(".py")) {
    const pyproject = readText(dir, "pyproject.toml")
    if (has(dir, "ruff.toml", ".ruff.toml") || /\[tool\.ruff\]/.test(pyproject)) add("py:lint", "ruff", "ruff check .")
    else if (has(dir, ".flake8") || /\[flake8\]/.test(readText(dir, "setup.cfg"))) add("py:lint", "flake8", "flake8")
    else if (has(dir, ".pylintrc")) add("py:lint", "pylint", "pylint .")
    if (has(dir, "mypy.ini", ".mypy.ini") || /\[tool\.mypy\]/.test(pyproject) || /\[mypy\]/.test(readText(dir, "setup.cfg")))
      add("py:typecheck", "mypy", "mypy .")
    else if (has(dir, "pyrightconfig.json") || /\[tool\.pyright\]/.test(pyproject)) add("py:typecheck", "pyright", "pyright")
    if (has(dir, "pytest.ini", "tox.ini") || /\[tool\.pytest/.test(pyproject) || subdir(dir, "tests"))
      add("py:test", "pytest", "pytest -q", SLOW)
  }

  // ---- Go ----
  if (has(dir, "go.mod")) {
    add("go:typecheck", "go build", "go build ./...")
    add("go:lint", "go vet", "go vet ./...")
    add("go:test", "go test", "go test ./...", SLOW)
  }

  // ---- Rust ----
  if (has(dir, "Cargo.toml")) {
    add("rs:typecheck", "cargo check", "cargo check --quiet", SLOW)
    if (has(dir, "clippy.toml", ".clippy.toml")) add("rs:lint", "clippy", "cargo clippy --quiet", SLOW)
    add("rs:test", "cargo test", "cargo test --quiet", SLOW)
  }

  // ---- Ruby ----
  if (has(dir, "Gemfile")) {
    if (has(dir, ".rubocop.yml")) add("rb:lint", "rubocop", "bundle exec rubocop")
    if (subdir(dir, "spec")) add("rb:test", "rspec", "bundle exec rspec", SLOW)
    else if (subdir(dir, "test")) add("rb:test", "rake test", "bundle exec rake test", SLOW)
  }

  // ---- PHP ----
  if (has(dir, "composer.json")) {
    if (has(dir, "phpstan.neon", "phpstan.neon.dist")) add("php:typecheck", "phpstan", "phpstan analyse")
    else if (has(dir, "psalm.xml", "psalm.xml.dist")) add("php:typecheck", "psalm", "psalm")
    if (has(dir, "phpunit.xml", "phpunit.xml.dist")) add("php:test", "phpunit", "phpunit", SLOW)
    else if (has(dir, "Pest.php") || subdir(dir, "tests")) add("php:test", "pest", "./vendor/bin/pest", SLOW)
  }

  // ---- .NET (C#, F#, VB) ----
  if (hasExt(".csproj") || hasExt(".sln") || hasExt(".fsproj") || hasExt(".vbproj")) {
    add("net:typecheck", "dotnet build", "dotnet build --nologo", SLOW)
    add("net:test", "dotnet test", "dotnet test --nologo", SLOW)
  }

  // ---- Java / Kotlin / Groovy (Maven / Gradle) ----
  if (has(dir, "pom.xml")) {
    add("mvn:typecheck", "mvn compile", "mvn -q -DskipTests compile", SLOW)
    add("mvn:test", "mvn test", "mvn -q test", VSLOW)
  } else if (has(dir, "build.gradle", "build.gradle.kts")) {
    const gw = has(dir, "gradlew", "gradlew.bat")
    const g = gw ? (process.platform === "win32" ? "gradlew.bat" : "./gradlew") : "gradle"
    add("gradle:typecheck", "gradle compile", g + " -q compileJava compileKotlin", SLOW)
    add("gradle:test", "gradle test", g + " -q test", VSLOW)
  }

  // ---- Elixir ----
  if (has(dir, "mix.exs")) {
    add("ex:typecheck", "mix compile", "mix compile --warnings-as-errors")
    if (has(dir, ".credo.exs") || subdir(dir, "config")) add("ex:lint", "credo", "mix credo --strict")
    add("ex:test", "mix test", "mix test", SLOW)
  }

  // ---- Erlang ----
  if (has(dir, "rebar.config")) {
    add("erl:typecheck", "rebar3 compile", "rebar3 compile", SLOW)
    add("erl:test", "rebar3 eunit", "rebar3 eunit", SLOW)
  }

  // ---- Gleam ----
  if (has(dir, "gleam.toml")) {
    add("gleam:typecheck", "gleam check", "gleam check")
    add("gleam:test", "gleam test", "gleam test", SLOW)
  }

  // ---- Dart / Flutter ----
  if (has(dir, "pubspec.yaml")) {
    const flutter = /flutter\s*:/.test(readText(dir, "pubspec.yaml"))
    add("dart:typecheck", flutter ? "flutter analyze" : "dart analyze", flutter ? "flutter analyze" : "dart analyze")
    add("dart:test", flutter ? "flutter test" : "dart test", flutter ? "flutter test" : "dart test", SLOW)
  }

  // ---- Swift ----
  if (has(dir, "Package.swift")) {
    add("swift:typecheck", "swift build", "swift build", SLOW)
    add("swift:test", "swift test", "swift test", SLOW)
  }

  // ---- Zig ----
  if (has(dir, "build.zig")) {
    add("zig:typecheck", "zig build", "zig build")
    add("zig:test", "zig build test", "zig build test", SLOW)
  }

  // ---- Scala ----
  if (has(dir, "build.sbt")) {
    add("scala:typecheck", "sbt compile", "sbt -batch compile", SLOW)
    add("scala:test", "sbt test", "sbt -batch test", VSLOW)
  }

  // ---- C / C++ ----
  if (has(dir, "CMakeLists.txt")) {
    if (subdir(dir, "build")) {
      add("cpp:build", "cmake build", "cmake --build build", SLOW)
      add("cpp:test", "ctest", "ctest --test-dir build --output-on-failure", SLOW)
    }
  } else if (has(dir, "meson.build")) {
    if (subdir(dir, "build", "builddir")) add("cpp:test", "meson test", "meson test -C build", SLOW)
  } else if (has(dir, "xmake.lua")) {
    add("cpp:build", "xmake", "xmake", SLOW)
    add("cpp:test", "xmake test", "xmake test", SLOW)
  } else if (has(dir, "Makefile", "makefile")) {
    const mk = readText(dir, "Makefile") + readText(dir, "makefile")
    if (/^test:/m.test(mk)) add("make:test", "make test", "make test", SLOW)
    if (/^check:/m.test(mk)) add("make:check", "make check", "make check", SLOW)
  }

  // ---- Bazel ----
  if (has(dir, "WORKSPACE", "WORKSPACE.bazel", "MODULE.bazel")) {
    add("bazel:build", "bazel build", "bazel build //...", VSLOW)
    add("bazel:test", "bazel test", "bazel test //...", VSLOW)
  }

  // ---- Haskell ----
  if (has(dir, "stack.yaml")) {
    add("hs:build", "stack build", "stack build", SLOW)
    add("hs:test", "stack test", "stack test", VSLOW)
  } else if (hasExt(".cabal")) {
    add("hs:build", "cabal build", "cabal build", SLOW)
    add("hs:test", "cabal test", "cabal test", VSLOW)
  }

  // ---- OCaml ----
  if (has(dir, "dune-project")) {
    add("ml:build", "dune build", "dune build", SLOW)
    add("ml:test", "dune test", "dune runtest", SLOW)
  }

  // ---- F# (standalone) ----
  if (has(dir, "paket.dependencies") && hasExt(".fsx")) add("fsharp:run", "dotnet fsi", "dotnet build --nologo", SLOW)

  // ---- Clojure ----
  if (has(dir, "project.clj")) add("clj:test", "lein test", "lein test", SLOW)
  else if (has(dir, "deps.edn") && subdir(dir, "test")) add("clj:test", "clojure test", "clojure -M:test", SLOW)

  // ---- Crystal ----
  if (has(dir, "shard.yml")) {
    add("cr:typecheck", "crystal build", "crystal build --no-codegen src/*.cr", SLOW)
    if (subdir(dir, "spec")) add("cr:test", "crystal spec", "crystal spec", SLOW)
  }

  // ---- Nim ----
  if (hasExt(".nimble")) add("nim:test", "nimble test", "nimble test", SLOW)

  // ---- Julia ----
  if (has(dir, "Project.toml") && subdir(dir, "src") && subdir(dir, "test"))
    add("jl:test", "julia test", "julia --project=. -e \"using Pkg; Pkg.test()\"", VSLOW)

  // ---- R ----
  if (has(dir, "DESCRIPTION") && subdir(dir, "R")) {
    if (subdir(dir, "tests")) add("r:test", "testthat", "Rscript -e \"devtools::test()\"", SLOW)
    else add("r:check", "R CMD check", "Rscript -e \"devtools::check()\"", VSLOW)
  }

  // ---- Lua ----
  if (has(dir, ".luacheckrc")) add("lua:lint", "luacheck", "luacheck .")
  if (has(dir, ".busted") || subdir(dir, "spec")) {
    if (hasExt(".lua") || has(dir, ".luacheckrc", ".busted")) add("lua:test", "busted", "busted", SLOW)
  }

  // ---- Perl ----
  if (has(dir, "cpanfile", "Makefile.PL", "dist.ini") && subdir(dir, "t"))
    add("pl:test", "prove", "prove -l t", SLOW)

  // ---- Raku (Perl 6) ----
  if (has(dir, "META6.json") && subdir(dir, "t")) add("raku:test", "raku prove6", "prove6 -l t", SLOW)

  // ---- D ----
  if (has(dir, "dub.json", "dub.sdl")) {
    add("d:build", "dub build", "dub build", SLOW)
    add("d:test", "dub test", "dub test", SLOW)
  }

  // ---- V ----
  if (has(dir, "v.mod")) {
    add("v:typecheck", "v -check", "v -check .", FAST)
    add("v:test", "v test", "v test .", SLOW)
  }

  // ---- Nim already above; Haxe ----
  if (hasExt(".hxml")) {
    const hxml = list.find((f) => f.toLowerCase().endsWith(".hxml"))
    if (hxml) add("haxe:build", "haxe", "haxe " + hxml, SLOW)
  }

  // ---- Fortran (fpm) ----
  if (has(dir, "fpm.toml")) {
    add("fortran:build", "fpm build", "fpm build", SLOW)
    add("fortran:test", "fpm test", "fpm test", SLOW)
  }

  // ---- Ada (Alire) ----
  if (has(dir, "alire.toml")) {
    add("ada:build", "alr build", "alr build", SLOW)
    add("ada:test", "alr test", "alr test", SLOW)
  }

  // ---- Terraform / OpenTofu ----
  if (hasExt(".tf")) {
    add("tf:validate", "terraform validate", "terraform validate")
    if (list.some((f) => f.toLowerCase().endsWith(".tftest.hcl"))) add("tf:test", "terraform test", "terraform test", SLOW)
  }

  // ---- Solidity ----
  if (has(dir, "foundry.toml")) add("sol:test", "forge test", "forge test", SLOW)
  else if (has(dir, "hardhat.config.js", "hardhat.config.ts")) add("sol:test", "hardhat test", "npx --no-install hardhat test", SLOW)

  // ---- Protobuf ----
  if (has(dir, "buf.yaml", "buf.yml")) add("proto:lint", "buf lint", "buf lint")

  // ---- Shell ----
  if (hasExt(".sh")) {
    add("sh:lint", "shellcheck", "shellcheck *.sh")
    if (subdir(dir, "test", "tests") && (hasExt(".bats"))) add("sh:test", "bats", "bats test", SLOW)
  }

  // ---- Docker ----
  if (has(dir, "Dockerfile") && has(dir, ".hadolint.yaml", ".hadolint.yml")) add("docker:lint", "hadolint", "hadolint Dockerfile")

  // ---- Markdown ----
  if (has(dir, ".markdownlint.json", ".markdownlint.yaml", ".markdownlint.yml", ".markdownlintrc"))
    add("md:lint", "markdownlint", "npx --no-install markdownlint .")

  // ---- Svelte / Vue (TS supersets) ----
  if (pkg && dep(pkg, "svelte") && has(dir, "tsconfig.json")) add("svelte:check", "svelte-check", "npx --no-install svelte-check")
  if (pkg && (dep(pkg, "vue-tsc") || dep(pkg, "vue")) && has(dir, "tsconfig.json"))
    add("vue:check", "vue-tsc", "npx --no-install vue-tsc --noEmit")

  return jobs
}

function runCommand(commandStr: string, cwd: string, timeoutMs: number): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(commandStr, { cwd, shell: true, windowsHide: true })
    let out = ""
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {}
      resolve({ code: 124, out: out + "\n[timed out]" })
    }, timeoutMs)
    child.stdout?.on("data", (d) => (out += d.toString()))
    child.stderr?.on("data", (d) => (out += d.toString()))
    child.on("error", (e) => {
      clearTimeout(timer)
      resolve({ code: 1, out: out + "\n" + String(e) })
    })
    child.on("close", (c) => {
      clearTimeout(timer)
      resolve({ code: c ?? 0, out })
    })
  })
}

function summarize(label: string, code: number, out: string): string {
  if (code === 0) return label + ": PASS"
  if (code === 124) return label + ": TIMED OUT"
  // A missing toolchain should be silent rather than reported as a project failure.
  if (/command not found|is not recognized|no such file|ENOENT|not installed/i.test(out))
    return label + ": SKIPPED (toolchain unavailable)"
  const lines = out
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => /error|fail|✗|✘|cannot find|is not defined|unexpected|warning:/i.test(l))
    .slice(0, 20)
  const body = lines.join("\n") || out.split("\n").filter(Boolean).slice(-20).join("\n")
  return label + ": FAIL (exit " + code + ")\n" + body
}

export default (async ({ directory }) => {
  async function run(job: Job) {
    const st = getSt(job.key)
    st.running = true
    try {
      const res = await runCommand(job.cmd, directory, job.timeout)
      const summary = summarize(job.label, res.code, res.out)
      st.result = summary.endsWith("SKIPPED (toolchain unavailable)") ? null : summary
    } catch {
      st.result = null
    } finally {
      st.running = false
      st.runAt = Date.now()
    }
  }

  return {
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string; args: any },
      output: { title: string; output: string; metadata: any },
    ) => {
      if (!EDIT_TOOLS.has(input.tool)) return
      const jobs = buildJobs(directory)
      if (jobs.length === 0) return

      const blocks: string[] = []
      let runningCount = 0
      for (const job of jobs) if (getSt(job.key).running) runningCount++

      for (const job of jobs) {
        const st = getSt(job.key)
        const ageS = Math.round((Date.now() - st.runAt) / 1000)
        if (st.result && ageS <= MAX_AGE_S) blocks.push("[" + ageS + "s] " + st.result)
        if (!st.running && Date.now() - st.runAt > DEBOUNCE_MS && runningCount < MAX_CONCURRENT) {
          runningCount++
          void run(job)
        }
      }

      if (blocks.length > 0) {
        output.output = output.output + "\n\n<project_checks>\n" + blocks.join("\n\n") + "\n</project_checks>"
      }
    },
  }
}) satisfies Plugin
