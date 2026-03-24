// Generic stubs for native/server-only dependencies that are not active in browser mode.

export const __stub = true
export const VERSION = "browser-stub"

function stubFunction<T = any>(_input?: unknown): T {
  return undefined as T
}

function stubProviderFactory() {
  return {
    chat: stubFunction,
    responses: stubFunction,
    languageModel: stubFunction,
  }
}

export class UnauthorizedError extends Error {}
export class Client {}
export class StreamableHTTPClientTransport {}
export class SSEClientTransport {}
export class StdioClientTransport {}
export class StreamMessageReader {}
export class StreamMessageWriter {}
export class GoogleAuth {}
export class Bonjour {
  public publish() {
    return { stop() {} }
  }
  public unpublishAll() {}
  public destroy() {}
}
export class BlobReader {
  constructor(_blob: Blob) {}
}
export class BlobWriter {
  constructor(_type?: string) {}
}
export class ZipReader {
  constructor(_reader: unknown) {}
  async getEntries() {
    return []
  }
  async close() {}
}
export class GitLabWorkflowLanguageModel {}

export const OAuthClientProvider = class {}
export const gitlabAuthPlugin = async () => ({})

export const CallToolResultSchema = {}
export const ToolListChangedNotificationSchema = {}

export function createMessageConnection() {
  return {
    listen() {},
    dispose() {},
    onNotification() {},
    onRequest() {},
    sendRequest: async () => undefined,
    sendNotification() {},
  }
}

export function createAmazonBedrock() {
  return stubProviderFactory()
}
export function createAnthropic() {
  return stubProviderFactory()
}
export function createAzure() {
  return stubProviderFactory()
}
export function createGoogleGenerativeAI() {
  return stubProviderFactory()
}
export function createVertex() {
  return stubProviderFactory()
}
export function createVertexAnthropic() {
  return stubProviderFactory()
}
export function createOpenAI() {
  return stubProviderFactory()
}
export function createOpenAICompatible() {
  return stubProviderFactory()
}
export function createOpenRouter() {
  return stubProviderFactory()
}
export function createXai() {
  return stubProviderFactory()
}
export function createMistral() {
  return stubProviderFactory()
}
export function createGroq() {
  return stubProviderFactory()
}
export function createDeepInfra() {
  return stubProviderFactory()
}
export function createCerebras() {
  return stubProviderFactory()
}
export function createCohere() {
  return stubProviderFactory()
}
export function createGateway() {
  return stubProviderFactory()
}
export function createTogetherAI() {
  return stubProviderFactory()
}
export function createPerplexity() {
  return stubProviderFactory()
}
export function createVercel() {
  return stubProviderFactory()
}
export function createGitLab() {
  return stubProviderFactory()
}

export function discoverWorkflowModels() {
  return Promise.resolve({})
}
export function isWorkflowModel() {
  return false
}
export function fromNodeProviderChain() {
  return async () => ({})
}

const fuzzysortDefault = {
  go: () => [],
  single: () => null,
  prepare: (value: string) => value,
}

export const go = fuzzysortDefault.go
export const single = fuzzysortDefault.single
export const prepare = fuzzysortDefault.prepare

export default fuzzysortDefault
