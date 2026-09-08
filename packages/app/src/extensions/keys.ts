export const extensionTabKey = (plugin: string, id: string) => `extension:${plugin}:${id}`
export const isExtensionTab = (id: string | undefined) => !!id?.startsWith("extension:")
