import type { IntegrationDraft, IntegrationMethod, IntegrationMethodRegistration } from "../effect/integration.js"
import type { Hooks } from "./registration.js"

export type { IntegrationDraft, IntegrationMethod, IntegrationMethodRegistration }

export type IntegrationHooks = Hooks<{
  transform: IntegrationDraft
}>
