import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "./client"
import { queryKeys } from "../keys"

// Types based on the API endpoints
interface MessageResponse {
  info: {
    id: string
    role: "user" | "assistant"
    sessionID: string
    time: {
      created: number
      completed?: number
    }
  }
  parts: MessagePartResponse[]
}

interface MessagePartResponse {
  id: string
  type: string
  text?: string
  synthetic?: boolean
  messageID: string
  sessionID: string
  time?: {
    start: number
    end: number
  }
}

interface SendMessageRequest {
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
    queryFn: async (): Promise<MessageResponse[]> => {
      console.log(`[RemoteMessages] Fetching messages for session ${sessionId}`)
      const response = await apiClient.axios.get(`/session/${sessionId}/message`)
      console.log(`[RemoteMessages] Raw response:`, {
        status: response.status,
        dataLength: response.data?.length || 0,
        firstItem: response.data?.[0]
          ? {
              hasInfo: !!response.data[0].info,
              hasParts: !!response.data[0].parts,
              partsCount: response.data[0].parts?.length || 0,
              structure: Object.keys(response.data[0]),
              infoId: response.data[0].info?.id,
              firstPartId: response.data[0].parts?.[0]?.id,
              firstPartType: response.data[0].parts?.[0]?.type,
              firstPartText: response.data[0].parts?.[0]?.text?.substring(0, 50),
            }
          : null,
      })
      return response.data
    },
    enabled: !!sessionId,
  })
}

export function useRemoteMessageQuery(sessionId: string, messageId: string) {
  return useQuery({
    queryKey: queryKeys.remote.messages.detail(messageId),
    queryFn: async (): Promise<MessageResponse> => {
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
    }): Promise<MessageResponse> => {
      const response = await apiClient.axios.post(`/session/${sessionId}/message`, data)
      return response.data
    },
    onSuccess: (_, { sessionId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.remote.messages.list(sessionId) })
    },
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
