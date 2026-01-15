// Barrel exports for lib
export { AFBackendClient, afBackendClient, setAFApiKey, isAFAuthenticated } from './af-client'
export {
  OpenCodeClient,
  opencode,
  type SessionConfig,
  type Session,
  type MessagePart,
  type MessageInfo,
  type Message,
  type SessionMessageResponse,
  type SendMessageRequest,
  type ProviderModel,
  type Provider,
  type ProvidersResponse,
} from './opencode-client'
