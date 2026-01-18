import { NamedError } from "@opencode-ai/util/error"
import z from "zod"

export namespace StorageProvider {
  export const NotFoundError = NamedError.create(
    "NotFoundError",
    z.object({
      message: z.string(),
    }),
  )

  export interface ListOptions {
    /**
     * Order by field (dot notation supported, e.g. "time.updated")
     * Direction: prepend "-" for descending (e.g. "-time.updated")
     */
    orderBy?: string
    /**
     * Limit number of results
     */
    limit?: number
  }

  export interface Interface {
    /**
     * Read data from storage
     * @throws NotFoundError if not found
     */
    read<T>(key: string[]): Promise<T>

    /**
     * Write data to storage
     */
    write<T>(key: string[], content: T): Promise<void>

    /**
     * Update data in storage
     * @throws NotFoundError if not found
     */
    update<T>(key: string[], fn: (draft: T) => void): Promise<T>

    /**
     * Remove data from storage
     */
    remove(key: string[]): Promise<void>

    /**
     * List keys with given prefix
     */
    list(prefix: string[], options?: ListOptions): Promise<string[][]>
  }
}
