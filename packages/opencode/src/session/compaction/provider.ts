export interface CompactionProvider {
  readonly name: string
  compact(input: CompactionInput): Promise<CompactionResult>
}

export interface CompactionMessage {
  role: string
  content: string
}

export interface CompactionInput {
  messages: CompactionMessage[]
  compressionRatio: number
}

export interface CompactionResult {
  messages: CompactionMessage[]
}
