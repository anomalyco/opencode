export { IMAdapter } from "../telegram"

export class DiscordAdapter implements IMAdapter {
  readonly type = "discord"
  readonly name = "Discord"

  constructor(private config: DiscordConfig) {}

  async initialize(): Promise<void> {
    console.log(`⚠️  Discord adapter not yet implemented`)
  }

  async start(): Promise<void> {}

  async stop(): Promise<void> {}

  onMessage(callback: any): void {}

  sendMessage(chatId: string, text: string, options?: any): Promise<void> {}

  presentQuestion(chatId: string, question: any): Promise<any> {
    throw new Error("Not implemented")
  }

  onToolUpdate(callback: any): void {}

  registerCommand(command: string, handler: any): void {}

  getFile(fileId: string): Promise<any> {
    throw new Error("Not implemented")
  }

  sendPhoto(chatId: string, source: string, options?: any): Promise<void> {}

  sendDocument(chatId: string, source: string, options?: any): Promise<void> {}

  sendFileParts(chatId: string, parts: any[]): Promise<void> {}
}

export interface DiscordConfig {
  token: string
  clientId: string
}
