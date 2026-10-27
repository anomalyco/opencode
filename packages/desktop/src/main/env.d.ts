interface ImportMetaEnv {
  readonly OPENCODE_CHANNEL: string
  readonly OPENCODE_VERSION?: string
  readonly OPENCODE_DESKTOP_SERVER_CHANNEL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
