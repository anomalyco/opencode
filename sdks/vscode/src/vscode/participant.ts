import * as vscode from "vscode"
import { ActivationController } from "./activation"

export interface ChatParticipantMetadata {
  name: string
  fullName: string
  description: string
  isSticky: boolean
  commands: Array<{ name: string; description: string }>
}

export class OpenCodeChatParticipant {
  id = "sst-dev.opencode"
  aliases = ["opencode"]
  metadata: ChatParticipantMetadata = {
    name: "opencode",
    fullName: "OpenCode",
    description: "AI coding assistant powered by OpenCode",
    isSticky: true,
    commands: [
      { name: "new", description: "Start a new session" },
      { name: "clear", description: "Clear conversation" },
    ],
  }

  iconPath: vscode.Uri | undefined
  followupProvider: vscode.ChatFollowupProvider | undefined
  handler: vscode.ChatRequestHandler

  private participant: vscode.ChatParticipant | undefined
  private context: vscode.ExtensionContext
  private activationController: ActivationController
  private runner?: import("./handler").OpenCodeRequestHandler

  constructor(context: vscode.ExtensionContext, activationController: ActivationController) {
    this.context = context
    this.activationController = activationController
    this.handler = this.handleChatRequest.bind(this)
  }

  register(): void {
    if (this.participant) {
      this.participant.dispose()
    }

    const iconPath = vscode.Uri.file(this.context.asAbsolutePath("images/icon.png"))
    const followupProvider = this.createFollowupProvider()

    this.iconPath = iconPath
    this.followupProvider = followupProvider
    this.participant = vscode.chat.createChatParticipant(this.id, this.handler)
    this.participant.iconPath = iconPath
    this.participant.followupProvider = followupProvider
  }

  canHandleMention(mention: string): boolean {
    const cleanMention = mention.replace(/^@/, "")
    return cleanMention === this.metadata.name || cleanMention === this.id || this.aliases.includes(cleanMention)
  }

  private async handleChatRequest(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    response: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
  ): Promise<void> {
    if (request.command === "new") {
      this.runner?.reset()
      response.markdown("Starting a new session...")
      return
    }

    if (request.command === "clear") {
      this.runner?.reset()
      response.markdown("Clearing conversation...")
      return
    }

    this.activationController.onSessionStarted()

    try {
      const client = await this.activationController.ensureActivated()
      const { OpenCodeRequestHandler } = await import("./handler.js")
      if (!this.runner) this.runner = new OpenCodeRequestHandler(client)
      await this.runner.handle(request, context, response, token)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      response.markdown(`Sorry, I couldn't connect to OpenCode: ${message}`)
    } finally {
      this.activationController.onSessionEnded()
    }
  }

  private createFollowupProvider(): vscode.ChatFollowupProvider {
    return {
      provideFollowups: async (
        result: vscode.ChatResult,
        context: vscode.ChatContext,
        token: vscode.CancellationToken,
      ): Promise<vscode.ChatFollowup[]> => {
        return [
          { prompt: "Explain this code", label: "Explain code" },
          { prompt: "Refactor this", label: "Refactor" },
          { prompt: "Add tests", label: "Generate tests" },
        ]
      },
    }
  }

  dispose(): void {
    if (this.participant) {
      this.participant.dispose()
      this.participant = undefined
    }
  }
}

export default OpenCodeChatParticipant
