import type { LocationRef } from "@opencode-ai/sdk/v2"
import { createMemo, createResource, type Accessor } from "solid-js"
import { useLocal } from "../context/local"
import { useRoute } from "../context/route"
import { useSDK } from "../context/sdk"
import { useSync } from "../context/sync"
import { useTuiConfig } from "../config"
import { createSimpleContext } from "../context/helper"
import type { UsageResponse } from "./usage-data"
import { resolveUsageProvider, type UsageScope } from "./usage-provider"

type UsageResource = {
  data: Accessor<UsageResponse | undefined>
  refetch: () => void
  scope: () => UsageScope
  provider: () => string | null
}

const emptyUsage: UsageResponse = { results: [] }

type UsageResourceInput = {
  sdk: ReturnType<typeof useSDK>
  location: Accessor<LocationRef | undefined>
  scope: Accessor<UsageScope>
  modelProviderID: Accessor<string | null>
}

type UsageResourceState = {
  key: string
  result: UsageResponse
  error?: string
}

export async function fetchUsage(
  sdk: ReturnType<typeof useSDK>,
  params: {
    location: LocationRef
    provider?: string
    refresh?: boolean
  },
): Promise<UsageResponse> {
  if (!params.location) return emptyUsage
  const response = await sdk.client.usage.get({
    directory: params.location.directory,
    workspace: params.location.workspaceID,
    provider: params.provider,
    refresh: params.refresh,
  })
  if (response.error) {
    throw new Error(responseErrorMessage(response.error))
  }
  const data = response.data
  return {
    results: data?.results ?? [],
  }
}

function responseErrorMessage(error: unknown) {
  if (typeof error === "string") return error
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string")
    return error.message
  return "Usage request failed"
}

const Usage = createSimpleContext<UsageResource, Record<never, never>>({
  name: "Usage",
  init() {
    const local = useLocal()
    const route = useRoute()
    const sdk = useSDK()
    const sync = useSync()
    const tuiConfig = useTuiConfig()
    return createUsageResource({
      sdk,
      location: () => {
        if (route.data.type !== "session") return
        const session = sync.session.get(route.data.sessionID)
        if (!session) return
        return { directory: session.directory, workspaceID: session.workspaceID }
      },
      scope: () => tuiConfig.show_usage_provider_scope ?? "current",
      modelProviderID: () => local.model.current()?.providerID ?? null,
    })
  },
})

export function createUsageResource(input: UsageResourceInput): UsageResource {
  const scope = createMemo(input.scope)
  const provider = createMemo(() =>
    resolveUsageProvider({
      scope: scope(),
      modelProviderID: input.modelProviderID(),
    }),
  )
  const source = createMemo(() => {
    const current = input.location()
    return {
      key: `${scope()}\u0000${provider() ?? ""}\u0000${current?.directory ?? ""}\u0000${current?.workspaceID ?? ""}`,
      location: current,
      provider: provider(),
      scope: scope(),
    }
  })

  const [state, { refetch }] = createResource<UsageResourceState, ReturnType<typeof source>>(
    source,
    async (current, previous) => {
      if (!current.location) return { key: current.key, result: emptyUsage }
      if (current.scope === "current" && !current.provider) {
        return { key: current.key, result: emptyUsage }
      }

      return fetchUsage(input.sdk, {
        location: current.location,
        provider: current.provider ?? undefined,
        refresh: false,
      }).then(
        (result) => ({ key: current.key, result }),
        (error) => ({
          key: current.key,
          result: previous.value?.key === current.key ? previous.value.result : emptyUsage,
          error: responseErrorMessage(error),
        }),
      )
    },
    { initialValue: { key: source().key, result: emptyUsage } },
  )

  const data = createMemo(() => {
    const current = state()
    if (current?.key !== source().key) return emptyUsage
    return current.result
  })

  return {
    data,
    refetch,
    scope,
    provider,
  }
}

export const UsageProvider = Usage.provider
export const useUsageResource = Usage.use
