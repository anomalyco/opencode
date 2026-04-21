import type { ProviderAuthAccountInfo } from "@opencode-ai/sdk/v2/client"
import { createMemo, createResource } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { useProviders } from "./use-providers"

type AccountMap = Record<string, ProviderAuthAccountInfo[]>

export function useProviderAccounts() {
  const globalSDK = useGlobalSDK()
  const providers = useProviders()

  const providerIDs = createMemo(() =>
    [...new Set(providers.connected().map((provider) => provider.id))]
      .filter((id) => !!id)
      .sort((a, b) => a.localeCompare(b)),
  )

  const [data, controls] = createResource(
    providerIDs,
    async (ids) => {
      const entries = await Promise.all(
        ids.map(async (providerID) => {
          const response = await globalSDK.client.provider
            .accounts({ providerID })
            .then((result) => result.data ?? [])
            .catch(() => [] as ProviderAuthAccountInfo[])
          return [providerID, response] as const
        }),
      )
      return Object.fromEntries(entries) as AccountMap
    },
    {
      initialValue: {} as AccountMap,
    },
  )

  const list = (providerID: string) => data.latest?.[providerID] ?? []
  const active = (providerID: string) => list(providerID).find((account) => account.active)

  const activate = async (providerID: string, accountKey: string) => {
    await globalSDK.client.provider.accounts2.activate({
      providerID,
      accountKey,
    })
    await controls.refetch()
  }

  return {
    data,
    list,
    active,
    refetch: controls.refetch,
    activate,
  }
}
