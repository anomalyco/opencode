import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import path from "path"
import { File } from "@/file"
import { Ripgrep } from "@/file/ripgrep"
import { LSP } from "@/lsp/lsp"
import { Instance } from "@/project/instance"
import { lazy } from "@/util/lazy"
import { jsonRequest } from "./trace"
import * as OfficeInstaller from "@/file/office-installer"
import * as LibreOffice from "@/file/libreoffice"

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
                schema: resolver(Ripgrep.SearchMatch.zod.array()),
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
      async (c) =>
        jsonRequest("FileRoutes.findText", c, function* () {
          const pattern = c.req.valid("query").pattern
          const svc = yield* Ripgrep.Service
          const result = yield* svc.search({ cwd: Instance.directory, pattern, limit: 10 })
          return result.items
        }),
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
      async (c) =>
        jsonRequest("FileRoutes.findFile", c, function* () {
          const query = c.req.valid("query")
          const svc = yield* File.Service
          return yield* svc.search({
            query: query.query,
            limit: query.limit ?? 10,
            dirs: query.dirs !== "false",
            type: query.type,
          })
        }),
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
                schema: resolver(LSP.Symbol.zod.array()),
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
                schema: resolver(File.Node.zod.array()),
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
      async (c) =>
        jsonRequest("FileRoutes.list", c, function* () {
          const svc = yield* File.Service
          return yield* svc.list(c.req.valid("query").path)
        }),
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
                schema: resolver(File.Content.zod),
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
      async (c) =>
        jsonRequest("FileRoutes.read", c, function* () {
          const svc = yield* File.Service
          return yield* svc.read(c.req.valid("query").path)
        }),
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
                schema: resolver(File.Info.zod.array()),
              },
            },
          },
        },
      }),
      async (c) =>
        jsonRequest("FileRoutes.status", c, function* () {
          const svc = yield* File.Service
          return yield* svc.status()
        }),
    )
    .get(
      "/file/office-pdf",
      describeRoute({
        summary: "Office file as PDF (binary)",
        description:
          "Convert an office document to PDF via LibreOffice and return the bytes. Used by the in-app PDF viewer to avoid the memory cost of base64 + JSON for very large decks.",
        operationId: "file.officePdf",
        responses: {
          200: {
            description: "PDF bytes",
            content: { "application/pdf": { schema: { type: "string", format: "binary" } } },
          },
          404: { description: "Conversion failed or LibreOffice unavailable" },
        },
      }),
      validator("query", z.object({ path: z.string() })),
      async (c) => {
        const filePath = c.req.valid("query").path
        const directory = Instance.directory
        const full = path.isAbsolute(filePath) ? filePath : path.join(directory, filePath)
        const bytes = await LibreOffice.convertToPdf(full).catch(() => undefined)
        if (!bytes || bytes.length === 0) {
          return c.notFound()
        }
        return new Response(bytes as BodyInit, {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Length": String(bytes.length),
            "Cache-Control": "private, max-age=3600",
          },
        })
      },
    )
    .get(
      "/office-tooling/status",
      describeRoute({
        summary: "Office tooling status",
        description: "Whether LibreOffice is available for office document preview, plus install progress.",
        operationId: "office.tooling.status",
        responses: {
          200: {
            description: "Status",
            content: { "application/json": { schema: resolver(z.any()) } },
          },
        },
      }),
      async (c) => c.json(await OfficeInstaller.status()),
    )
    .post(
      "/office-tooling/install",
      describeRoute({
        summary: "Start office tooling install",
        description: "Begin downloading and installing LibreOffice in the background.",
        operationId: "office.tooling.install",
        responses: {
          200: {
            description: "Install started",
            content: { "application/json": { schema: resolver(z.any()) } },
          },
        },
      }),
      async (c) => c.json(await OfficeInstaller.startInstall()),
    )
    .get(
      "/office-tooling/progress",
      describeRoute({
        summary: "Poll office tooling install progress",
        operationId: "office.tooling.progress",
        responses: {
          200: {
            description: "Progress",
            content: { "application/json": { schema: resolver(z.any()) } },
          },
        },
      }),
      async (c) => c.json(OfficeInstaller.getProgress()),
    ),
)
