interface ImportMetaEnv {
  readonly VITE_CRAZYCODE_SERVER_HOST: string
  readonly VITE_CRAZYCODE_SERVER_PORT: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
