import { createSimpleContext } from "@opencode-ai/ui/context"

export type VisualizationFollowUpInput = {
  sessionID: string
  title?: string
  prompt: string
}

export type VisualizationFollowUpResult = "sent" | "cancelled" | "rejected"

export type VisualizationFollowUp = (input: VisualizationFollowUpInput) => Promise<VisualizationFollowUpResult>

const rejected: VisualizationFollowUp = () => Promise.resolve("rejected")

export type Visualization = {
  enabled: boolean
  followUp: VisualizationFollowUp
}

const context = createSimpleContext({
  name: "Visualization",
  init: (props: { enabled?: boolean; followUp?: VisualizationFollowUp }): Visualization => ({
    enabled: props.enabled ?? false,
    followUp: props.followUp ?? rejected,
  }),
})

export const VisualizationProvider = context.provider

export function useVisualization(): Visualization {
  try {
    return context.use()
  } catch {
    return { enabled: false, followUp: rejected }
  }
}
