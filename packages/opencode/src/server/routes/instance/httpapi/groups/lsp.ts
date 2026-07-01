import { NonNegativeInt } from "@opencode-ai/core/schema"
import { LSP } from "@/lsp/lsp"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { FileQuery } from "./file"
import { described } from "./metadata"

export const LspFeaturePaths = {
  hover: "/lsp/hover",
  definition: "/lsp/definition",
  references: "/lsp/references",
  completion: "/lsp/completion",
  diagnostics: "/lsp/diagnostics",
  buffer: "/lsp/buffer",
  bufferClose: "/lsp/buffer/close",
} as const

export const LocPayload = Schema.Struct({
  path: Schema.String,
  line: NonNegativeInt,
  character: NonNegativeInt,
  triggerKind: Schema.optional(Schema.Number),
  triggerCharacter: Schema.optional(Schema.String),
})
export type LocPayload = typeof LocPayload.Type

// `version` is editor-owned and must increase monotonically; stale versions are ignored by the LSP client.
export const BufferPayload = Schema.Struct({
  path: Schema.String,
  text: Schema.String,
  version: NonNegativeInt,
})
export type BufferPayload = typeof BufferPayload.Type

export const BufferClosePayload = Schema.Struct({
  path: Schema.String,
})
export type BufferClosePayload = typeof BufferClosePayload.Type

const LspResult = Schema.Unknown

export const DiagnosticOut = LSP.DiagnosticOut
export type DiagnosticOut = typeof LSP.DiagnosticOut.Type

export const LspFeatureApi = HttpApi.make("lsp-features")
  .add(
    HttpApiGroup.make("lsp-features")
      .add(
        HttpApiEndpoint.post("hover", LspFeaturePaths.hover, {
          query: WorkspaceRoutingQuery,
          payload: LocPayload,
          success: described(LspResult, "Hover result"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "lsp.hover",
            summary: "LSP hover",
            description: "Get hover information for a position in a file via LSP.",
          }),
        ),
        HttpApiEndpoint.post("definition", LspFeaturePaths.definition, {
          query: WorkspaceRoutingQuery,
          payload: LocPayload,
          success: described(LspResult, "Definition locations"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "lsp.definition",
            summary: "LSP definition",
            description: "Find the definition of the symbol at a position in a file via LSP.",
          }),
        ),
        HttpApiEndpoint.post("references", LspFeaturePaths.references, {
          query: WorkspaceRoutingQuery,
          payload: LocPayload,
          success: described(LspResult, "Reference locations"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "lsp.references",
            summary: "LSP references",
            description: "Find references to the symbol at a position in a file via LSP.",
          }),
        ),
        HttpApiEndpoint.post("completion", LspFeaturePaths.completion, {
          query: WorkspaceRoutingQuery,
          payload: LocPayload,
          success: described(LspResult, "Completion result"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "lsp.completion",
            summary: "LSP completion",
            description: "Get completion suggestions for a position in a file via LSP.",
          }),
        ),
        HttpApiEndpoint.get("diagnostics", LspFeaturePaths.diagnostics, {
          query: FileQuery,
          success: described(Schema.Array(DiagnosticOut), "Diagnostics for the file"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "lsp.diagnostics",
            summary: "LSP diagnostics",
            description: "Get diagnostics for a single file via LSP.",
          }),
        ),
        HttpApiEndpoint.put("buffer", LspFeaturePaths.buffer, {
          query: WorkspaceRoutingQuery,
          payload: BufferPayload,
          success: described(Schema.Boolean, "Buffer synced"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "lsp.buffer",
            summary: "LSP buffer sync",
            description:
              "Push the editor's in-memory buffer (text + monotonic version) so LSP features reflect unsaved edits.",
          }),
        ),
        HttpApiEndpoint.post("bufferClose", LspFeaturePaths.bufferClose, {
          query: WorkspaceRoutingQuery,
          payload: BufferClosePayload,
          success: described(Schema.Boolean, "Buffer closed"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "lsp.bufferClose",
            summary: "LSP buffer close",
            description: "Close the editor buffer so the LSP server reverts to disk-backed analysis.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "lsp-features",
          description: "Experimental HttpApi LSP feature routes.",
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
