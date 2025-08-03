import { useQuery } from "@tanstack/react-query"
import { apiClient } from "./client"
import { queryKeys } from "../keys"

// Types based on the API endpoints
interface FileResponse {
  path: string
  content: string
  mimeType?: string
  size?: number
  modifiedTime?: string
}

interface FileStatusResponse {
  files: Array<{
    path: string
    status: string
    staged: boolean
  }>
}

interface SearchResult {
  path: string
  line: number
  column: number
  content: string
  context?: string
}

interface FindFileResult {
  path: string
  score: number
}

interface FindSymbolResult {
  path: string
  symbol: string
  line: number
  column: number
  kind: string
}

// Query hooks
export function useRemoteFileContentQuery(path: string) {
  return useQuery({
    queryKey: queryKeys.remote.files.content(path),
    queryFn: async (): Promise<FileResponse> => {
      const response = await apiClient.axios.get("/file", {
        params: { path },
      })
      return response.data
    },
    enabled: !!path,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

export function useRemoteFileStatusQuery() {
  return useQuery({
    queryKey: queryKeys.remote.files.status(),
    queryFn: async (): Promise<FileStatusResponse> => {
      const response = await apiClient.axios.get("/file/status")
      return response.data
    },
    refetchInterval: 10000, // Refresh every 10 seconds
  })
}

export function useRemoteSearchQuery(pattern: string, enabled: boolean = true) {
  return useQuery({
    queryKey: queryKeys.remote.files.search(pattern),
    queryFn: async (): Promise<SearchResult[]> => {
      const response = await apiClient.axios.get("/find", {
        params: { pattern },
      })
      return response.data
    },
    enabled: enabled && !!pattern && pattern.length > 2,
    staleTime: 2 * 60 * 1000, // 2 minutes
  })
}

export function useRemoteFindFileQuery(query: string, enabled: boolean = true) {
  return useQuery({
    queryKey: queryKeys.remote.files.findFile(query),
    queryFn: async (): Promise<FindFileResult[]> => {
      const response = await apiClient.axios.get("/find/file", {
        params: { query },
      })
      return response.data
    },
    enabled: enabled && !!query && query.length > 1,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

export function useRemoteFindSymbolQuery(query: string, enabled: boolean = true) {
  return useQuery({
    queryKey: queryKeys.remote.files.findSymbol(query),
    queryFn: async (): Promise<FindSymbolResult[]> => {
      const response = await apiClient.axios.get("/find/symbol", {
        params: { query },
      })
      return response.data
    },
    enabled: enabled && !!query && query.length > 2,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}
