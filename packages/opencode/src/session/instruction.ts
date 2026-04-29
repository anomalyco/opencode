import os from "os"
import path from "path"
import { Effect, Layer, Context } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { Flag } from "@opencode-ai/core/flag/flag"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { withTransientReadRetry } from "@/util/effect-http-client"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import type { MessageV2 } from "./message-v2"
import type { MessageID } from "./schema"

const log = Log.create({ service: "instruction" })

const FILES = [
  "AGENTS.md",
  ...(Flag.OPENCODE_DISABLE_CLAUDE_CODE_PROMPT ? [] : ["CLAUDE.md"]),
  "CONTEXT.md", // deprecated
]

function globalFiles() {
  const files = []
  if (Flag.OPENCODE_CONFIG_DIR) {
    files.push(path.join(Flag.OPENCODE_CONFIG_DIR, "AGENTS.md"))
  }
  files.push(path.join(Global.Path.config, "AGENTS.md"))
  if (!Flag.OPENCODE_DISABLE_CLAUDE_CODE_PROMPT) {
    files.push(path.join(os.homedir(), ".claude", "CLAUDE.md"))
  }
  return files
}

function extract(messages: MessageV2.WithParts[]) {
  const paths = new Set<string>()
  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type === "tool" && part.tool === "read" && part.state.status === "completed") {
        if (part.state.time.compacted) continue
        const loaded = part.state.metadata?.loaded
        if (!loaded || !Array.isArray(loaded)) continue
        for (const p of loaded) {
          if (typeof p === "string") paths.add(p)
        }
      }
    }
  }
  return paths
}

export interface Interface {
  readonly clear: (messageID: MessageID) => Effect.Effect<void>
  readonly systemPaths: () => Effect.Effect<Set<string>, AppFileSystem.Error>
  readonly system: () => Effect.Effect<string[], AppFileSystem.Error>
  readonly find: (dir: string) => Effect.Effect<string | undefined, AppFileSystem.Error>
  readonly resolve: (
    messages: MessageV2.WithParts[],
    filepath: string,
    messageID: MessageID,
  ) => Effect.Effect<{ filepath: string; content: string }[], AppFileSystem.Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Instruction") {}

export const layer: Layer.Layer<Service, never, AppFileSystem.Service | Config.Service | HttpClient.HttpClient> =
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const cfg = yield* Config.Service
      const fs = yield* AppFileSystem.Service
      const http = HttpClient.filterStatusOk(withTransientReadRetry(yield* HttpClient.HttpClient))

      const state = yield* InstanceState.make(
        Effect.fn("Instruction.state")(() =>
          Effect.succeed({
            // Track which instruction files have already been attached for a given assistant message.
            claims: new Map<MessageID, Set<string>>(),
          }),
        ),
      )

      const relative = Effect.fnUntraced(function* (instruction: string) {
        const ctx = yield* InstanceState.context
        if (!Flag.OPENCODE_DISABLE_PROJECT_CONFIG) {
          return yield* fs
            .globUp(instruction, ctx.directory, ctx.worktree)
            .pipe(Effect.catch(() => Effect.succeed([] as string[])))
        }
        if (!Flag.OPENCODE_CONFIG_DIR) {
          log.warn(
            `Skipping relative instruction "${instruction}" - no OPENCODE_CONFIG_DIR set while project config is disabled`,
          )
          return []
        }
        return yield* fs
          .globUp(instruction, Flag.OPENCODE_CONFIG_DIR, Flag.OPENCODE_CONFIG_DIR)
          .pipe(Effect.catch(() => Effect.succeed([] as string[])))
      })

      const read = Effect.fnUntraced(function* (filepath: string) {
        return yield* fs.readFileString(filepath).pipe(Effect.catch(() => Effect.succeed("")))
      })

      const fetch = Effect.fnUntraced(function* (url: string) {
        const res = yield* http.execute(HttpClientRequest.get(url)).pipe(
          Effect.timeout(5000),
          Effect.catch(() => Effect.succeed(null)),
        )
        if (!res) return ""
        const body = yield* res.arrayBuffer.pipe(Effect.catch(() => Effect.succeed(new ArrayBuffer(0))))
        return new TextDecoder().decode(body)
      })

      const clear = Effect.fn("Instruction.clear")(function* (messageID: MessageID) {
        const s = yield* InstanceState.get(state)
        s.claims.delete(messageID)
      })

      const systemPaths = Effect.fn("Instruction.systemPaths")(function* () {
        const config = yield* cfg.get()
        const ctx = yield* InstanceState.context
        const paths = new Set<string>()

        // The first project-level match wins so we don't stack AGENTS.md/CLAUDE.md from every ancestor.
        if (!Flag.OPENCODE_DISABLE_PROJECT_CONFIG) {
          for (const file of FILES) {
            const matches = yield* fs.findUp(file, ctx.directory, ctx.worktree)
            if (matches.length > 0) {
              matches.forEach((item) => paths.add(path.resolve(item)))
              break
            }
          }
        }

        for (const file of globalFiles()) {
          if (yield* fs.existsSafe(file)) {
            paths.add(path.resolve(file))
            break
          }
        }

        if (config.instructions) {
          for (const raw of config.instructions) {
            if (raw.startsWith("https://") || raw.startsWith("http://")) continue
            const instruction = raw.startsWith("~/") ? path.join(os.homedir(), raw.slice(2)) : raw
            const matches = yield* (
              path.isAbsolute(instruction)
                ? fs.glob(path.basename(instruction), {
                    cwd: path.dirname(instruction),
                    absolute: true,
                    include: "file",
                  })
                : relative(instruction)
            ).pipe(Effect.catch(() => Effect.succeed([] as string[])))
            matches.forEach((item) => paths.add(path.resolve(item)))
          }
        }

        return paths
      })

      const system = Effect.fn("Instruction.system")(function* () {
        const config = yield* cfg.get()
        const paths = yield* systemPaths()
        const urls = (config.instructions ?? []).filter(
          (item) => item.startsWith("https://") || item.startsWith("http://"),
        )

        const files = yield* Effect.forEach(Array.from(paths), read, { concurrency: 8 })
        const remote = yield* Effect.forEach(urls, fetch, { concurrency: 4 })

        return [
          ...Array.from(paths).flatMap((item, i) => (files[i] ? [`Instructions from: ${item}\n${files[i]}`] : [])),
          ...urls.flatMap((item, i) => (remote[i] ? [`Instructions from: ${item}\n${remote[i]}`] : [])),
        ]
      })

      const find = Effect.fn("Instruction.find")(function* (dir: string) {
        for (const file of FILES) {
          const filepath = path.resolve(path.join(dir, file))
          if (yield* fs.existsSafe(filepath)) return filepath
        }
      })

      const resolve = Effect.fn("Instruction.resolve")(function* (
        messages: MessageV2.WithParts[],
        filepath: string,
        messageID: MessageID,
      ) {
        const sys = yield* systemPaths()
        const already = extract(messages)
        const results: { filepath: string; content: string }[] = []
        const s = yield* InstanceState.get(state)
        const root = path.resolve(yield* InstanceState.directory)

        const target = path.resolve(filepath)
        let current = path.dirname(target)

        // Walk upward from the file being read and attach nearby instruction files once per message.
        while (current.startsWith(root) && current !== root) {
          const found = yield* find(current)
          if (!found || found === target || sys.has(found) || already.has(found)) {
            current = path.dirname(current)
            continue
          }

          let set = s.claims.get(messageID)
          if (!set) {
            set = new Set()
            s.claims.set(messageID, set)
          }
          if (set.has(found)) {
            current = path.dirname(current)
            continue
          }

          set.add(found)
          const content = yield* read(found)
          if (content) {
            results.push({ filepath: found, content: `Instructions from: ${found}\n${content}` })
          }

          current = path.dirname(current)
        }

        return results
      })

      return Service.of({ clear, systemPaths, system, find, resolve })
    }),
  )

export const defaultLayer = layer.pipe(
  Layer.provide(Config.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(FetchHttpClient.layer),
)

export function loaded(messages: MessageV2.WithParts[]) {
  return extract(messages)
}

export * as Instruction from "./instruction"
