import path from "path"
import os from "os"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { Flag } from "@/flag/flag"
import { Log } from "../util/log"
import { Glob } from "../util/glob"
import type { MessageV2 } from "./message-v2"
import { Effect, Layer, ServiceMap } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"

const log = Log.create({ service: "instruction" })

const FILES = [
  "AGENTS.md",
  ...(Flag.OPENCODE_DISABLE_CLAUDE_CODE_PROMPT ? [] : ["CLAUDE.md"]),
  "CONTEXT.md", // deprecated
]

function globals() {
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

function relative(instruction: string): Promise<string[]> {
  if (!Flag.OPENCODE_DISABLE_PROJECT_CONFIG) {
    return Filesystem.globUp(instruction, Instance.directory, Instance.worktree).catch(() => [])
  }
  if (!Flag.OPENCODE_CONFIG_DIR) {
    log.warn(
      `Skipping relative instruction "${instruction}" - no OPENCODE_CONFIG_DIR set while project config is disabled`,
    )
    return Promise.resolve([])
  }
  return Filesystem.globUp(instruction, Flag.OPENCODE_CONFIG_DIR, Flag.OPENCODE_CONFIG_DIR).catch(() => [])
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

export namespace Instruction {
  export interface Interface {
    readonly clear: (messageID: string) => Effect.Effect<void>
    readonly systemPaths: () => Effect.Effect<Set<string>>
    readonly system: () => Effect.Effect<string[]>
    readonly find: (dir: string) => Effect.Effect<string | undefined>
    readonly resolve: (
      messages: MessageV2.WithParts[],
      filepath: string,
      messageID: string,
    ) => Effect.Effect<{ filepath: string; content: string }[]>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Instruction") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const cfg = yield* Config.Service

      const state = yield* InstanceState.make(
        Effect.fn("Instruction.state")(() =>
          Effect.succeed({
            claims: new Map<string, Set<string>>(),
          }),
        ),
      )

      const clear = Effect.fn("Instruction.clear")(function* (messageID: string) {
        const s = yield* InstanceState.get(state)
        s.claims.delete(messageID)
      })

      const systemPaths = Effect.fnUntraced(function* () {
        const config = yield* cfg.get()
        const paths = new Set<string>()

        if (!Flag.OPENCODE_DISABLE_PROJECT_CONFIG) {
          for (const file of FILES) {
            const matches = yield* Effect.promise(() =>
              Filesystem.findUp(file, Instance.directory, Instance.worktree),
            )
            if (matches.length > 0) {
              matches.forEach((p) => paths.add(path.resolve(p)))
              break
            }
          }
        }

        for (const file of globals()) {
          if (yield* Effect.promise(() => Filesystem.exists(file))) {
            paths.add(path.resolve(file))
            break
          }
        }

        if (config.instructions) {
          for (const raw of config.instructions) {
            if (raw.startsWith("https://") || raw.startsWith("http://")) continue
            const instruction = raw.startsWith("~/") ? path.join(os.homedir(), raw.slice(2)) : raw
            const matches = yield* Effect.promise(() =>
              path.isAbsolute(instruction)
                ? Glob.scan(path.basename(instruction), {
                    cwd: path.dirname(instruction),
                    absolute: true,
                    include: "file",
                  }).catch(() => [])
                : relative(instruction),
            )
            matches.forEach((p) => paths.add(path.resolve(p)))
          }
        }

        return paths
      })

      const system = Effect.fnUntraced(function* () {
        const config = yield* cfg.get()
        const paths = yield* systemPaths()

        const files = Array.from(paths).map(async (p) => {
          const content = await Filesystem.readText(p).catch(() => "")
          return content ? "Instructions from: " + p + "\n" + content : ""
        })

        const urls: string[] = []
        if (config.instructions) {
          for (const instruction of config.instructions) {
            if (instruction.startsWith("https://") || instruction.startsWith("http://")) {
              urls.push(instruction)
            }
          }
        }
        const fetches = urls.map((url) =>
          fetch(url, { signal: AbortSignal.timeout(5000) })
            .then((res) => (res.ok ? res.text() : ""))
            .catch(() => "")
            .then((x) => (x ? "Instructions from: " + url + "\n" + x : "")),
        )

        return yield* Effect.promise(() => Promise.all([...files, ...fetches]).then((r) => r.filter(Boolean)))
      })

      const find = Effect.fnUntraced(function* (dir: string) {
        for (const file of FILES) {
          const filepath = path.resolve(path.join(dir, file))
          if (yield* Effect.promise(() => Filesystem.exists(filepath))) return filepath
        }
      })

      const resolve = Effect.fnUntraced(function* (
        messages: MessageV2.WithParts[],
        filepath: string,
        messageID: string,
      ) {
        const sys = yield* systemPaths()
        const already = extract(messages)
        const results: { filepath: string; content: string }[] = []
        const s = yield* InstanceState.get(state)

        const target = path.resolve(filepath)
        let current = path.dirname(target)
        const root = path.resolve(Instance.directory)

        while (current.startsWith(root) && current !== root) {
          const found = yield* find(current)

          if (found && found !== target && !sys.has(found) && !already.has(found)) {
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
            const content = yield* Effect.promise(() => Filesystem.readText(found).catch(() => undefined))
            if (content) {
              results.push({ filepath: found, content: "Instructions from: " + found + "\n" + content })
            }
          }
          current = path.dirname(current)
        }

        return results
      })

      return Service.of({ clear, systemPaths, system, find, resolve })
    }),
  )

  export const defaultLayer = layer.pipe(Layer.provide(Config.defaultLayer))

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export function clear(messageID: string) {
    return runPromise((svc) => svc.clear(messageID))
  }

  export async function systemPaths() {
    return runPromise((svc) => svc.systemPaths())
  }

  export async function system() {
    return runPromise((svc) => svc.system())
  }

  export function loaded(messages: MessageV2.WithParts[]) {
    return extract(messages)
  }

  export async function find(dir: string) {
    return runPromise((svc) => svc.find(dir))
  }

  export async function resolve(messages: MessageV2.WithParts[], filepath: string, messageID: string) {
    return runPromise((svc) => svc.resolve(messages, filepath, messageID))
  }
}

/** @deprecated Use `Instruction` instead */
export const InstructionPrompt = Instruction
