// The active agent's configured model, for the mini footer.
//
// The server resolves the agent's frontmatter `model:` per step when no
// explicit model is set, but mini never sees it: the session record stores
// only the explicit model, so the footer falls back to the server default
// and shows the wrong model. These helpers resolve the agent model from the
// agent catalog instead, so the footer can display the model actually used.
//
// The resolved model is display-only. It is never written onto the session
// and never becomes the sent model on its own — requests keep resolving
// server-side. Only an explicit user action (picking a model or a variant)
// promotes a model into the sent model.
import { fitVariant } from "./variant.shared"
import type { RunAgent, RunInput, RunProvider } from "./types"

export type AgentModel = {
  model: NonNullable<RunInput["model"]>
  variant: string | undefined
}

// The agent's configured model, when the provider catalog actually offers
// it. Returns undefined when the agent has no model, or when its model is
// not in the catalog (provider not connected) — the caller then falls back
// to the server default.
export function resolveAgentModel(
  agents: RunAgent[],
  agentID: string | undefined,
  providers: RunProvider[],
): AgentModel | undefined {
  const ref = agents.find((item) => item.id === agentID)?.model
  if (!ref) return undefined
  const entry = providers.find((item) => item.id === ref.providerID)?.models?.[ref.modelID]
  if (!entry) return undefined
  return {
    model: { providerID: ref.providerID, modelID: ref.modelID },
    variant: fitVariant(ref.variant, Object.keys(entry.variants ?? {})),
  }
}

// The agent's configured model reference, whether or not the catalog offers
// it — used to tell a genuinely unavailable model apart from an agent that
// simply has no model.
export function agentModelRef(agents: RunAgent[], agentID: string | undefined): RunAgent["model"] {
  return agents.find((item) => item.id === agentID)?.model
}
