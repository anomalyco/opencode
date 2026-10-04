type Provider = {
  id: string
  integrationID?: string
  name: string
}

export function consoleProviderGroup<T extends Provider>(providers: readonly T[]) {
  const root = providers.find((provider) => provider.id === "opencode" && provider.integrationID === "opencode")
  const suffix = " / OpenCode"
  if (!root?.name.endsWith(suffix)) return
  const workspace = root.name.slice(0, -suffix.length).trim()
  if (!workspace) return
  const prefix = `${workspace} / `
  return {
    root,
    workspace,
    prefix,
    providers: providers.filter(
      (provider) => provider.integrationID === "opencode" && provider.name.startsWith(prefix),
    ),
  }
}

export function consoleProviderName(group: { prefix: string }, name: string) {
  return name.startsWith(group.prefix) ? name.slice(group.prefix.length) : name
}
