import { expect, test } from "bun:test";
import type { Model } from "@opencode-ai/sdk/v2";
import type { PluginInput } from "@opencode-ai/plugin";
import { DeepInfraAuthPlugin } from "@/plugin/deepinfra";

function baseModel(id: string): Model {
  return {
    id,
    providerID: "deepinfra",
    name: id.split("/").pop() ?? id,
    family: "deepinfra",
    api: { id, url: "https://api.deepinfra.com/v1/openai", npm: "@ai-sdk/deepinfra" },
    status: "active",
    headers: {},
    options: {},
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 0, input: 0, output: 0 },
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
  };
}

async function run(
  models: Record<string, Model>,
  auth?: { type: "api"; key: string },
): Promise<Record<string, Model>> {
  const hooks = await DeepInfraAuthPlugin({} as PluginInput);
  const models_ = hooks.provider?.models;
  if (!models_) return {};
  const result = await models_({ models } as never, { auth } as never);
  return result as Record<string, Model>;
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const original = globalThis.fetch;
  globalThis.fetch = ((input, init) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as Request).url;
    return handler(url, init);
  }) as typeof fetch;
  return original;
}

test("discovers models from /models/list without a key", async () => {
  const original = mockFetch((url) => {
    if (url.includes("/models/list")) {
      return Response.json([
        {
          model_name: "tencent/Hy3",
          reported_type: "text-generation",
          max_tokens: 262144,
          pricing: {
            type: "tokens",
            cents_per_input_token: 1.4e-05,
            cents_per_output_token: 5.8e-05,
            rate_per_input_token_cached: 0.25,
          },
        },
      ]);
    }
    return new Response("not found", { status: 404 });
  });
  try {
    const result = await run({});
    expect(result["tencent/Hy3"]).toBeDefined();
    expect(result["tencent/Hy3"].api.npm).toBe("@ai-sdk/deepinfra");
    expect(result["tencent/Hy3"].api.id).toBe("tencent/Hy3");
    expect(result["tencent/Hy3"].name).toBe("Hy3");
    expect(result["tencent/Hy3"].status).toBe("active");
  } finally {
    globalThis.fetch = original;
  }
});

test("enriches with pricing and max_tokens", async () => {
  const original = mockFetch((url) => {
    if (url.includes("/models/list")) {
      return Response.json([
        {
          model_name: "tencent/Hy3",
          reported_type: "text-generation",
          max_tokens: 262144,
          pricing: {
            type: "tokens",
            cents_per_input_token: 1.4e-05,
            cents_per_output_token: 5.8e-05,
            rate_per_input_token_cached: 0.25,
          },
        },
      ]);
    }
    return new Response("not found", { status: 404 });
  });
  try {
    const m = (await run({}))["tencent/Hy3"];
    expect(m.cost.input).toBe(0.14);
    expect(m.cost.output).toBe(0.58);
    expect(m.cost.cache.read).toBe(0.035);
    expect(m.limit.context).toBe(262144);
    expect(m.limit.input).toBe(262144);
  } finally {
    globalThis.fetch = original;
  }
});

test("does not clobber existing catalog/config models", async () => {
  const existing = baseModel("meta-llama/Llama-3.3-70B-Instruct");
  const baseModels: Record<string, Model> = {
    "meta-llama/Llama-3.3-70B-Instruct": existing,
  };
  const original = mockFetch((url) => {
    if (url.includes("/models/list")) {
      return Response.json([
        {
          model_name: "meta-llama/Llama-3.3-70B-Instruct",
          reported_type: "text-generation",
          max_tokens: 131072,
          pricing: { type: "tokens", cents_per_input_token: 0.0002, cents_per_output_token: 0.0008 },
        },
        { model_name: "tencent/Hy3", reported_type: "text-generation" },
      ]);
    }
    return new Response("not found", { status: 404 });
  });
  try {
    const result = await run(baseModels);
    expect(result["meta-llama/Llama-3.3-70B-Instruct"]).toBe(existing);
    expect(result["tencent/Hy3"]).toBeDefined();
  } finally {
    globalThis.fetch = original;
  }
});

test("filters out non-text-generation models", async () => {
  const original = mockFetch((url) => {
    if (url.includes("/models/list")) {
      return Response.json([
        { model_name: "tencent/Hy3", reported_type: "text-generation" },
        { model_name: "some/embedding", reported_type: "embedding" },
      ]);
    }
    return new Response("not found", { status: 404 });
  });
  try {
    const result = await run({});
    expect(result["tencent/Hy3"]).toBeDefined();
    expect(result["some/embedding"]).toBeUndefined();
  } finally {
    globalThis.fetch = original;
  }
});

test("timeout / network error fallback", async () => {
  const baseModels: Record<string, Model> = { "test/model": baseModel("test/model") };
  const original = mockFetch(() => {
    throw new Error("network error");
  });
  try {
    const result = await run(baseModels);
    expect(result).toBe(baseModels);
  } finally {
    globalThis.fetch = original;
  }
});

test("empty listing fallback", async () => {
  const baseModels: Record<string, Model> = { "test/model": baseModel("test/model") };
  const original = mockFetch((url) => {
    if (url.includes("/models/list")) return Response.json([]);
    return new Response("not found", { status: 404 });
  });
  try {
    const result = await run(baseModels);
    expect(result).toBe(baseModels);
  } finally {
    globalThis.fetch = original;
  }
});
