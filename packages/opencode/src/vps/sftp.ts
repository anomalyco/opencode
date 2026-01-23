import type { SFTPWrapper, FileEntry, Stats } from "ssh2"
import { VpsConnection } from "./connection"
import { Log } from "../util/log"
import z from "zod"
import path from "path"

export namespace VpsSftp {
  const log = Log.create({ service: "vps.sftp" })

  export const FileInfo = z
    .object({
      name: z.string(),
      path: z.string(),
      isDirectory: z.boolean(),
      isFile: z.boolean(),
      isSymlink: z.boolean(),
      size: z.number(),
      modified: z.date(),
      permissions: z.number(),
    })
    .meta({ ref: "VpsSftpFileInfo" })

  export type FileInfo = z.infer<typeof FileInfo>

  /**
   * Read a file from the remote server
   */
  export async function readFile(vpsId: string, remotePath: string): Promise<string> {
    const sftp = await VpsConnection.getSftp(vpsId)
    log.info("Reading remote file", { vpsId, path: remotePath })

    return new Promise((resolve, reject) => {
      let content = ""
      const stream = sftp.createReadStream(remotePath, { encoding: "utf-8" })

      stream.on("data", (chunk: string | Buffer) => {
        content += chunk.toString()
      })

      stream.on("end", () => {
        log.info("File read complete", { vpsId, path: remotePath, bytes: content.length })
        resolve(content)
      })

      stream.on("error", (err: Error) => {
        log.error("Failed to read file", { vpsId, path: remotePath, error: err.message })
        reject(new Error(`Failed to read remote file ${remotePath}: ${err.message}`))
      })
    })
  }

  /**
   * Read a file as binary buffer from the remote server
   */
  export async function readFileBuffer(vpsId: string, remotePath: string): Promise<Buffer> {
    const sftp = await VpsConnection.getSftp(vpsId)

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      const stream = sftp.createReadStream(remotePath)

      stream.on("data", (chunk: Buffer) => {
        chunks.push(chunk)
      })

      stream.on("end", () => {
        resolve(Buffer.concat(chunks))
      })

      stream.on("error", (err: Error) => {
        reject(new Error(`Failed to read remote file ${remotePath}: ${err.message}`))
      })
    })
  }

  /**
   * Write a file to the remote server
   */
  export async function writeFile(vpsId: string, remotePath: string, content: string | Buffer): Promise<void> {
    const sftp = await VpsConnection.getSftp(vpsId)
    log.info("Writing remote file", { vpsId, path: remotePath, bytes: content.length })

    return new Promise((resolve, reject) => {
      const stream = sftp.createWriteStream(remotePath)

      stream.on("close", () => {
        log.info("File write complete", { vpsId, path: remotePath })
        resolve()
      })

      stream.on("error", (err: Error) => {
        log.error("Failed to write file", { vpsId, path: remotePath, error: err.message })
        reject(new Error(`Failed to write remote file ${remotePath}: ${err.message}`))
      })

      if (typeof content === "string") {
        stream.end(content, "utf-8")
      } else {
        stream.end(content)
      }
    })
  }

  /**
   * List directory contents
   */
  export async function listDirectory(vpsId: string, remotePath: string): Promise<FileInfo[]> {
    const sftp = await VpsConnection.getSftp(vpsId)
    log.info("Listing remote directory", { vpsId, path: remotePath })

    return new Promise((resolve, reject) => {
      sftp.readdir(remotePath, (err, list) => {
        if (err) {
          log.error("Failed to list directory", { vpsId, path: remotePath, error: err.message })
          reject(new Error(`Failed to list remote directory ${remotePath}: ${err.message}`))
          return
        }

        const files = list.map((item: FileEntry): FileInfo => ({
          name: item.filename,
          path: path.posix.join(remotePath, item.filename),
          isDirectory: (item.attrs.mode! & 0o40000) !== 0,
          isFile: (item.attrs.mode! & 0o100000) !== 0,
          isSymlink: (item.attrs.mode! & 0o120000) === 0o120000,
          size: item.attrs.size!,
          modified: new Date(item.attrs.mtime! * 1000),
          permissions: item.attrs.mode!,
        }))

        log.info("Directory listed", { vpsId, path: remotePath, count: files.length })
        resolve(files)
      })
    })
  }

  /**
   * Get file/directory stats
   */
  export async function stat(vpsId: string, remotePath: string): Promise<FileInfo | null> {
    const sftp = await VpsConnection.getSftp(vpsId)

    return new Promise((resolve, reject) => {
      sftp.stat(remotePath, (err, stats) => {
        if (err) {
          if ((err as any).code === 2) {
            // ENOENT - file not found
            resolve(null)
            return
          }
          reject(new Error(`Failed to stat remote path ${remotePath}: ${err.message}`))
          return
        }

        resolve({
          name: path.posix.basename(remotePath),
          path: remotePath,
          isDirectory: (stats.mode! & 0o40000) !== 0,
          isFile: (stats.mode! & 0o100000) !== 0,
          isSymlink: (stats.mode! & 0o120000) === 0o120000,
          size: stats.size!,
          modified: new Date(stats.mtime! * 1000),
          permissions: stats.mode!,
        })
      })
    })
  }

  /**
   * Check if a file exists
   */
  export async function exists(vpsId: string, remotePath: string): Promise<boolean> {
    const info = await stat(vpsId, remotePath)
    return info !== null
  }

  /**
   * Create a directory
   */
  export async function mkdir(vpsId: string, remotePath: string, recursive = false): Promise<void> {
    const sftp = await VpsConnection.getSftp(vpsId)
    log.info("Creating remote directory", { vpsId, path: remotePath, recursive })

    if (recursive) {
      // Create parent directories recursively
      const parts = remotePath.split("/").filter(Boolean)
      let current = remotePath.startsWith("/") ? "" : ""

      for (const part of parts) {
        current = current ? path.posix.join(current, part) : (remotePath.startsWith("/") ? "/" + part : part)
        const info = await stat(vpsId, current)
        if (!info) {
          await mkdirSingle(sftp, current)
        }
      }
    } else {
      await mkdirSingle(sftp, remotePath)
    }
  }

  async function mkdirSingle(sftp: SFTPWrapper, remotePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      sftp.mkdir(remotePath, (err) => {
        if (err && (err as any).code !== 4) {
          // code 4 is EEXIST
          reject(new Error(`Failed to create remote directory ${remotePath}: ${err.message}`))
          return
        }
        resolve()
      })
    })
  }

  /**
   * Remove a file
   */
  export async function unlink(vpsId: string, remotePath: string): Promise<void> {
    const sftp = await VpsConnection.getSftp(vpsId)
    log.info("Removing remote file", { vpsId, path: remotePath })

    return new Promise((resolve, reject) => {
      sftp.unlink(remotePath, (err) => {
        if (err) {
          reject(new Error(`Failed to remove remote file ${remotePath}: ${err.message}`))
          return
        }
        resolve()
      })
    })
  }

  /**
   * Remove a directory
   */
  export async function rmdir(vpsId: string, remotePath: string): Promise<void> {
    const sftp = await VpsConnection.getSftp(vpsId)
    log.info("Removing remote directory", { vpsId, path: remotePath })

    return new Promise((resolve, reject) => {
      sftp.rmdir(remotePath, (err) => {
        if (err) {
          reject(new Error(`Failed to remove remote directory ${remotePath}: ${err.message}`))
          return
        }
        resolve()
      })
    })
  }

  /**
   * Rename/move a file or directory
   */
  export async function rename(vpsId: string, oldPath: string, newPath: string): Promise<void> {
    const sftp = await VpsConnection.getSftp(vpsId)
    log.info("Renaming remote path", { vpsId, from: oldPath, to: newPath })

    return new Promise((resolve, reject) => {
      sftp.rename(oldPath, newPath, (err) => {
        if (err) {
          reject(new Error(`Failed to rename ${oldPath} to ${newPath}: ${err.message}`))
          return
        }
        resolve()
      })
    })
  }

  /**
   * Change file permissions
   */
  export async function chmod(vpsId: string, remotePath: string, mode: number): Promise<void> {
    const sftp = await VpsConnection.getSftp(vpsId)

    return new Promise((resolve, reject) => {
      sftp.chmod(remotePath, mode, (err) => {
        if (err) {
          reject(new Error(`Failed to chmod ${remotePath}: ${err.message}`))
          return
        }
        resolve()
      })
    })
  }

  /**
   * Get real path (resolve symlinks)
   */
  export async function realpath(vpsId: string, remotePath: string): Promise<string> {
    const sftp = await VpsConnection.getSftp(vpsId)

    return new Promise((resolve, reject) => {
      sftp.realpath(remotePath, (err, absPath) => {
        if (err) {
          reject(new Error(`Failed to resolve path ${remotePath}: ${err.message}`))
          return
        }
        resolve(absPath)
      })
    })
  }

  /**
   * Glob pattern matching on remote server using find command
   */
  export async function glob(vpsId: string, pattern: string, basePath = "."): Promise<string[]> {
    // Use remote find command for glob matching
    const command = `find ${basePath} -name "${pattern}" -type f 2>/dev/null || true`

    try {
      const result = await VpsConnection.exec(vpsId, command)
      const files = result.stdout
        .trim()
        .split("\n")
        .filter((f) => f.length > 0)
      return files
    } catch (err: any) {
      log.error("Remote glob failed", { vpsId, pattern, error: err.message })
      return []
    }
  }

  /**
   * Search file contents using grep on remote server
   */
  export async function grep(
    vpsId: string,
    pattern: string,
    basePath = ".",
    options?: { include?: string; maxResults?: number }
  ): Promise<Array<{ file: string; line: number; content: string }>> {
    let command = `grep -rn "${pattern}" ${basePath}`

    if (options?.include) {
      command += ` --include="${options.include}"`
    }

    if (options?.maxResults) {
      command += ` | head -n ${options.maxResults}`
    }

    command += " 2>/dev/null || true"

    try {
      const result = await VpsConnection.exec(vpsId, command)
      const matches: Array<{ file: string; line: number; content: string }> = []

      for (const line of result.stdout.trim().split("\n")) {
        if (!line) continue
        const match = line.match(/^([^:]+):(\d+):(.*)$/)
        if (match) {
          matches.push({
            file: match[1],
            line: parseInt(match[2], 10),
            content: match[3],
          })
        }
      }

      return matches
    } catch (err: any) {
      log.error("Remote grep failed", { vpsId, pattern, error: err.message })
      return []
    }
  }
}
