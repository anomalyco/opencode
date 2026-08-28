export type FileManagerOS = "macos" | "windows" | "linux" | "unknown"

export function fileManagerApp(os: FileManagerOS): {
  label: "session.header.open.finder" | "session.header.open.fileExplorer" | "session.header.open.fileManager"
  actionLabel:
    | "session.header.reveal.finder"
    | "session.header.reveal.fileExplorer"
    | "session.header.reveal.containingFolder"
  icon: "finder" | "file-explorer"
} {
  if (os === "macos")
    return { label: "session.header.open.finder", actionLabel: "session.header.reveal.finder", icon: "finder" }
  if (os === "windows")
    return {
      label: "session.header.open.fileExplorer",
      actionLabel: "session.header.reveal.fileExplorer",
      icon: "file-explorer",
    }
  return {
    label: "session.header.open.fileManager",
    actionLabel: "session.header.reveal.containingFolder",
    icon: "finder",
  }
}
