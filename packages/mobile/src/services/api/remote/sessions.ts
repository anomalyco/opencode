import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "./client"
import { queryKeys } from "../keys"

// Types based on the API endpoints from the mobile plan
interface SessionResponse {
  id: string
  parentId?: string
  title: string
  version: string
  shareUrl?: string
  timeCreated: string
  timeUpdated: string
  revertMessageId?: string
  revertPartId?: string
  revertSnapshot?: string
  revertDiff?: string
}

interface CreateSessionRequest {
  title?: string
  parentId?: string
}

interface ShareSessionResponse {
  shareUrl: string
}

// Query hooks
export function useRemoteSessionsQuery() {
  return useQuery({
    queryKey: queryKeys.remote.sessions.lists(),
    queryFn: async (): Promise<SessionResponse[]> => {
      const response = await apiClient.axios.get("/session")
      return response.data
    },
  })
}

export function useRemoteSessionQuery(id: string) {
  return useQuery({
    queryKey: queryKeys.remote.sessions.detail(id),
    queryFn: async (): Promise<SessionResponse> => {
      const response = await apiClient.axios.get(`/session/${id}`)
      return response.data
    },
    enabled: !!id,
  })
}

// Mutation hooks
export function useCreateRemoteSessionMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: CreateSessionRequest): Promise<SessionResponse> => {
      const response = await apiClient.axios.post("/session", data)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.remote.sessions.lists() })
    },
  })
}

export function useDeleteRemoteSessionMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await apiClient.axios.delete(`/session/${id}`)
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.remote.sessions.lists() })
      queryClient.removeQueries({ queryKey: queryKeys.remote.sessions.detail(id) })
    },
  })
}

export function useInitRemoteSessionMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await apiClient.axios.post(`/session/${id}/init`)
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.remote.sessions.detail(id) })
    },
  })
}

export function useAbortRemoteSessionMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await apiClient.axios.post(`/session/${id}/abort`)
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.remote.sessions.detail(id) })
    },
  })
}

export function useShareRemoteSessionMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string): Promise<ShareSessionResponse> => {
      const response = await apiClient.axios.post(`/session/${id}/share`)
      return response.data
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.remote.sessions.detail(id) })
    },
  })
}

export function useUnshareRemoteSessionMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await apiClient.axios.delete(`/session/${id}/share`)
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.remote.sessions.detail(id) })
    },
  })
}
