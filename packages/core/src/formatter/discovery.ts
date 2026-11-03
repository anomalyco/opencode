import path from "node:path"
import { Effect, Schema } from "effect"
import { EnvironmentFiles } from "../environment/files.js"

/** Confined discovery never installs packages or opens files through host filesystem services. */
export function confined(files: EnvironmentFiles.Files, directory: string, worktree: string, bin: string) {
  const exists = (target: string) => EnvironmentFiles.exists(files, target).pipe(Effect.orElseSucceed(() => false))
  const readFileString = (target: string) =>
    files.read(target).pipe(Effect.map((result) => new TextDecoder().decode(result.bytes)))
  const readJson = (target: string) =>
    readFileString(target).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))))
  const directories: string[] = []
  for (let current = path.resolve(directory); ; current = path.dirname(current)) {
    directories.push(current)
    if (current === path.resolve(worktree) || path.dirname(current) === current) break
  }
  const findUp = (target: string) =>
    Effect.forEach(directories, (current) => {
      const file = path.join(current, target)
      return exists(file).pipe(Effect.map((found) => (found ? [file] : [])))
    }).pipe(Effect.map((found) => found.flat()))
  const findExecutable = (name: string) =>
    Effect.gen(function* () {
      const paths = [...(process.env.PATH ?? "").split(path.delimiter), bin]
      for (const entry of paths) {
        const target = path.resolve(directory, entry, name)
        const kind = yield* EnvironmentFiles.typeFollowing(files, target).pipe(Effect.option)
        if (kind._tag === "Some" && kind.value === "file") return target
      }
      return null
    })
  const packageBinary = (pkg: string) => {
    const name = pkg === "@biomejs/biome" ? "biome" : pkg
    return Effect.gen(function* () {
      for (const current of directories) {
        const target = path.join(current, "node_modules", ".bin", name)
        if (yield* exists(target)) return target
      }
      return undefined
    })
  }
  return { findUp, readFileString, readJson, findExecutable, packageBinary }
}

export * as FormatterDiscovery from "./discovery.js"
