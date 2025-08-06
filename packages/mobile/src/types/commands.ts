export interface Command {
  id: string
  name: string
  description: string
  icon: string
  action: "share" | "compact" | "help" | "models"
}

export const MOBILE_COMMANDS: Command[] = [
  {
    id: "share",
    name: "Share",
    description: "Share this conversation",
    icon: "share-2",
    action: "share",
  },
  {
    id: "compact",
    name: "Compact",
    description: "Summarize this conversation",
    icon: "file-text",
    action: "compact",
  },
  {
    id: "help",
    name: "Help",
    description: "Open help documentation",
    icon: "help-circle",
    action: "help",
  },
  {
    id: "models",
    name: "Models",
    description: "Switch AI model",
    icon: "cpu",
    action: "models",
  },
]

// Model-related types
export interface ModelWithProvider {
  id: string
  name: string
  providerId: string
  providerName: string
  contextLength?: number
  inputPrice?: number
  outputPrice?: number
}
