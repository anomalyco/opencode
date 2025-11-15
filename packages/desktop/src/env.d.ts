interface ImportMetaEnv {
  readonly VITE_CHALICECODE_SERVER_HOST: string
  readonly VITE_CHALICECODE_SERVER_PORT: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
