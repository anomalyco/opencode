export interface IMAdapter {
  readonly type: string
  readonly name: string

  initialize(): Promise<void>
  start(): Promise<void>
  stop(): Promise<void>

  onMessage(callback: MessageCallback): void
  sendMessage(chatId: string, text: string, options?: MessageOptions): Promise<void>

  presentQuestion(chatId: string, question: Question): Promise<QuestionResponse>
  onToolUpdate(callback: ToolUpdateCallback): void

  registerCommand(command: string, handler: CommandHandler): void

  getFile(fileId: string): Promise<any>
  sendPhoto(chatId: string, source: string, options?: any): Promise<void>
  sendDocument(chatId: string, source: string, options?: any): Promise<void>
  sendFileParts(chatId: string, parts: any[]): Promise<void>
}

export interface MessageCallback {
  (message: IMMessage): void | Promise<void>
}

export interface IMMessage {
  id: string
  chatId: string
  text: string
  userId?: string
  metadata?: Record<string, unknown>
}

export interface MessageOptions {
  parseMode?: "Markdown" | "HTML"
  replyMarkup?: InlineKeyboard | Buttons
}

export interface Question {
  id: string
  header: string
  text: string
  options: QuestionOption[]
  type: "blocking" | "async"
}

export interface QuestionOption {
  label: string
  description: string
}

export interface QuestionResponse {
  answered: boolean
  answers?: string[]
  rejected?: boolean
}

export interface ToolUpdate {
  sessionId: string
  tool: string
  title: string
  status: string
}

export interface ToolUpdateCallback {
  (update: ToolUpdate): void | Promise<void>
}

export interface CommandHandler {
  (chatId: string, args: string[], msg: any): void | Promise<void>
}

export interface InlineKeyboard {
  inline_keyboard: any[][]
}

export interface Buttons {
  keyboard: any[][]
}

export type MediaType = "photo" | "document" | "audio" | "video" | "voice" | "video_note"
