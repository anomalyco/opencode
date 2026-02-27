export { IMAdapter } from "../telegram"

export class WhatsAppAdapter implements IMAdapter {
  readonly type = "whatsapp"
  readonly name = "WhatsApp"

  constructor(private config: WhatsAppConfig) {}

  async initialize(): Promise<void> {
    console.log(`⚠️  WhatsApp adapter not yet implemented`)
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

export interface WhatsAppConfig {
  token: string
  phoneNumberId: string
}
