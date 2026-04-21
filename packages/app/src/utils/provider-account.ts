type ProviderAccountClient = {
  provider: {
    accounts: (input: { providerID: string }) => Promise<{ data?: Array<{ accountKey: string; active: boolean }> }>
    accounts2: {
      activate: (input: { providerID: string; accountKey: string }) => Promise<unknown>
    }
  }
}

type ProviderAccountModel = {
  providerID: string
  accountKey?: string
}

export async function ensureProviderAccountActive(client: ProviderAccountClient, model: ProviderAccountModel | undefined) {
  const providerID = model?.providerID
  const accountKey = model?.accountKey?.trim()
  if (!providerID || !accountKey) return

  const accounts = await client.provider.accounts({ providerID }).then((result) => result.data ?? [])
  const selected = accounts.find((item) => item.accountKey === accountKey)
  if (!selected) {
    throw new Error(`Account "${accountKey}" is no longer connected for provider "${providerID}".`)
  }
  if (selected.active) return

  await client.provider.accounts2.activate({
    providerID,
    accountKey,
  })
}
