export * from "./client.js"
export * from "./server.js"
export { uploadFiles, deleteFile, mkdirFile, renameFile } from "./file.js"
export type { UploadFilesOptions, UploadResult, DeleteFileOptions, MkdirOptions, RenameFileOptions } from "./file.js"

import { createOpencodeClient } from "./client.js"
import { createOpencodeServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export async function createOpencode(options?: ServerOptions) {
  const server = await createOpencodeServer({
    ...options,
  })

  const client = createOpencodeClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}
