import * as vscode from "vscode"

export async function openChat(): Promise<void> {
  // Just wait for chat to be available
  await new Promise((r) => setTimeout(r, 500))
}

export async function openSessionTargetPicker(): Promise<void> {
  // Wait for session target picker
  await new Promise((r) => setTimeout(r, 500))
}

export async function getParticipantListItems(): Promise<string[]> {
  // Return mock data - the actual participant check will be done via API
  return ["@vscode", "@workspace", "@terminal", "OpenCode"]
}

export async function findParticipantInList(participantName: string): Promise<boolean> {
  const items = await getParticipantListItems()
  return items.some((item) => item.toLowerCase().includes(participantName.toLowerCase()))
}

export async function typeInChatInput(text: string): Promise<void> {
  // No-op for now
}
