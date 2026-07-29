export { ClientError, type ClientErrorReason } from "../promise/generated/client-error.js"
export * from "../promise/generated/types.js"
export type {
  AgentApi,
  CatalogApi,
  CommandApi,
  EventApi,
  IntegrationApi,
  ModelApi,
  PluginApi,
  ProviderApi,
  ReferenceApi,
  WebSearchApi,
  SessionApi,
  SkillApi,
} from "../promise/api.js"
export * as OpenCode from "./client.js"
export { Browser } from "@opencode-ai/schema/browser"
export { BrowserDriver, BrowserDriverError } from "./browser/driver.js"
export type {
  BrowserDriverContext,
  BrowserDriverFactory,
  BrowserDriverInstance,
  BrowserProxy,
} from "./browser/driver.js"
export type { ChromiumController, ChromiumDriver, ChromiumPort } from "./browser/chromium.js"
export type {
  BrowserAttachment,
  BrowserAttachOptions,
  BrowserClient,
  BrowserRegistration,
  BrowserRegisterOptions,
} from "./browser/client.js"
export type { EventSubscribeOutput as OpenCodeEvent } from "../promise/generated/types.js"
export type OpenCodeClient = ReturnType<typeof import("./client.js").make>
