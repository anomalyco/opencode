import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { eq } from "drizzle-orm"
import db from "@/db"
import { fileCache } from "@/db/schema"
import { queryKeys } from "../keys"
import type { FileCache } from "@/db/types"

// Raw database operations (internal use)
class FileRepository {
  async getFileCache(path: string) {
    const result = await db.select().from(fileCache).where(eq(fileCache.path, path)).limit(1)
    return result[0] || null
  }

  async setFileCache(cache: Omit<FileCache, "cachedAt" | "lastAccessed">) {
    return await db
      .insert(fileCache)
      .values({
        ...cache,
        cachedAt: new Date(),
        lastAccessed: new Date(),
      })
      .onConflictDoUpdate({
        target: fileCache.path,
        set: {
          content: cache.content,
          size: cache.size,
          serverModifiedTime: cache.serverModifiedTime,
          lastAccessed: new Date(),
        },
      })
      .returning()
  }

  async updateFileCacheAccess(path: string) {
    const current = await this.getFileCache(path)
    if (current) {
      return await db
        .update(fileCache)
        .set({
          lastAccessed: new Date(),
          accessCount: (current.accessCount || 0) + 1,
        })
        .where(eq(fileCache.path, path))
    }
  }

  async deleteFileCache(path: string) {
    return await db.delete(fileCache).where(eq(fileCache.path, path))
  }

  async clearFileCache() {
    return await db.delete(fileCache)
  }

  async getCachedFiles() {
    return await db.select().from(fileCache)
  }

  async getStorageStats() {
    const files = await this.getCachedFiles()
    const totalSize = files.reduce((sum, file) => sum + (file.size || 0), 0)

    return {
      fileCount: files.length,
      totalSize,
      oldestCache: files.reduce(
        (oldest, file) => (!oldest || file.cachedAt < oldest ? file.cachedAt : oldest),
        null as Date | null,
      ),
      newestCache: files.reduce(
        (newest, file) => (!newest || file.cachedAt > newest ? file.cachedAt : newest),
        null as Date | null,
      ),
    }
  }
}

const fileRepo = new FileRepository()

// TanStack Query hooks for local file cache
export function useLocalFileCacheQuery(path: string) {
  return useQuery({
    queryKey: queryKeys.local.files.detail(path),
    queryFn: () => fileRepo.getFileCache(path),
    enabled: !!path,
  })
}

export function useLocalCachedFilesQuery() {
  return useQuery({
    queryKey: queryKeys.local.files.lists(),
    queryFn: () => fileRepo.getCachedFiles(),
  })
}

export function useLocalStorageStatsQuery() {
  return useQuery({
    queryKey: queryKeys.local.files.stats(),
    queryFn: () => fileRepo.getStorageStats(),
    staleTime: 30 * 1000, // 30 seconds
  })
}

// Mutations for local file cache
export function useSetLocalFileCacheMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (cache: Omit<FileCache, "cachedAt" | "lastAccessed">) => fileRepo.setFileCache(cache),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.local.files.lists() })
      queryClient.invalidateQueries({ queryKey: queryKeys.local.files.detail(variables.path) })
      queryClient.invalidateQueries({ queryKey: queryKeys.local.files.stats() })
    },
  })
}

export function useUpdateFileCacheAccessMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (path: string) => fileRepo.updateFileCacheAccess(path),
    onSuccess: (_, path) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.local.files.detail(path) })
      queryClient.invalidateQueries({ queryKey: queryKeys.local.files.stats() })
    },
  })
}

export function useDeleteLocalFileCacheMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (path: string) => fileRepo.deleteFileCache(path),
    onSuccess: (_, path) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.local.files.lists() })
      queryClient.removeQueries({ queryKey: queryKeys.local.files.detail(path) })
      queryClient.invalidateQueries({ queryKey: queryKeys.local.files.stats() })
    },
  })
}

export function useClearLocalFileCacheMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => fileRepo.clearFileCache(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.local.files.all })
    },
  })
}
