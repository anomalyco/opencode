declare module "virtual:vite-opencode-picker/client"

interface ImportMetaEnv {
  readonly OPENCODE_CHANNEL: string
  readonly OPENCODE_VERSION?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
