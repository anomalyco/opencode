import { Effect, Schema } from "effect"
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import * as path from "path"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Instance } from "../project/instance"
import { assertExternalDirectoryEffect } from "./external-directory"
import DESCRIPTION from "./hash.txt"
import * as Tool from "./tool"

const ALGORITHMS = ["sha256", "sha512", "sha1", "md5"] as const

export const Parameters = Schema.Struct({
  filePath: Schema.String.annotate({
    description: "Path to the file to hash. Absolute preferred; relative paths resolve from the project directory.",
  }),
  algorithm: Schema.Literals(ALGORITHMS)
    .pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed("sha256" as const)))
    .annotate({
      description: "Hash algorithm. One of: sha256 (default), sha512, sha1, md5.",
    }),
  expected: Schema.optional(Schema.String).annotate({
    description:
      "Optional hex digest to verify against. Case-insensitive; non-hex characters (colons, spaces) are stripped. Sets metadata.matches to true/false.",
  }),
})

type Params = Schema.Schema.Type<typeof Parameters>
type Algorithm = (typeof ALGORITHMS)[number]

type Metadata = {
  algorithm: Algorithm
  digest: string
  size_bytes: number
  elapsed_ms: number
  expected?: string
  matches?: boolean
}

const normalizeHex = (s: string) => s.toLowerCase().replace(/[^a-f0-9]/g, "")

const streamHash = (filePath: string, algorithm: Algorithm, signal: AbortSignal): Promise<string> =>
  new Promise((resolve, reject) => {
    const hasher = createHash(algorithm)
    const stream = createReadStream(filePath, { signal: signal as any })
    stream.on("data", (chunk) => hasher.update(chunk))
    stream.on("end", () => resolve(hasher.digest("hex")))
    stream.on("error", reject)
  })

const done = (result: Tool.ExecuteResult<Metadata>) => result

export const HashTool = Tool.define(
  "hash",
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Params, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const algorithm = params.algorithm ?? "sha256"
          const target = path.isAbsolute(params.filePath)
            ? params.filePath
            : path.resolve(Instance.directory, params.filePath)

          yield* ctx.ask({
            permission: "read",
            patterns: [target],
            always: ["*"],
            metadata: { filePath: target, algorithm },
          })

          yield* assertExternalDirectoryEffect(ctx, target, { kind: "file" })

          const info = yield* fs.stat(target).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (!info) {
            throw new Error(`hash: file not found: ${target}`)
          }
          if (info.type !== "File") {
            throw new Error(`hash: not a regular file: ${target} (type=${info.type})`)
          }

          const size_bytes = Number(info.size ?? 0)
          const start = Date.now()
          const digest = yield* Effect.promise(() => streamHash(target, algorithm, ctx.abort))
          const elapsed_ms = Date.now() - start

          const expected = params.expected ? normalizeHex(params.expected) : undefined
          const matches = expected !== undefined ? digest === expected : undefined
          const sizeMb = (size_bytes / 1024 / 1024).toFixed(1)
          const verified = matches === true ? " verified" : matches === false ? " mismatch" : ""
          const title = `${algorithm} ${digest.slice(0, 12)}...${digest.slice(-4)}${verified}`

          const output =
            matches === false
              ? `${algorithm} MISMATCH for ${target} (${sizeMb} MB, hashed in ${elapsed_ms}ms)\n  computed: ${digest}\n  expected: ${expected}`
              : matches === true
                ? `${algorithm} verified for ${target} (${sizeMb} MB, hashed in ${elapsed_ms}ms)\n  digest:   ${digest}`
                : `${algorithm} digest of ${target} (${sizeMb} MB, hashed in ${elapsed_ms}ms)\n  digest: ${digest}`

          return done({
            title,
            metadata: {
              algorithm,
              digest,
              size_bytes,
              elapsed_ms,
              expected,
              matches,
            },
            output,
          })
        }),
    }
  }),
)
