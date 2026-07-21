import { spyOn } from "bun:test"
import type {
  LocationRef,
  ModelListOutput,
  OpenCodeClient,
  ProviderListOutput,
} from "@opencode-ai/client/promise"

export function catalogProvider(id: string, name: string): ProviderListOutput["data"][number] {
  return {
    id,
    name,
    package: "",
  }
}

export function catalogModel(input: {
  id: string
  modelID?: string
  providerID: string
  name?: string
  context?: number
  variants?: string[]
}): ModelListOutput["data"][number] {
  return {
    id: input.id,
    modelID: input.modelID ?? input.id,
    providerID: input.providerID,
    name: input.name ?? input.id,
    capabilities: {
      tools: true,
      input: ["text"],
      output: ["text"],
    },
    variants: (input.variants ?? []).map((id) => ({ id })),
    time: { released: 1 },
    cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
    status: "active",
    enabled: true,
    limit: { context: input.context ?? 128_000, output: 8_192 },
  }
}

export function stubCatalogLists(
  sdk: OpenCodeClient,
  input: {
    location?: LocationRef
    providers?: ProviderListOutput["data"]
    models?: ModelListOutput["data"]
  } = {},
) {
  const location = {
    directory: input.location?.directory ?? "/tmp",
    workspaceID: input.location?.workspaceID,
    project: { id: "proj_1", directory: input.location?.directory ?? "/tmp" },
  }
  const empty = { location, data: [] }

  return {
    provider: spyOn(sdk.provider, "list").mockResolvedValue({ location, data: input.providers ?? [] } as never),
    model: spyOn(sdk.model, "list").mockResolvedValue({ location, data: input.models ?? [] } as never),
    agent: spyOn(sdk.agent, "list").mockResolvedValue(empty as never),
    reference: spyOn(sdk.reference, "list").mockResolvedValue(empty as never),
    command: spyOn(sdk.command, "list").mockResolvedValue(empty as never),
    skill: spyOn(sdk.skill, "list").mockResolvedValue(empty as never),
  }
}
