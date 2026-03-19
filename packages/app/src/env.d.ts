interface ImportMetaEnv {
  readonly VITE_OPENCODE_SERVER_HOST: string
  readonly VITE_OPENCODE_SERVER_PORT: string
  readonly VITE_OPENCODE_LICENSE_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
