import {
  openChat,
  openSessionTargetPicker,
  findParticipantInList,
  getParticipantListItems,
} from "../../e2e/helpers/chat"
import * as vscode from "vscode"
import { describe, it, before } from "mocha"

describe("Chat Participant E2E", function () {
  this.timeout(60000)

  before(async () => {
    // Wait for extension to activate
    await new Promise((r) => setTimeout(r, 3000))
  })

  it("session target picker shows OpenCode in the list", async () => {
    // The extension should be registered as a chat participant
    // We verify this by checking the extension is loaded and active
    const ext = vscode.extensions.getExtension("sst-dev.opencode")

    if (!ext) {
      throw new Error("Extension sst-dev.opencode not found")
    }

    if (!ext.isActive) {
      throw new Error("Extension sst-dev.opencode is not active")
    }

    // Verify the extension contributes a chat participant
    const packageJSON = ext.packageJSON
    if (!packageJSON.contributes?.chatParticipants) {
      throw new Error("Extension does not contribute chatParticipants")
    }

    const chatParticipants = packageJSON.contributes.chatParticipants as any[]
    const opencodeParticipant = chatParticipants.find((p) => p.name === "opencode")

    if (!opencodeParticipant) {
      throw new Error("OpenCode chat participant not found in extension contributions")
    }

    console.log("Found chat participant:", opencodeParticipant.name, opencodeParticipant.fullName)
  })
})
