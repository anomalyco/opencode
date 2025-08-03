import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "./client"
import { queryKeys } from "../keys"

// Types based on the API endpoints
interface MessageResponse {
  id: string
  sessionId: string
  role: "user" | "assistant"
  content: string
  timeCreated: string
  timeUpdated: string
  parts: MessagePartResponse[]
}

interface MessagePartResponse {
  id: string
  messageId: string
  type: string
  content: string
  timeCreated: string
  timeUpdated: string
}

interface SendMessageRequest {
  content: string
  attachments?: Array<{
    type: string
    content: string
  }>
}

// Query hooks
export function useRemoteMessagesQuery(sessionId: string) {
  return useQuery({
    queryKey: queryKeys.remote.messages.list(sessionId),
    queryFn: async (): Promise<MessageResponse[]> => {
      const response = await apiClient.axios.get(`/session/${sessionId}/message`)
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
