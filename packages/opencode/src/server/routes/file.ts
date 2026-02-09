import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { File } from "../../file"
import { Ripgrep } from "../../file/ripgrep"
import { LSP } from "../../lsp"
import { Instance } from "../../project/instance"
import { lazy } from "../../util/lazy"
import { errors } from "../error"

export const FileRoutes = lazy(() =>
  new Hono()
    .get(
      "/find",
      describeRoute({
        summary: "Find text",
        description: "Search for text patterns across files in the project using ripgrep.",
        operationId: "find.text",
        responses: {
          200: {
            description: "Matches",
            content: {
              "application/json": {
                schema: resolver(Ripgrep.Match.shape.data.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          pattern: z.string(),
        }),
      ),
      async (c) => {
        const pattern = c.req.valid("query").pattern
        const result = await Ripgrep.search({
          cwd: Instance.directory,
          pattern,
          limit: 10,
        })
        return c.json(result)
      },
    )
    .get(
      "/find/file",
      describeRoute({
        summary: "Find files",
        description: "Search for files or directories by name or pattern in the project directory.",
        operationId: "find.files",
        responses: {
          200: {
            description: "File paths",
            content: {
              "application/json": {
                schema: resolver(z.string().array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          query: z.string(),
          dirs: z.enum(["true", "false"]).optional(),
          type: z.enum(["file", "directory"]).optional(),
          limit: z.coerce.number().int().min(1).max(200).optional(),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query").query
        const dirs = c.req.valid("query").dirs
        const type = c.req.valid("query").type
        const limit = c.req.valid("query").limit
        const results = await File.search({
          query,
          limit: limit ?? 10,
          dirs: dirs !== "false",
          type,
        })
        return c.json(results)
      },
    )
    .get(
      "/find/symbol",
      describeRoute({
        summary: "Find symbols",
        description: "Search for workspace symbols like functions, classes, and variables using LSP.",
        operationId: "find.symbols",
        responses: {
          200: {
            description: "Symbols",
            content: {
              "application/json": {
                schema: resolver(LSP.Symbol.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          query: z.string(),
        }),
      ),
      async (c) => {
        /*
      const query = c.req.valid("query").query
      const result = await LSP.workspaceSymbol(query)
      return c.json(result)
      */
        return c.json([])
      },
    )
    .get(
      "/file",
      describeRoute({
        summary: "List files",
        description: "List files and directories in a specified path.",
        operationId: "file.list",
        responses: {
          200: {
            description: "Files and directories",
            content: {
              "application/json": {
                schema: resolver(File.Node.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          path: z.string(),
        }),
      ),
      async (c) => {
        const path = c.req.valid("query").path
        const content = await File.list(path)
        return c.json(content)
      },
    )
    .get(
      "/file/content",
      describeRoute({
        summary: "Read file",
        description: "Read the content of a specified file.",
        operationId: "file.read",
        responses: {
          200: {
            description: "File content",
            content: {
              "application/json": {
                schema: resolver(File.Content),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          path: z.string(),
        }),
      ),
      async (c) => {
        const path = c.req.valid("query").path
        const content = await File.read(path)
        return c.json(content)
      },
    )
    .get(
      "/file/status",
      describeRoute({
        summary: "Get file status",
        description: "Get the git status of all files in the project.",
        operationId: "file.status",
        responses: {
          200: {
            description: "File status",
            content: {
              "application/json": {
                schema: resolver(File.Info.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const content = await File.status()
        return c.json(content)
      },
    )
    .delete(
      "/file",
      describeRoute({
        summary: "Delete file",
        description: "Delete a file or directory recursively.",
        operationId: "file.delete",
        responses: {
          ...errors(400, 404),
          200: {
            description: "File deleted successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          path: z.string(),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        await File.remove(body.path)
        return c.json(true)
      },
    )
    .post(
      "/file/mkdir",
      describeRoute({
        summary: "Create directory",
        description: "Create a directory, including any missing parent directories.",
        operationId: "file.mkdir",
        responses: {
          ...errors(400),
          200: {
            description: "Directory created successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          path: z.string(),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        await File.mkdir(body.path)
        return c.json(true)
      },
    )
    .post(
      "/file/rename",
      describeRoute({
        summary: "Rename file",
        description: "Rename or move a file or directory. Creates missing parent directories for the target path.",
        operationId: "file.rename",
        responses: {
          ...errors(400, 404),
          200: {
            description: "File renamed successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          from: z.string(),
          to: z.string(),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        await File.rename(body.from, body.to)
        return c.json(true)
      },
    )
    .post(
      "/file/upload",
      describeRoute({
        summary: "Upload files",
        description:
          "Upload one or more files via multipart/form-data. Each file field should use the relative path as the field name (e.g., 'src/image.png'). Alternatively, include a 'path' field to specify a target directory — uploaded files will be placed there using their original filenames.",
        operationId: "file.upload",
        responses: {
          ...errors(400),
          200: {
            description: "Upload results",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      path: z.string(),
                      size: z.number(),
                    }),
                  ),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const body = await c.req.parseBody({ all: true })
        const targetDir = typeof body["path"] === "string" ? body["path"] : undefined
        const results: { path: string; size: number }[] = []

        for (const [key, value] of Object.entries(body)) {
          if (key === "path") continue
          const files = Array.isArray(value) ? value : [value]
          for (const file of files) {
            if (typeof file === "string") continue
            if (!(file instanceof globalThis.File)) continue
            const dest = targetDir
              ? targetDir + "/" + file.name
              : key === "file" || key === "file[]"
                ? file.name
                : key
            const buffer = await file.arrayBuffer()
            await File.upload(dest, buffer)
            results.push({ path: dest, size: buffer.byteLength })
          }
        }

        if (!results.length) {
          throw new Error("No files found in request body")
        }
        return c.json(results)
      },
    ),
)
