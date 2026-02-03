interface ImportMetaEnv {
  readonly VITE_LOTIONCODE_SERVER_HOST: string
  readonly VITE_LOTIONCODE_SERVER_PORT: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
