export const CONSOLE_MANAGED_ICON = "⌂"

const contains = (consoleManagedProviders: string[] | ReadonlySet<string>, providerID: string) =>
  Array.isArray(consoleManagedProviders)
    ? consoleManagedProviders.includes(providerID)
    : consoleManagedProviders.has(providerID)

export const isConsoleManagedProvider = (consoleManagedProviders: string[] | ReadonlySet<string>, providerID: string) =>
  contains(consoleManagedProviders, providerID)

export const consoleManagedProviderSuffix = (
  consoleManagedProviders: string[] | ReadonlySet<string>,
  providerID: string,
) => (contains(consoleManagedProviders, providerID) ? ` ${CONSOLE_MANAGED_ICON}` : "")

export const consoleManagedProviderLabel = (
  consoleManagedProviders: string[] | ReadonlySet<string>,
  providerID: string,
  providerName: string,
) => `${providerName}${consoleManagedProviderSuffix(consoleManagedProviders, providerID)}`
