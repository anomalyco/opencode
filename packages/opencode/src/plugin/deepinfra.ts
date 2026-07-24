import type { Hooks, PluginInput } from "@opencode-ai/plugin";
import type { Model } from "@opencode-ai/sdk/v2";

const LIST_URL = "https://api.deepinfra.com/models/list";
const CHAT_URL = "https://api.deepinfra.com/v1/openai";
const TIMEOUT_MS = 2_000;

interface DeepInfraListModel {
  model_name: string;
  reported_type?: string;
  type?: string;
  description?: string;
  pricing?: {
    type?: string;
    cents_per_input_token?: number;
    cents_per_output_token?: number;
    rate_per_input_token_cached?: number;
  };
  max_tokens?: number | null;
}

// DeepInfra reports prices in cents per token; convert to dollars per million.
function perMillionCents(cents: number | undefined): number {
  if (cents === undefined || Number.isNaN(cents)) return 0;
  return Math.round(cents * 10_000 * 100) / 100;
}

function toModelName(id: string): string {
  const parts = id.split("/");
  return parts[parts.length - 1];
}

export async function DeepInfraAuthPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    provider: {
      id: "deepinfra",
      async models(provider, ctx) {
        const baseModels = provider.models;
        const key = ctx.auth?.type === "api" ? ctx.auth.key : undefined;

        let listing: DeepInfraListModel[] | undefined;
        try {
          const res = await fetch(LIST_URL, {
            signal: AbortSignal.timeout(TIMEOUT_MS),
            ...(key ? { headers: { Authorization: `Bearer ${key}` } } : {}),
          });
          if (!res.ok) return baseModels;
          const json = (await res.json()) as DeepInfraListModel[];
          if (!Array.isArray(json)) return baseModels;
          listing = json;
        } catch {
          return baseModels;
        }

        const textModels = listing.filter(
          (m) => m.reported_type === "text-generation" || m.type === "text-generation",
        );
        if (!textModels.length) return baseModels;

        const models: Record<string, Model> = { ...baseModels };
        for (const item of textModels) {
          const id = item.model_name;
          if (!id || models[id]) continue;
          const pricing = item.pricing;
          const inputCost = perMillionCents(pricing?.cents_per_input_token);
          const outputCost = perMillionCents(pricing?.cents_per_output_token);
          const cacheRead = Math.round(inputCost * (pricing?.rate_per_input_token_cached ?? 0) * 10_000) / 10_000;
          const context = item.max_tokens ?? 0;

          models[id] = {
            id,
            providerID: "deepinfra",
            name: toModelName(id),
            family: "deepinfra",
            api: { id, url: CHAT_URL, npm: "@ai-sdk/deepinfra" },
            status: "active",
            headers: {},
            options: {},
            cost: {
              input: inputCost,
              output: outputCost,
              cache: { read: cacheRead, write: 0 },
            },
            limit: { context, input: context, output: 0 },
            capabilities: {
              temperature: true,
              reasoning: false,
              attachment: false,
              toolcall: true,
              input: { text: true, audio: false, image: false, video: false, pdf: false },
              output: { text: true, audio: false, image: false, video: false, pdf: false },
              interleaved: false,
            },
            release_date: "",
            variants: {},
          } as Model;
        }

        return Object.keys(models).length === 0 ? baseModels : models;
      },
    },
  };
}
