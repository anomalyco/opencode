import { Stream } from "effect"
import { LLMClient } from "../../src/route"
import type { Tools } from "../../src/tool"
import type { RunOptions } from "../../src/tool-runtime"

type CompatRunOptions<T extends Tools> = RunOptions<T> & { readonly maxSteps?: number }

export const runTools = <T extends Tools>(options: CompatRunOptions<T>) =>
  LLMClient.stream({ ...options, stopWhen: options.stopWhen ?? LLMClient.stepCountIs(options.maxSteps ?? 10) })
