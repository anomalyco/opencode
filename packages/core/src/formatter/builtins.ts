import { Effect } from "effect"
import { isRecord } from "@opencode/util/record"
import { FSUtil } from "@opencode/util/fs-util"
import { Npm } from "@opencode/util/npm"
import { AppProcess } from "@opencode/util/process"
import { which } from "../util/which.js"
import type { EnvironmentFiles } from "../environment/files.js"
import type { Sandbox } from "../sandbox.js"
import { FormatterDiscovery } from "./discovery.js"
import { FormatterProcess } from "./process.js"

export interface Info {
  readonly name: string
  readonly environment?: Record<string, string>
  readonly extensions: readonly string[]
  readonly enabled: Effect.Effect<string[] | false>
}

export function make(input: {
  readonly directory: string
  readonly worktree: string
  readonly fs: Pick<FSUtil.Interface, "findUp" | "readFileString" | "readJson">
  readonly npm: Pick<Npm.Interface, "which">
  readonly processes: AppProcess.Interface
  readonly bin: string
  readonly sandbox: Sandbox.Interface
  readonly files: EnvironmentFiles.Files
}) {
  const disabled = false as const
  const discovery = input.sandbox.enabled
    ? FormatterDiscovery.confined(input.files, input.directory, input.worktree, input.bin)
    : undefined
  const findExecutable = (name: string) =>
    discovery ? discovery.findExecutable(name) : Effect.sync(() => which(name, undefined, input.bin))
  const findUp = (target: string) =>
    discovery ? discovery.findUp(target) : input.fs.findUp(target, input.directory, input.worktree)
  const readJson = Effect.fnUntraced(function* (file: string) {
    return discovery ? yield* discovery.readJson(file) : yield* input.fs.readJson(file)
  })
  const packageBinary = (pkg: string) => (discovery ? discovery.packageBinary(pkg) : input.npm.which(pkg))
  const readText = Effect.fnUntraced(
    function* (file: string) {
      return discovery ? yield* discovery.readFileString(file) : yield* input.fs.readFileString(file)
    },
    Effect.orElseSucceed(() => ""),
  )
  const commandOutput = (command: string[]) =>
    FormatterProcess.run({
      processes: input.processes,
      sandbox: input.sandbox,
      directory: input.directory,
      command,
    }).pipe(Effect.option)

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
        if (!hasDependency(yield* readJson(file), "prettier")) continue
        const bin = yield* packageBinary("prettier")
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
        if (!hasDependency(yield* readJson(file), "oxfmt")) continue
        const bin = yield* packageBinary("oxfmt")
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
      const bin = yield* packageBinary("@biomejs/biome")
      return bin ? [bin, "format", "--write", "$FILE"] : disabled
    }).pipe(Effect.orElseSucceed(() => disabled)),
  }

  const zig = executable("zig", [".zig", ".zon"], ["fmt", "$FILE"], findExecutable)

  const clang: Info = {
    name: "clang-format",
    extensions: [".c", ".cc", ".cpp", ".cxx", ".c++", ".h", ".hh", ".hpp", ".hxx", ".h++", ".ino", ".C", ".H"],
    enabled: Effect.gen(function* () {
      if (!(yield* findUp(".clang-format")).length) return disabled
      const match = yield* findExecutable("clang-format")
      return match ? [match, "-i", "$FILE"] : disabled
    }).pipe(Effect.orElseSucceed(() => disabled)),
  }

  const ktlint = executable("ktlint", [".kt", ".kts"], ["-F", "$FILE"], findExecutable)

  const ruff: Info = {
    name: "ruff",
    extensions: [".py", ".pyi"],
    enabled: Effect.gen(function* () {
      const bin = yield* findExecutable("ruff")
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
      const bin = yield* findExecutable("air")
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
      const bin = yield* findExecutable("uv")
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
      const match = yield* findExecutable("ocamlformat")
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
        const json = yield* readJson(file)
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
  findExecutable: (name: string) => Effect.Effect<string | null>,
): Info {
  return {
    name,
    extensions,
    enabled: Effect.gen(function* () {
      const match = yield* findExecutable(name)
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
