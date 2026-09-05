export type LegacyUserMessage = {
  id: string
  role: "user"
  metadata: {
    sessionID: string
    time: { created: number }
  }
  parts: readonly {
    type: string
    text?: string
    mediaType?: string
    filename?: string
    url?: string
  }[]
}

type ConvertedPart =
  | {
      id: string
      messageID: string
      sessionID: string
      type: "text"
      text: string
    }
  | {
      id: string
      messageID: string
      sessionID: string
      type: "file"
      mime: string
      filename?: string
      url: string
    }

export function fromLegacyUserMessage(v1: LegacyUserMessage) {
  return {
    id: v1.id,
    sessionID: v1.metadata.sessionID,
    role: "user",
    agent: "user",
    model: {
      providerID: "",
      modelID: "",
    },
    time: {
      created: v1.metadata.time.created,
    },
    parts: v1.parts.flatMap((part, index): ConvertedPart[] => {
      const base = {
        id: index.toString(),
        messageID: v1.id,
        sessionID: v1.metadata.sessionID,
      }
      if (part.type === "text" && part.text !== undefined) {
        return [
          {
            ...base,
            type: "text",
            text: part.text,
          },
        ]
      }
      if (part.type === "file" && part.mediaType !== undefined && part.url !== undefined) {
        return [
          {
            ...base,
            type: "file",
            mime: part.mediaType,
            filename: part.filename,
            url: part.url,
          },
        ]
      }
      return []
    }),
  }
}
