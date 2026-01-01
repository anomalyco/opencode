/**
 * Types for conversation export functionality
 */

export interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: string
}

export interface Conversation {
  id: string
  title: string
  messages: Message[]
  created_at: string
  updated_at: string
  project_uuid?: string
  source?: string
}

export type ExportFormat = "markdown" | "json"

export interface ExportOptions {
  format: ExportFormat
  selectedMessageIds?: Set<string>
  includeMetadata?: boolean
}

export interface ExportResult {
  content: string
  filename: string
  mimeType: string
}
