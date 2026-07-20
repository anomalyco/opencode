export type MessageMetadataDisplayOptions = {
  readonly messageTimestamp?: boolean
  readonly toolTimestamp?: boolean
  readonly toolDuration?: boolean
  readonly toolStatus?: boolean
}

export type MessageDisplayOptions = {
  readonly metadata?: MessageMetadataDisplayOptions
}
