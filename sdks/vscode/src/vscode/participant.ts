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
  id = "opencode"
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

  constructor(context: vscode.ExtensionContext, activationController: ActivationController) {
    this.context = context
    this.activationController = activationController
    this.handler = this.handleChatRequest.bind(this)
  }

  register(): void {
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
    return cleanMention === this.id
  }

  private async handleChatRequest(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    response: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
  ): Promise<void> {
    // Track session lifecycle
    this.activationController.onSessionStarted()

    try {
      // Ensure ACP is activated on first message
      const client = await this.activationController.ensureActivated()

      // Handle slash commands
      if (request.command === "new") {
        response.markdown("Starting a new session...")
        return
      }

      if (request.command === "clear") {
        response.markdown("Clearing conversation...")
        return
      }

      // Delegate to the request handler for actual processing
      const { OpenCodeRequestHandler } = await import("./handler.js")
      const handler = new OpenCodeRequestHandler(client)
      await handler.handle(request, context, response, token)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      response.markdown(`Sorry, I couldn't connect to OpenCode: ${message}`)
    } finally {
      // Signal session end
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
