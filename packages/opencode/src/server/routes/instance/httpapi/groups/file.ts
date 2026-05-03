import { File } from "@/file"
import { Ripgrep } from "@/file/ripgrep"
import { LSP } from "@/lsp/lsp"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware } from "../middleware/workspace-routing"
import { described } from "./metadata"
// FORK: office routes schema 集中区(office-routes-effect-httpapi 2026-05-03)
import {
  OfficePdfQuery,
  OfficePdfBytes,
  OfficeInstallProgress,
  OfficeToolingStatus,
} from "./file-office"

export const FileQuery = Schema.Struct({
  path: Schema.String,
})

export const FindTextQuery = Schema.Struct({
  pattern: Schema.String,
})

export const FindFileQuery = Schema.Struct({
  query: Schema.String,
  dirs: Schema.optional(Schema.Literals(["true", "false"])),
  type: Schema.optional(Schema.Literals(["file", "directory"])),
  limit: Schema.optional(
    Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(200)),
  ),
})

export const FindSymbolQuery = Schema.Struct({
  query: Schema.String,
})

export const FilePaths = {
  findText: "/find",
  findFile: "/find/file",
  findSymbol: "/find/symbol",
  list: "/file",
  content: "/file/content",
  status: "/file/status",
  // FORK: office routes(office-routes-effect-httpapi 2026-05-03)
  officePdf: "/file/office-pdf",
  officeToolingStatus: "/office-tooling/status",
  officeToolingInstall: "/office-tooling/install",
  officeToolingProgress: "/office-tooling/progress",
} as const

export const FileApi = HttpApi.make("file")
  .add(
    HttpApiGroup.make("file")
      .add(
        HttpApiEndpoint.get("findText", FilePaths.findText, {
          query: FindTextQuery,
          success: described(Schema.Array(Ripgrep.SearchMatch), "Matches"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "find.text",
            summary: "Find text",
            description: "Search for text patterns across files in the project using ripgrep.",
          }),
        ),
        HttpApiEndpoint.get("findFile", FilePaths.findFile, {
          query: FindFileQuery,
          success: described(Schema.Array(Schema.String), "File paths"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "find.files",
            summary: "Find files",
            description: "Search for files or directories by name or pattern in the project directory.",
          }),
        ),
        HttpApiEndpoint.get("findSymbol", FilePaths.findSymbol, {
          query: FindSymbolQuery,
          success: described(Schema.Array(LSP.Symbol), "Symbols"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "find.symbols",
            summary: "Find symbols",
            description: "Search for workspace symbols like functions, classes, and variables using LSP.",
          }),
        ),
        HttpApiEndpoint.get("list", FilePaths.list, {
          query: FileQuery,
          success: described(Schema.Array(File.Node), "Files and directories"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "file.list",
            summary: "List files",
            description: "List files and directories in a specified path.",
          }),
        ),
        HttpApiEndpoint.get("content", FilePaths.content, {
          query: FileQuery,
          success: described(File.Content, "File content"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "file.read",
            summary: "Read file",
            description: "Read the content of a specified file.",
          }),
        ),
        HttpApiEndpoint.get("status", FilePaths.status, {
          success: described(Schema.Array(File.Info), "File status"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "file.status",
            summary: "Get file status",
            description: "Get the git status of all files in the project.",
          }),
        ),
        // FORK-BEGIN: office routes — fork Hono routes 迁到 PublicApi(office-routes-effect-httpapi 2026-05-03)
        HttpApiEndpoint.get("officePdf", FilePaths.officePdf, {
          query: OfficePdfQuery,
          success: OfficePdfBytes,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "file.officePdf",
            summary: "Office file as PDF (binary)",
            description:
              "Convert an office document to PDF via LibreOffice and return the bytes. Used by the in-app PDF viewer to avoid the memory cost of base64 + JSON for very large decks.",
          }),
        ),
        HttpApiEndpoint.get("officeToolingStatus", FilePaths.officeToolingStatus, {
          success: described(OfficeToolingStatus, "Office tooling install status"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "office.tooling.status",
            summary: "Get office tooling install status",
            description: "Returns LibreOffice availability + install progress on this machine.",
          }),
        ),
        HttpApiEndpoint.post("officeToolingInstall", FilePaths.officeToolingInstall, {
          payload: Schema.Struct({}),
          success: described(OfficeToolingStatus, "Office tooling status (post-install start)"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "office.tooling.install",
            summary: "Start office tooling install",
            description: "Kick off background LibreOffice download + install. Returns immediately.",
          }),
        ),
        HttpApiEndpoint.get("officeToolingProgress", FilePaths.officeToolingProgress, {
          success: described(OfficeInstallProgress, "Install progress"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "office.tooling.progress",
            summary: "Poll office tooling install progress",
            description: "Returns current phase, bytes downloaded/total, percent, speed.",
          }),
        ),
        // FORK-END
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "file",
          description: "Experimental HttpApi file routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )
