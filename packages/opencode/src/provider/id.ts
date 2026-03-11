export function isOpenAIProviderID(providerID: string) {
  return providerID === "openai" || providerID.startsWith("openai-")
}