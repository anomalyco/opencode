import { create } from "@bufbuild/protobuf"
import { File } from "../../file"
import { Ripgrep } from "../../file/ripgrep"
import { LSP } from "../../lsp"
import { Instance } from "../../project/instance"
import {
  FindTextResponseSchema,
  FindFilesResponseSchema,
  FindSymbolsResponseSchema,
  ListFilesResponseSchema,
  ReadFileResponseSchema,
  GetFileStatusResponseSchema,
  FindTextMatchSchema,
  SymbolSchema,
  FileNodeSchema,
  FileInfoSchema,
  type FindTextRequest,
  type FindFilesRequest,
  type FindSymbolsRequest,
  type ListFilesRequest,
  type ReadFileRequest,
  type GetFileStatusRequest,
} from "../gen/opencode/v1/file_pb"
import fs from "fs"
import path from "path"

export const file = {
  async findText(req: FindTextRequest) {
    const result = await Ripgrep.search({
      cwd: Instance.directory,
      pattern: req.pattern,
      limit: 10,
    })

    const matches = result.map((match) =>
      create(FindTextMatchSchema, {
        path: match.path.text,
        line: BigInt(match.line_number),
        column: BigInt(match.submatches[0]?.start ?? 0),
        text: match.lines.text.trim(),
      }),
    )

    return create(FindTextResponseSchema, { matches })
  },

  async findFiles(req: FindFilesRequest) {
    const results = await File.search({
      query: req.query,
      limit: req.limit ?? 10,
      dirs: req.dirs,
      type: req.type as "file" | "directory" | undefined,
    })

    return create(FindFilesResponseSchema, { paths: results })
  },

  async findSymbols(req: FindSymbolsRequest) {
    const symbols = await LSP.workspaceSymbol(req.query)

    const result = symbols.map((symbol) => {
      const filePath = symbol.location.uri.startsWith("file://") ? symbol.location.uri.slice(7) : symbol.location.uri
      const relativePath = path.relative(Instance.directory, filePath)

      return create(SymbolSchema, {
        name: symbol.name,
        kind: String(symbol.kind),
        container: "",
        path: relativePath,
        line: BigInt(symbol.location.range.start.line),
        column: BigInt(symbol.location.range.start.character),
      })
    })

    return create(FindSymbolsResponseSchema, { symbols: result })
  },

  async listFiles(req: ListFilesRequest) {
    const nodes = await File.list(req.path)

    const result = await Promise.all(
      nodes.map(async (node) => {
        let size = BigInt(0)
        let modified = BigInt(0)

        if (node.type === "file") {
          try {
            const stats = await fs.promises.stat(node.absolute)
            size = BigInt(stats.size)
            modified = BigInt(stats.mtimeMs)
          } catch {}
        }

        return create(FileNodeSchema, {
          name: node.name,
          path: node.path,
          isDir: node.type === "directory",
          size,
          modified,
        })
      }),
    )

    return create(ListFilesResponseSchema, { nodes: result })
  },

  async readFile(req: ReadFileRequest) {
    const content = await File.read(req.path)

    let size = BigInt(0)
    let modified = BigInt(0)
    try {
      const stats = await fs.promises.stat(path.join(Instance.directory, req.path))
      size = BigInt(stats.size)
      modified = BigInt(stats.mtimeMs)
    } catch {}

    return create(ReadFileResponseSchema, {
      path: req.path,
      content: content.type === "text" ? content.content : "",
      size,
      modified,
    })
  },

  async getFileStatus(_req: GetFileStatusRequest) {
    const files = await File.status()

    const result = files.map((file) =>
      create(FileInfoSchema, {
        path: file.path,
        status: file.status,
      }),
    )

    return create(GetFileStatusResponseSchema, { files: result })
  },
}
