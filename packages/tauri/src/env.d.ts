// Vite import.meta.env typings for TypeScript
interface ImportMetaEnv {
  readonly DEV: boolean
  readonly PROD: boolean
  readonly MODE: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
