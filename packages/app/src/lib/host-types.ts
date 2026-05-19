export type { FileContent } from "@opencode-ai/ui/pierre/file-content"

export type FileNode = {
  name: string
  path: string
  absolute: string
  type: "file" | "directory"
  ignored: boolean
}

export type Path = {
  state: string
  config: string
  worktree: string
  directory: string
  home: string
}

export type VcsInfo = {
  branch: string
}

export type LspStatus = {
  id: string
  name: string
  root: string
  status: "connected" | "error"
}
