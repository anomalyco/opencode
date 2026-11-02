import path from "node:path"
import { Effect, Schema } from "effect"
import { EnvironmentFiles } from "../environment/files.js"

/** Confined discovery never installs packages or opens files through host filesystem services. */
export function confined(files: EnvironmentFiles.Files, directory: string, bin: string) {
  const exists = (target: string) => EnvironmentFiles.exists(files, target).pipe(Effect.orElseSucceed(() => false))
  const readFileString = (target: string) =>
    files.read(target).pipe(Effect.map((result) => new TextDecoder().decode(result.bytes)))
  const readJson = (target: string) =>
    readFileString(target).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))))
  const findUp = (target: string) =>
    // The Location is the workspace root; do not discover configuration above it.
    exists(path.join(directory, target)).pipe(Effect.map((found) => (found ? [path.join(directory, target)] : [])))
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
    const target = path.join(directory, "node_modules", ".bin", name)
    return exists(target).pipe(Effect.map((found) => (found ? target : undefined)))
  }
  return { findUp, readFileString, readJson, findExecutable, packageBinary }
}

export * as FormatterDiscovery from "./discovery.js"
