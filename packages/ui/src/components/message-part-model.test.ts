/**
 * @spec-handoff
 * @interface formatModelLabel(providerID: string | undefined, modelID: string | undefined, provider: Provider | undefined): string
 *
 * Pure helper that renders the model label shown next to assistant and user
 * messages. It MUST be extracted into a new sibling module
 * `./message-part-model.ts` and then consumed by BOTH inline memos in
 * `message-part.tsx`:
 *   - Assistant footer `model` memo  — message-part.tsx lines 1478-1483
 *       (resolve provider via `data.store.provider?.all?.get(message.providerID)`,
 *        then call `formatModelLabel(message.providerID, message.modelID, match)`)
 *   - User header `model` memo       — message-part.tsx lines 1069-1088
 *       (resolve provider via `data.store.provider?.all?.get(providerID)`,
 *        then call `formatModelLabel(providerID, modelID, match)`)
 *
 * @format
 *   - Forward slash, NO surrounding spaces: `provider/model` (e.g. "anthropic/claude-sonnet").
 *   - Catalog HIT (provider entry resolved): use the catalog display names →
 *       `${provider.name}/${provider.models[modelID].name}`.
 *   - Catalog MISS (per-field `??` fallback, mirrors today's `?? modelID`):
 *       providerLabel = provider?.name ?? providerID
 *       modelLabel    = provider?.models?.[modelID]?.name ?? modelID
 *     So a fully-missing catalog entry yields the RAW IDs: `providerID/modelID`.
 *
 * @no-model-guard
 *   - When providerID OR modelID is absent (user message with no model), return
 *     "" — never render a stray "/". Preserves the existing user-memo guard at
 *     message-part.tsx:1072 (`if (!providerID || !modelID) return ""`).
 *
 * @edge-cases
 *   - Provider resolves but the specific model is absent in its catalog →
 *     `${provider.name}/${modelID}` (provider name + raw model id).
 *
 * @see ./message-part.tsx (lines 1478-1483 assistant memo, 1069-1088 user memo)
 * @see ./message-part-text.ts (sibling pure-helper module pattern to mirror)
 */
import { describe, expect, test } from "bun:test"
import type { Provider } from "@opencode-ai/sdk/v2"
import { formatModelLabel } from "./message-part-model"

function provider(part: Partial<Provider> = {}): Provider {
  return {
    id: "anthropic",
    name: "Anthropic",
    source: "config",
    env: [],
    options: {},
    models: {
      "claude-sonnet-4-20250514": {
        name: "Claude Sonnet",
      },
    } as unknown as Provider["models"],
    ...part,
  }
}

describe("formatModelLabel", () => {
  test("assistant catalog hit renders provider and model display names as provider/model", () => {
    expect(formatModelLabel("anthropic", "claude-sonnet-4-20250514", provider())).toBe("Anthropic/Claude Sonnet")
  })

  test("assistant catalog miss falls back to raw providerID/modelID", () => {
    expect(formatModelLabel("anthropic", "claude-sonnet-4-20250514", undefined)).toBe(
      "anthropic/claude-sonnet-4-20250514",
    )
  })

  test("user message with model renders provider/model from the catalog", () => {
    expect(formatModelLabel("anthropic", "claude-sonnet-4-20250514", provider())).toBe("Anthropic/Claude Sonnet")
  })

  test("user message without model renders empty string and never a stray slash", () => {
    expect(formatModelLabel(undefined, undefined, undefined)).toBe("")
  })
})
