const contains = (consoleManagedProviders: string[] | ReadonlySet<string>, providerID: string) =>
  Array.isArray(consoleManagedProviders)
    ? consoleManagedProviders.includes(providerID)
    : consoleManagedProviders.has(providerID)

export const isConsoleManagedProvider = (consoleManagedProviders: string[] | ReadonlySet<string>, providerID: string) =>
  contains(consoleManagedProviders, providerID)
