interface ImportMetaEnv {
  readonly VITE_OPENDEEPSEEK_SERVER_HOST: string
  readonly VITE_OPENDEEPSEEK_SERVER_PORT: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
