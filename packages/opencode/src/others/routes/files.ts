/**
 * 文件管理路由
 * 处理文件和目录的增删改查、移动、上传、下载等请求
 */

import path from "path"
import { Hono, type Context } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import {
  listFiles,
  readFile,
  writeFile,
  createFile,
  createDirectory,
  deleteFile,
  moveFile,
  uploadFile,
  readFileBuffer,
  validatePath,
  type FileNode,
} from "../file-manager"
import { Token } from "../auth"
import { errors } from "@/server/error"

/**
 * FileNode Schema
 */
const FileNodeSchema: z.ZodType<FileNode> = z.object({
  name: z.string(),
  path: z.string(),
  type: z.enum(["file", "directory"]),
  size: z.number().optional(),
  modified: z.number().optional(),
  children: z.array(z.lazy(() => FileNodeSchema)).optional(),
})

/**
 * 列出目录请求 Schema
 */
const ListRequestSchema = z.object({
  path: z.string().optional().default(""),
})

/**
 * 列出目录响应 Schema
 */
const ListResponseSchema = z.object({
  success: z.literal(true),
  files: z.array(FileNodeSchema),
})

/**
 * 读取文件请求 Schema
 */
const ReadRequestSchema = z.object({
  path: z.string().min(1, "文件路径不能为空"),
})

/**
 * 读取文件响应 Schema
 */
const ReadResponseSchema = z.object({
  success: z.literal(true),
  content: z.string(),
})

/**
 * 写入文件请求 Schema
 */
const WriteRequestSchema = z.object({
  path: z.string().min(1, "文件路径不能为空"),
  content: z.string(),
})

/**
 * 写入文件响应 Schema
 */
const WriteResponseSchema = z.object({
  success: z.literal(true),
})

/**
 * 创建文件/目录请求 Schema
 */
const CreateRequestSchema = z.object({
  path: z.string().min(1, "路径不能为空"),
  type: z.enum(["file", "directory"]),
})

/**
 * 创建响应 Schema
 */
const CreateResponseSchema = z.object({
  success: z.literal(true),
  path: z.string(),
})

/**
 * 删除请求 Schema
 */
const DeleteRequestSchema = z.object({
  path: z.string().min(1, "路径不能为空"),
})

/**
 * 删除响应 Schema
 */
const DeleteResponseSchema = z.object({
  success: z.literal(true),
})

/**
 * 移动请求 Schema
 */
const MoveRequestSchema = z.object({
  oldPath: z.string().min(1, "原路径不能为空"),
  newPath: z.string().min(1, "新路径不能为空"),
})

/**
 * 移动响应 Schema
 */
const MoveResponseSchema = z.object({
  success: z.literal(true),
})

/**
 * 文件管理路由
 */
export function FilesRoutes() {
  const app = new Hono()

  /**
   * GET /others/files/list
   * 列出目录内容
   */
  app.get(
    "/list",
    describeRoute({
      summary: "List files",
      description: "List files and directories in the specified path",
      operationId: "files.list",
      responses: {
        200: {
          description: "Files listed successfully",
          content: {
            "application/json": {
              schema: resolver(ListResponseSchema),
            },
          },
        },
        ...errors(400),
      },
    }),
    validator("query", ListRequestSchema),
    async (c) => {
      const { path: relPath } = c.req.valid("query")

      // 从 token 获取 space_path
      const spacePath = await getSpacePath(c)
      if (!spacePath) {
        return c.json({ success: false, message: "Unauthorized" }, 401)
      }

      const targetPath = relPath
        ? (path.isAbsolute(relPath) ? relPath : path.resolve(spacePath, relPath))
        : spacePath

      try {
        const files = await listFiles(spacePath, targetPath)
        return c.json({
          success: true,
          files,
        })
      } catch (error) {
        return c.json(
          {
            success: false,
            message: error instanceof Error ? error.message : "Failed to list files",
          },
          400,
        )
      }
    },
  )

  /**
   * GET /others/files/read
   * 读取文件内容
   */
  app.get(
    "/read",
    describeRoute({
      summary: "Read file",
      description: "Read the content of a file",
      operationId: "files.read",
      responses: {
        200: {
          description: "File read successfully",
          content: {
            "application/json": {
              schema: resolver(ReadResponseSchema),
            },
          },
        },
        ...errors(400),
      },
    }),
    validator("query", ReadRequestSchema),
    async (c) => {
      const { path: filePath } = c.req.valid("query")

      const spacePath = await getSpacePath(c)
      if (!spacePath) {
        return c.json({ success: false, message: "Unauthorized" }, 401)
      }

      const targetPath = path.isAbsolute(filePath) ? filePath : path.resolve(spacePath, filePath)

      try {
        const content = await readFile(spacePath, targetPath)
        return c.json({
          success: true,
          content,
        })
      } catch (error) {
        return c.json(
          {
            success: false,
            message: error instanceof Error ? error.message : "Failed to read file",
          },
          400,
        )
      }
    },
  )

  /**
   * POST /others/files/write
   * 写入文件内容
   */
  app.post(
    "/write",
    describeRoute({
      summary: "Write file",
      description: "Write content to a file",
      operationId: "files.write",
      responses: {
        200: {
          description: "File written successfully",
          content: {
            "application/json": {
              schema: resolver(WriteResponseSchema),
            },
          },
        },
        ...errors(400),
      },
    }),
    validator("json", WriteRequestSchema),
    async (c) => {
      const { path: filePath, content } = c.req.valid("json")

      const spacePath = await getSpacePath(c)
      if (!spacePath) {
        return c.json({ success: false, message: "Unauthorized" }, 401)
      }

      const targetPath = path.isAbsolute(filePath) ? filePath : path.resolve(spacePath, filePath)

      try {
        await writeFile(spacePath, targetPath, content)
        return c.json({ success: true })
      } catch (error) {
        return c.json(
          {
            success: false,
            message: error instanceof Error ? error.message : "Failed to write file",
          },
          400,
        )
      }
    },
  )

  /**
   * POST /others/files/create
   * 创建文件或目录
   */
  app.post(
    "/create",
    describeRoute({
      summary: "Create file or directory",
      description: "Create a new file or directory",
      operationId: "files.create",
      responses: {
        200: {
          description: "Created successfully",
          content: {
            "application/json": {
              schema: resolver(CreateResponseSchema),
            },
          },
        },
        ...errors(400),
      },
    }),
    validator("json", CreateRequestSchema),
    async (c) => {
      const { path: itemPath, type } = c.req.valid("json")

      const spacePath = await getSpacePath(c)
      if (!spacePath) {
        return c.json({ success: false, message: "Unauthorized" }, 401)
      }

      const targetPath = path.isAbsolute(itemPath) ? itemPath : path.resolve(spacePath, itemPath)

      try {
        if (type === "directory") {
          await createDirectory(spacePath, targetPath)
        } else {
          await createFile(spacePath, targetPath)
        }
        return c.json({
          success: true,
          path: targetPath,
        })
      } catch (error) {
        return c.json(
          {
            success: false,
            message: error instanceof Error ? error.message : "Failed to create",
          },
          400,
        )
      }
    },
  )

  /**
   * DELETE /others/files/delete
   * 删除文件或目录
   */
  app.delete(
    "/delete",
    describeRoute({
      summary: "Delete file or directory",
      description: "Delete a file or directory",
      operationId: "files.delete",
      responses: {
        200: {
          description: "Deleted successfully",
          content: {
            "application/json": {
              schema: resolver(DeleteResponseSchema),
            },
          },
        },
        ...errors(400),
      },
    }),
    validator("json", DeleteRequestSchema),
    async (c) => {
      const { path: itemPath } = c.req.valid("json")

      const spacePath = await getSpacePath(c)
      if (!spacePath) {
        return c.json({ success: false, message: "Unauthorized" }, 401)
      }

      const targetPath = path.isAbsolute(itemPath) ? itemPath : path.resolve(spacePath, itemPath)

      try {
        await deleteFile(spacePath, targetPath)
        return c.json({ success: true })
      } catch (error) {
        return c.json(
          {
            success: false,
            message: error instanceof Error ? error.message : "Failed to delete",
          },
          400,
        )
      }
    },
  )

  /**
   * POST /others/files/move
   * 移动文件或目录
   */
  app.post(
    "/move",
    describeRoute({
      summary: "Move file or directory",
      description: "Move a file or directory to a new location",
      operationId: "files.move",
      responses: {
        200: {
          description: "Moved successfully",
          content: {
            "application/json": {
              schema: resolver(MoveResponseSchema),
            },
          },
        },
        ...errors(400),
      },
    }),
    validator("json", MoveRequestSchema),
    async (c) => {
      const { oldPath, newPath } = c.req.valid("json")

      const spacePath = await getSpacePath(c)
      if (!spacePath) {
        return c.json({ success: false, message: "Unauthorized" }, 401)
      }

      const resolvedOld = path.isAbsolute(oldPath) ? oldPath : path.resolve(spacePath, oldPath)
      const resolvedNew = path.isAbsolute(newPath) ? newPath : path.resolve(spacePath, newPath)

      try {
        await moveFile(spacePath, resolvedOld, resolvedNew)
        return c.json({ success: true })
      } catch (error) {
        return c.json(
          {
            success: false,
            message: error instanceof Error ? error.message : "Failed to move",
          },
          400,
        )
      }
    },
  )

  /**
   * POST /others/files/upload
   * 上传文件
   */
  app.post(
    "/upload",
    describeRoute({
      summary: "Upload file",
      description: "Upload a file to the specified path",
      operationId: "files.upload",
      responses: {
        200: {
          description: "Uploaded successfully",
          content: {
            "application/json": {
              schema: resolver(CreateResponseSchema),
            },
          },
        },
        ...errors(400),
      },
    }),
    async (c) => {
      const spacePath = await getSpacePath(c)
      if (!spacePath) {
        return c.json({ success: false, message: "Unauthorized" }, 401)
      }

      try {
        const formData = await c.req.formData()
        const file = formData.get("file") as File
        const targetPath = formData.get("path") as string | null

        if (!file) {
          return c.json({ success: false, message: "No file provided" }, 400)
        }

        // targetPath 是目录路径，需要拼接文件名
        const destDir = targetPath
          ? (path.isAbsolute(targetPath) ? targetPath : path.resolve(spacePath, targetPath))
          : spacePath
        const destPath = path.join(destDir, file.name)

        // 将 File 对象转换为 Buffer
        const arrayBuffer = await file.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)

        await uploadFile(spacePath, destPath, buffer)

        return c.json({
          success: true,
          path: destPath,
        })
      } catch (error) {
        return c.json(
          {
            success: false,
            message: error instanceof Error ? error.message : "Failed to upload",
          },
          400,
        )
      }
    },
  )

  /**
   * GET /others/files/download
   * 下载文件
   */
  app.get(
    "/download",
    describeRoute({
      summary: "Download file",
      description: "Download a file as binary",
      operationId: "files.download",
      responses: {
        200: {
          description: "File downloaded successfully",
          content: {
            "application/octet-stream": {
              schema: { type: "string", format: "binary" },
            },
          },
        },
        ...errors(400),
      },
    }),
    validator("query", ReadRequestSchema),
    async (c) => {
      const { path: filePath } = c.req.valid("query")

      const spacePath = await getSpacePath(c)
      if (!spacePath) {
        return c.json({ success: false, message: "Unauthorized" }, 401)
      }

      const targetPath = path.isAbsolute(filePath) ? filePath : path.resolve(spacePath, filePath)

      try {
        const buffer = await readFileBuffer(spacePath, targetPath)
        const filename = path.basename(targetPath)

        return new Response(buffer, {
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
            "Content-Length": buffer.length.toString(),
          },
        })
      } catch (error) {
        return c.json(
          {
            success: false,
            message: error instanceof Error ? error.message : "Failed to download",
          },
          400,
        )
      }
    },
  )

  return app
}

/**
 * 从请求中获取 space_path
 */
async function getSpacePath(c: Context): Promise<string | undefined> {
  const authHeader = c.req.header("Authorization")
  if (!authHeader?.startsWith("Bearer ")) return undefined

  const token = authHeader.slice(7)
  const user = await Token.extractUser(token)
  return user?.space_path
}
