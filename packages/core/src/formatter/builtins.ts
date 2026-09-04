import { Effect } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Npm } from "@opencode-ai/util/npm"
import { AppProcess } from "@opencode-ai/util/process"
import { which } from "../util/which.js"

export interface Info {
  readonly name: string
  readonly environment?: Record<string, string>
  readonly extensions: readonly string[]
  readonly enabled: Effect.Effect<string[] | false>
}

export function make(input: {
  readonly directory: string
  readonly worktree: string
  readonly fs: FSUtil.Interface
  readonly npm: Npm.Interface
  readonly processes: AppProcess.Interface
  readonly bin: string
}) {
  const disabled = false as const
  const findExecutable = (name: string) => which(name, undefined, input.bin)
  const findUp = (target: string) => input.fs.findUp(target, input.directory, input.worktree)
  const readText = (file: string) => input.fs.readFileString(file).pipe(Effect.orElseSucceed(() => ""))
  const commandOutput = (command: string[]) =>
    input.processes
      .run(
        ChildProcess.make(command[0], command.slice(1), {
          cwd: input.directory,
          extendEnv: true,
          stdin: "ignore",
        }),
      )
      .pipe(Effect.option)

  const gofmt = executable("gofmt", [".go"], ["-w", "$FILE"], findExecutable)

  const mix = executable(
    "mix",
    [".ex", ".exs", ".eex", ".heex", ".leex", ".neex", ".sface"],
    ["format", "$FILE"],
    findExecutable,
  )

  const prettier: Info = {
    name: "prettier",
    environment: { BUN_BE_BUN: "1" },
    extensions: [
      ".js",
      ".jsx",
      ".mjs",
      ".cjs",
      ".ts",
      ".tsx",
      ".mts",
      ".cts",
      ".html",
      ".htm",
      ".css",
      ".scss",
      ".sass",
      ".less",
      ".vue",
      ".svelte",
      ".json",
      ".jsonc",
      ".yaml",
      ".yml",
      ".toml",
      ".xml",
      ".md",
      ".mdx",
      ".graphql",
      ".gql",
    ],
    enabled: Effect.gen(function* () {
      for (const file of yield* findUp("package.json")) {
        if (!hasDependency(yield* input.fs.readJson(file), "prettier")) continue
        const bin = yield* input.npm.which("prettier")
        if (bin) return [bin, "--write", "$FILE"]
      }
      return disabled
    }).pipe(Effect.orElseSucceed(() => disabled)),
  }

  const oxfmt: Info = {
    name: "oxfmt",
    environment: { BUN_BE_BUN: "1" },
    extensions: [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"],
    enabled: Effect.gen(function* () {
      for (const file of yield* findUp("package.json")) {
        if (!hasDependency(yield* input.fs.readJson(file), "oxfmt")) continue
        const bin = yield* input.npm.which("oxfmt")
        if (bin) return [bin, "$FILE"]
      }
      return disabled
    }).pipe(Effect.orElseSucceed(() => disabled)),
  }

  const biome: Info = {
    name: "biome",
    environment: { BUN_BE_BUN: "1" },
    extensions: [
      ".js",
      ".jsx",
      ".mjs",
      ".cjs",
      ".ts",
      ".tsx",
      ".mts",
      ".cts",
      ".html",
      ".htm",
      ".css",
      ".scss",
      ".sass",
      ".less",
      ".vue",
      ".svelte",
      ".json",
      ".jsonc",
      ".yaml",
      ".yml",
      ".toml",
      ".xml",
      ".md",
      ".mdx",
      ".graphql",
      ".gql",
    ],
    enabled: Effect.gen(function* () {
      const found = yield* Effect.forEach(["biome.json", "biome.jsonc"], findUp, { concurrency: "unbounded" })
      if (!found.some((items) => items.length > 0)) return disabled
      const bin = yield* input.npm.which("@biomejs/biome")
      return bin ? [bin, "format", "--write", "$FILE"] : disabled
    }).pipe(Effect.orElseSucceed(() => disabled)),
  }

  const zig = executable("zig", [".zig", ".zon"], ["fmt", "$FILE"], findExecutable)

  const clang: Info = {
    name: "clang-format",
    extensions: [".c", ".cc", ".cpp", ".cxx", ".c++", ".h", ".hh", ".hpp", ".hxx", ".h++", ".ino", ".C", ".H"],
    enabled: Effect.gen(function* () {
      if (!(yield* findUp(".clang-format")).length) return disabled
      const match = findExecutable("clang-format")
      return match ? [match, "-i", "$FILE"] : disabled
    }).pipe(Effect.orElseSucceed(() => disabled)),
  }

  const ktlint = executable("ktlint", [".kt", ".kts"], ["-F", "$FILE"], findExecutable)

  const ruff: Info = {
    name: "ruff",
    extensions: [".py", ".pyi"],
    enabled: Effect.gen(function* () {
      const bin = findExecutable("ruff")
      if (!bin) return disabled
      for (const config of ["pyproject.toml", "ruff.toml", ".ruff.toml"]) {
        const found = yield* findUp(config)
        if (!found.length) continue
        if (config !== "pyproject.toml" || (yield* readText(found[0])).includes("[tool.ruff]")) {
          return [bin, "format", "$FILE"]
        }
      }
      for (const dependency of ["requirements.txt", "pyproject.toml", "Pipfile"]) {
        const found = yield* findUp(dependency)
        if (found.length && (yield* readText(found[0])).includes("ruff")) return [bin, "format", "$FILE"]
      }
      return disabled
    }).pipe(Effect.orElseSucceed(() => disabled)),
  }

  const air: Info = {
    name: "air",
    extensions: [".R"],
    enabled: Effect.gen(function* () {
      const bin = findExecutable("air")
      if (!bin) return disabled
      const output = yield* commandOutput([bin, "--help"])
      if (output._tag === "None" || output.value.exitCode !== 0) return disabled
      const first = output.value.stdout.toString("utf8").split("\n")[0]
      return first.includes("R language") && first.includes("formatter") ? [bin, "format", "$FILE"] : disabled
    }),
  }

  const uv: Info = {
    name: "uv",
    extensions: [".py", ".pyi"],
    enabled: Effect.gen(function* () {
      const bin = findExecutable("uv")
      if (!bin) return disabled
      const output = yield* commandOutput([bin, "format", "--help"])
      return output._tag === "Some" && output.value.exitCode === 0 ? [bin, "format", "--", "$FILE"] : disabled
    }),
  }

  const rubocop = executable("rubocop", [".rb", ".rake", ".gemspec", ".ru"], ["--autocorrect", "$FILE"], findExecutable)
  const standardrb = executable("standardrb", [".rb", ".rake", ".gemspec", ".ru"], ["--fix", "$FILE"], findExecutable)
  const htmlbeautifier = executable("htmlbeautifier", [".erb", ".html.erb"], ["$FILE"], findExecutable)
  const dart = executable("dart", [".dart"], ["format", "$FILE"], findExecutable)

  const ocamlformat: Info = {
    name: "ocamlformat",
    extensions: [".ml", ".mli"],
    enabled: Effect.gen(function* () {
      if (!(yield* findUp(".ocamlformat")).length) return disabled
      const match = findExecutable("ocamlformat")
      return match ? [match, "-i", "$FILE"] : disabled
    }).pipe(Effect.orElseSucceed(() => disabled)),
  }

  const terraform = executable("terraform", [".tf", ".tfvars"], ["fmt", "$FILE"], findExecutable)
  const latexindent = executable("latexindent", [".tex"], ["-w", "-s", "$FILE"], findExecutable)
  const gleam = executable("gleam", [".gleam"], ["format", "$FILE"], findExecutable)
  const shfmt = executable("shfmt", [".sh", ".bash"], ["-w", "$FILE"], findExecutable)
  const nixfmt = executable("nixfmt", [".nix"], ["$FILE"], findExecutable)
  const rustfmt = executable("rustfmt", [".rs"], ["$FILE"], findExecutable)

  const pint: Info = {
    name: "pint",
    extensions: [".php"],
    enabled: Effect.gen(function* () {
      for (const file of yield* findUp("composer.json")) {
        const json = yield* input.fs.readJson(file)
        if (hasRecordKey(json, "require", "laravel/pint") || hasRecordKey(json, "require-dev", "laravel/pint")) {
          return ["./vendor/bin/pint", "$FILE"]
        }
      }
      return disabled
    }).pipe(Effect.orElseSucceed(() => disabled)),
  }

  const ormolu = executable("ormolu", [".hs"], ["-i", "$FILE"], findExecutable)
  const cljfmt = executable("cljfmt", [".clj", ".cljs", ".cljc", ".edn"], ["fix", "--quiet", "$FILE"], findExecutable)
  const dfmt = executable("dfmt", [".d"], ["-i", "$FILE"], findExecutable)

  return [
    gofmt,
    mix,
    oxfmt,
    prettier,
    biome,
    zig,
    clang,
    ktlint,
    ruff,
    air,
    uv,
    rubocop,
    standardrb,
    htmlbeautifier,
    dart,
    ocamlformat,
    terraform,
    latexindent,
    gleam,
    shfmt,
    nixfmt,
    rustfmt,
    pint,
    ormolu,
    cljfmt,
    dfmt,
  ] satisfies Info[]
}

function executable(
  name: string,
  extensions: readonly string[],
  args: string[],
  findExecutable: (name: string) => string | null,
): Info {
  return {
    name,
    extensions,
    enabled: Effect.sync(() => {
      const match = findExecutable(name)
      return match ? [match, ...args] : false
    }),
  }
}

function hasDependency(input: unknown, dependency: string) {
  return hasRecordKey(input, "dependencies", dependency) || hasRecordKey(input, "devDependencies", dependency)
}

function hasRecordKey(input: unknown, field: string, key: string) {
  if (!isRecord(input)) return false
  return isRecord(input[field]) && key in input[field]
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return Boolean(input && typeof input === "object" && !Array.isArray(input))
}
