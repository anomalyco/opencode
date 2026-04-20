import { test, expect, spyOn } from "bun:test"
import path from "path"

// Stub discovery with spyOn instead of mock.module: Bun keeps mock.module overrides in the
// module cache and mock.restore() does not revert them (oven-sh/bun#7823). spyOn restores
// cleanly and avoids replacing globalThis.fetch, which breaks concurrent tests.
import * as OpenWebUIDiscovery from "../../src/provider/open-webui-discovery"
import type { Model } from "../../src/provider/provider"
import * as ProviderTransform from "../../src/provider/transform"
import { ProviderID, ModelID } from "../../src/provider/schema"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider"
import { Filesystem } from "../../src/util"
import { Effect } from "effect"
import { AppRuntime } from "../../src/effect/app-runtime"

async function list() {
  return AppRuntime.runPromise(
    Effect.gen(function* () {
      const provider = yield* Provider.Service
      return yield* provider.list()
    }),
  )
}

const openwebui = ProviderID.make("openwebui")

/** Mirrors {@link OpenWebUIDiscovery.discoverOpenWebUIModels} success shape without calling the network. */
function fakeDiscoveryOk(rawBaseURL: string): OpenWebUIDiscovery.OpenWebUIDiscoveryOk {
  const normalized = ProviderTransform.openwebuiOpenAICompatibleBase(rawBaseURL.replace(/\/+$/, ""))
  const rawID = "open-webui-model"
  const model: Model = {
    id: ModelID.make(rawID),
    providerID: openwebui,
    name: "Open WebUI Model",
    api: {
      id: rawID,
      url: normalized,
      npm: "@ai-sdk/openai-compatible",
    },
    status: "active",
    headers: {},
    options: {},
    cost: {
      input: 0,
      output: 0,
      cache: { read: 0, write: 0 },
    },
    limit: {
      context: 128_000,
      output: 4_096,
    },
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
  }
  return {
    ok: true,
    models: { [rawID]: model },
    normalizedBase: normalized,
  }
}

test("Open WebUI: loads models from the instance when discovery succeeds", async () => {
  const prevBase = process.env["OPEN_WEBUI_BASE_URL"]
  const prevKey = process.env["OPEN_WEBUI_API_KEY"]

  await using tmp = await tmpdir({
    init: async (dir) => {
      await Filesystem.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
        }),
      )
    },
  })

  process.env["OPEN_WEBUI_BASE_URL"] = "https://owui.test"
  process.env["OPEN_WEBUI_API_KEY"] = "test-api-key"

  const spy = spyOn(OpenWebUIDiscovery, "discoverOpenWebUIModels").mockImplementation(async (input) =>
    fakeDiscoveryOk(input.rawBaseURL),
  )

  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const providers = await list()
        const row = providers[openwebui]
        expect(row).toBeDefined()
        expect(row.models["open-webui-model"]).toBeDefined()
        expect(row.models["open-webui-model"]?.name).toBe("Open WebUI Model")
      },
    })
    expect(spy).toHaveBeenCalled()
  } finally {
    spy.mockRestore()
    if (prevBase === undefined) delete process.env["OPEN_WEBUI_BASE_URL"]
    else process.env["OPEN_WEBUI_BASE_URL"] = prevBase
    if (prevKey === undefined) delete process.env["OPEN_WEBUI_API_KEY"]
    else process.env["OPEN_WEBUI_API_KEY"] = prevKey
  }
})
