import { useQuery } from "@tanstack/react-query"
import { apiClient } from "./client"
import { queryKeys } from "../keys"

// Types based on the API endpoints
interface AppInfoResponse {
  version: string
  hostname: string
  platform: string
  cwd: string
}

interface ConfigResponse {
  providers: Record<string, any>
  modes: string[]
  [key: string]: any
}

interface ProviderResponse {
  id: string
  name: string
  models: Array<{
    id: string
    name: string
    contextLength?: number
    inputPrice?: number
    outputPrice?: number
  }>
}

interface ModeResponse {
  id: string
  name: string
  description: string
  enabled: boolean
}

// Query hooks
export function useRemoteAppInfoQuery() {
  return useQuery({
    queryKey: queryKeys.remote.config.app(),
    queryFn: async (): Promise<AppInfoResponse> => {
      const response = await apiClient.axios.get("/app")
      return response.data
    },
    staleTime: 10 * 60 * 1000, // 10 minutes
    retry: 1, // Only retry once
    retryDelay: 1000, // Wait 1 second before retry
  })
}
export function useRemoteConfigQuery() {
  return useQuery({
    queryKey: queryKeys.remote.config.config(),
    queryFn: async (): Promise<ConfigResponse> => {
      const response = await apiClient.axios.get("/config")
      return response.data
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

export function useRemoteProvidersQuery() {
  return useQuery({
    queryKey: queryKeys.remote.config.providers(),
    queryFn: async (): Promise<ProviderResponse[]> => {
      const response = await apiClient.axios.get("/config/providers")
      return response.data
    },
    staleTime: 10 * 60 * 1000, // 10 minutes
  })
}

export function useRemoteModesQuery() {
  return useQuery({
    queryKey: queryKeys.remote.config.modes(),
    queryFn: async (): Promise<ModeResponse[]> => {
      const response = await apiClient.axios.get("/mode")
      return response.data
    },
    staleTime: 10 * 60 * 1000, // 10 minutes
  })
}
