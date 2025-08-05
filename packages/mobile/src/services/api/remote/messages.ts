import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "./client"
import { queryKeys } from "../keys"

// Complete types matching the API schema
export interface MessageError {
  name: "ProviderAuthError" | "UnknownError" | "MessageOutputLengthError" | "MessageAbortedError"
  data: any
}

export interface TokenInfo {
  input: number
  output: number
  reasoning: number
  cache: {
    read: number
    write: number
  }
}

interface MessageTime {
  created: number
  completed?: number
}

interface UserMessage {
  id: string
  sessionID: string
  role: "user"
  time: MessageTime
}

interface AssistantMessage {
  id: string
  sessionID: string
  role: "assistant"
  time: MessageTime
  error?: MessageError
  system?: string[]
  modelID?: string
  providerID?: string
  mode?: string
  path?: {
    cwd: string
    root: string
  }
  summary?: boolean
  cost?: number
  tokens?: TokenInfo
}

export type Message = UserMessage | AssistantMessage

interface FilePartSourceText {
  value: string
  start: number
  end: number
}

interface Range {
  start: {
    line: number
    character: number
  }
  end: {
    line: number
    character: number
  }
}

interface FileSource {
  text: FilePartSourceText
  type: "file"
  path: string
}

interface SymbolSource {
  text: FilePartSourceText
  type: "symbol"
  path: string
  range: Range
  name: string
  kind: number
}

type FilePartSource = FileSource | SymbolSource

interface PartTime {
  start: number
  end?: number
}

interface ToolStatePending {
  status: "pending"
}

interface ToolStateRunning {
  status: "running"
  input?: any
  title?: string
  metadata?: Record<string, any>
  time: {
    start: number
  }
}

interface ToolStateCompleted {
  status: "completed"
  input: Record<string, any>
  output: string
  title: string
  metadata: Record<string, any>
  time: {
    start: number
    end: number
  }
}

interface ToolStateError {
  status: "error"
  input: Record<string, any>
  error: string
  time: {
    start: number
    end: number
  }
}

export type ToolState = ToolStatePending | ToolStateRunning | ToolStateCompleted | ToolStateError

interface TextPart {
  id: string
  sessionID: string
  messageID: string
  type: "text"
  text: string
  synthetic?: boolean
  time?: PartTime
}

interface FilePart {
  id: string
  sessionID: string
  messageID: string
  type: "file"
  mime: string
  filename?: string
  url: string
  source?: FilePartSource
}

interface ToolPart {
  id: string
  sessionID: string
  messageID: string
  type: "tool"
  callID: string
  tool: string
  state: ToolState
}

interface StepStartPart {
  id: string
  sessionID: string
  messageID: string
  type: "step-start"
}

interface StepFinishPart {
  id: string
  sessionID: string
  messageID: string
  type: "step-finish"
  cost: number
  tokens: TokenInfo
}

interface SnapshotPart {
  id: string
  sessionID: string
  messageID: string
  type: "snapshot"
  snapshot: string
}

interface PatchPart {
  id: string
  sessionID: string
  messageID: string
  type: "patch"
  hash: string
  files: string[]
}

export type Part = TextPart | FilePart | ToolPart | StepStartPart | StepFinishPart | SnapshotPart | PatchPart

export interface SessionMessagesResponse {
  info: Message
  parts: Part[]
}

export interface SendMessageRequest {
  providerID: string
  modelID: string
  parts: {
    type: "text"
    text: string
  }[]
  messageID?: string
  mode?: string
  system?: string
  tools?: Record<string, boolean>
}

// Query hooks
export function useRemoteMessagesQuery(sessionId: string) {
  return useQuery({
    queryKey: queryKeys.remote.messages.list(sessionId),
    queryFn: async (): Promise<SessionMessagesResponse[]> => {
      console.log("calling remote query")
      const response = await apiClient.axios.get(`/session/${sessionId}/message`)
      // console.log("response", response)
      return response.data
    },
    enabled: !!sessionId,
  })
}

export function useRemoteMessageQuery(sessionId: string, messageId: string) {
  return useQuery({
    queryKey: queryKeys.remote.messages.detail(messageId),
    queryFn: async (): Promise<SessionMessagesResponse> => {
      const response = await apiClient.axios.get(`/session/${sessionId}/message/${messageId}`)
      return response.data
    },
    enabled: !!sessionId && !!messageId,
  })
}

// Mutation hooks
export function useSendRemoteMessageMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      sessionId,
      data,
    }: {
      sessionId: string
      data: SendMessageRequest
    }): Promise<SessionMessagesResponse> => {
      // Increase timeout to reduce false timeout errors
      // The actual response comes through SSE, but we still need the HTTP response
      const response = await apiClient.axios.post(`/session/${sessionId}/message`, data, {
        timeout: 15000, // 15 second timeout instead of 5s
      })
      return response.data
    },
    onSuccess: (_, { sessionId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.remote.messages.list(sessionId) })
    },
    // Disable retries for message sending to prevent duplicate messages
    // If the request fails, the user can manually retry by sending again
    retry: false,
  })
}

export function useRevertRemoteMessageMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      sessionId,
      messageId,
      partId,
    }: {
      sessionId: string
      messageId?: string
      partId?: string
    }): Promise<void> => {
      const params = new URLSearchParams()
      if (messageId) params.append("messageID", messageId)
      if (partId) params.append("partID", partId)

      await apiClient.axios.post(`/session/${sessionId}/revert?${params}`)
    },
    onSuccess: (_, { sessionId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.remote.messages.list(sessionId) })
    },
  })
}

export function useUnrevertRemoteMessageMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (sessionId: string): Promise<void> => {
      await apiClient.axios.post(`/session/${sessionId}/unrevert`)
    },
    onSuccess: (_, sessionId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.remote.messages.list(sessionId) })
    },
  })
}
