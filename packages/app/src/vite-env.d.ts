/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Universer origin used by the browser for sheets collaboration APIs. */
  readonly VITE_UNIVERSER_URL?: string
  /** Univer Pro `license.txt` body (same string as backend `configs/license.txt`). */
  readonly VITE_UNIVER_LICENSE?: string
  /** Control-plane API origin for office file upload/read/resolve. */
  readonly VITE_VERITLY_UNIVER_FILES_URL?: string
  /** Optional workspace/project namespace header for control-plane lookups. */
  readonly VITE_VERITLY_PROJECT_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
