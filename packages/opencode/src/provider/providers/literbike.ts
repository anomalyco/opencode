import type { ModelsDev } from "../models";

interface OpenAIModel {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
}

interface OpenAIModelsResponse {
  object?: string;
  data?: OpenAIModel[];
}

const baseURL = "http://localhost:8888";

const FALLBACK_MODEL_IDS = ["claude-opus-4-5", "claude-sonnet-4-5", "gpt-4o", "gpt-4o-mini"];

function makeModel(id: string, created?: number): ModelsDev.Model {
  return {
    id,
    name: id,
    family: "",
    release_date: new Date((created ?? Date.now() / 1000) * 1000).toISOString(),
    attachment: false,
    reasoning: false,
    temperature: false,
    tool_call: true,
    limit: {
      context: 128000,
      output: 4096,
    },
    modalities: {
      input: ["text"],
      output: ["text"],
    },
    options: {},
    provider: {
      api: baseURL,
      npm: "@ai-sdk/openai-compatible",
    },
  };
}

function fallbackModels(): Record<string, ModelsDev.Model> {
  const models: Record<string, ModelsDev.Model> = {};
  for (const id of FALLBACK_MODEL_IDS) {
    models[id] = makeModel(id);
  }
  return models;
}

async function fetchModels(): Promise<Record<string, ModelsDev.Model>> {
  const res = await fetch(`${baseURL}/v1/models`, {
    signal: AbortSignal.timeout(2000),
  }).catch(() => undefined);

  if (!res?.ok) return fallbackModels();

  const json = (await res.json().catch(() => ({}))) as OpenAIModelsResponse;
  const data = json.data ?? [];

  if (data.length === 0) return fallbackModels();

  const models: Record<string, ModelsDev.Model> = {};
  for (const m of data) {
    models[m.id] = makeModel(m.id, m.created);
  }

  return models;
}

export const literbike = {
  id: "literbike",
  name: "Literbike",
  env: [],
  models: fetchModels,
};
