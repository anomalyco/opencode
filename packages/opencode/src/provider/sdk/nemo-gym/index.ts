/**
 * NeMo-Gym opencode provider entry.
 *
 * Provider id: `nemo-gym`. Used by the bench harness for SWE-bench RL rollouts.
 * Registered in `provider/provider.ts:BUNDLED_PROVIDERS`.
 *
 * The factory mirrors `@ai-sdk/openai-compatible`'s shape: `createNemoGym(opts)`
 * returns a provider with `.languageModel(modelId)` so opencode's existing
 * provider plumbing (Provider.Service.getModel) works without special-casing.
 */

import { NemoGymLanguageModel, type NemoGymLanguageModelConfig } from "./language-model"

export interface CreateNemoGymOptions {
  /** Base URL of the gym model server (`http://host:port`). */
  baseURL: string
  /** Optional name of the model server (informational; useful for logs). */
  modelServerName?: string
  /** Custom request headers. */
  headers?: () => Record<string, string | undefined>
  /**
   * Where to dump per-call llm_completions/<turn>.json files.
   * Set per-instance by the bench harness; if absent, no trajectory dump.
   */
  completionsDir?: string
  /** instance_id to embed in trajectory dump paths/file names. */
  instanceId?: string
  /** Per-call HTTP timeout in ms. */
  requestTimeoutMs?: number
  /** HTTP retry count on transient errors. */
  retries?: number
  /** Optional turn counter shared across all model calls in a session. */
  turnCounter?: { next(): number }
  /** Optional callback invoked after each successful chat-completion. */
  onCompletion?: NemoGymLanguageModelConfig["onCompletion"]
}

export interface NemoGymProvider {
  languageModel: (modelId: string) => NemoGymLanguageModel
}

export function createNemoGym(opts: CreateNemoGymOptions): NemoGymProvider {
  if (!opts.baseURL) {
    throw new Error("createNemoGym: baseURL is required (e.g. http://host:port)")
  }
  return {
    languageModel(modelId: string) {
      return new NemoGymLanguageModel(modelId, {
        provider: "nemo-gym",
        baseURL: opts.baseURL,
        modelServerName: opts.modelServerName,
        headers: opts.headers,
        completionsDir: opts.completionsDir,
        instanceId: opts.instanceId,
        requestTimeoutMs: opts.requestTimeoutMs,
        retries: opts.retries,
        turnCounter: opts.turnCounter,
        onCompletion: opts.onCompletion,
      })
    },
  }
}
