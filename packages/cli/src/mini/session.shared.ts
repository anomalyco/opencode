import type { SessionMessageInfo, SessionMessageUser } from "@opencode-ai/client/promise"
import { promptCopy, promptSame } from "./prompt.shared"
import type { RunInput, RunPrompt } from "./types"

const LIMIT = 200

export type SessionMessages = SessionMessageInfo[]

type Turn = {
  prompt: RunPrompt
  provider: string | undefined
  model: string | undefined
  variant: string | undefined
}

export type RunSession = {
  first: boolean
  turns: Turn[]
  model?: NonNullable<RunInput["model"]>
  variant?: string
}

function messagePrompt(message: SessionMessageUser): RunPrompt {
  return {
    text: message.text,
    parts: [
      ...(message.files ?? []).map((file) => ({
        type: "file" as const,
        url: file.source.type === "uri" ? file.source.uri : `data:${file.mime};base64,${file.data}`,
        mime: file.mime,
        filename: file.name,
        source: file.mention
          ? {
              type: "file",
              path: file.name ?? (file.source.type === "uri" ? file.source.uri : "inline attachment"),
              text: { start: file.mention.start, end: file.mention.end, value: file.mention.text },
            }
          : undefined,
      })),
      ...(message.agents ?? []).map((agent) => ({
        type: "agent" as const,
        name: agent.name,
        source: agent.mention
          ? { start: agent.mention.start, end: agent.mention.end, value: agent.mention.text }
          : undefined,
      })),
    ],
  }
}

export function createSession(messages: SessionMessages): RunSession {
  return {
    first: messages.length === 0,
    turns: messages.flatMap((message) =>
      message.type === "user"
        ? [{ prompt: messagePrompt(message), provider: undefined, model: undefined, variant: undefined }]
        : [],
    ),
  }
}

export async function resolveCurrentSession(
  sdk: RunInput["sdk"],
  sessionID: string,
  limit = LIMIT,
): Promise<RunSession> {
  const [response, session] = await Promise.all([
    sdk.message.list({ sessionID, limit, order: "desc" }),
    sdk.session.get({ sessionID }),
  ])
  const current = createSession(response.data.toReversed())
  return {
    ...current,
    turns: current.turns.map((turn) => ({
      ...turn,
      provider: session.model?.providerID,
      model: session.model?.id,
      variant: session.model?.variant,
    })),
    ...(session.model && {
      model: { providerID: session.model.providerID, modelID: session.model.id },
      variant: session.model.variant,
    }),
  }
}

export function sessionHistory(session: RunSession, limit = LIMIT): RunPrompt[] {
  return session.turns
    .map((turn) => turn.prompt)
    .filter((prompt) => prompt.text.trim())
    .filter((prompt, index, prompts) => index === 0 || !promptSame(prompts[index - 1], prompt))
    .map(promptCopy)
    .slice(-limit)
}

export function sessionVariant(session: RunSession, model: RunInput["model"]): string | undefined {
  if (!model) return
  if (session.model?.providerID === model.providerID && session.model.modelID === model.modelID) return session.variant

  return session.turns.findLast((turn) => turn.provider === model.providerID && turn.model === model.modelID)?.variant
}
