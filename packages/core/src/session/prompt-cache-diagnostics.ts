export * as PromptCacheDiagnostics from "./prompt-cache-diagnostics"

import type { LLMRequest } from "@opencode-ai/ai"
import { Hash } from "@opencode-ai/util/hash"

interface Entry {
  readonly label: string
  readonly hash: string
}

export interface Snapshot {
  readonly settings: string
  readonly tools: ReadonlyArray<Entry>
  readonly system: ReadonlyArray<Entry>
  readonly messages: ReadonlyArray<Entry>
}

export type Comparison =
  | { readonly status: "initial" }
  | { readonly status: "stable"; readonly messages: number }
  | { readonly status: "append-only"; readonly previousMessages: number; readonly currentMessages: number }
  | {
      readonly status: "changed"
      readonly component: "settings" | "tools" | "system" | "messages"
      readonly index: number
      readonly label: string
    }

const hash = (value: unknown) => Hash.sha256(JSON.stringify(value)).slice(0, 16)

export function snapshot(request: LLMRequest): Snapshot {
  return {
    settings: hash({
      route: request.model.route.id,
      provider: request.model.provider,
      model: request.model.id,
      modelDefaults: request.model.defaults,
      compatibility: request.model.compatibility,
      routeDefaults: {
        generation: request.model.route.defaults.generation,
        providerOptions: request.model.route.defaults.providerOptions,
        http: request.model.route.defaults.http,
      },
      generation: request.generation,
      providerOptions: request.providerOptions,
      http: request.http,
      toolChoice: request.toolChoice,
      cache: request.cache,
    }),
    tools: request.tools.map((tool) => ({ label: tool.name, hash: hash(tool) })),
    system: request.system.map((part, index) => ({ label: `system[${index}]`, hash: hash(part) })),
    messages: request.messages.map((message, index) => ({
      label: message.id ?? `${message.role}[${index}]`,
      hash: hash(message),
    })),
  }
}

export function compare(previous: Snapshot | undefined, current: Snapshot): Comparison {
  if (!previous) return { status: "initial" }
  if (previous.settings !== current.settings)
    return {
      status: "changed",
      component: "settings",
      index: 0,
      label: "model settings",
    }
  const tools = firstChange(previous.tools, current.tools, false)
  if (tools) return { status: "changed", component: "tools", ...tools }
  const system = firstChange(previous.system, current.system, false)
  if (system) return { status: "changed", component: "system", ...system }
  const messages = firstChange(previous.messages, current.messages, true)
  if (messages) return { status: "changed", component: "messages", ...messages }
  if (previous.messages.length === current.messages.length)
    return { status: "stable", messages: current.messages.length }
  return {
    status: "append-only",
    previousMessages: previous.messages.length,
    currentMessages: current.messages.length,
  }
}

function firstChange(previous: ReadonlyArray<Entry>, current: ReadonlyArray<Entry>, allowAppend: boolean) {
  const index = previous.findIndex((entry, index) => entry.hash !== current[index]?.hash)
  if (index >= 0)
    return {
      index,
      label: current[index]?.label ?? previous[index]?.label ?? `entry[${index}]`,
    }
  if (current.length === previous.length || (allowAppend && current.length > previous.length)) return
  return {
    index: previous.length,
    label: current[previous.length]?.label ?? `entry[${previous.length}]`,
  }
}
