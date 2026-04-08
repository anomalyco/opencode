/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Single backend origin: `/universer-api/*` + `/v1/files/*`.
   * Docker: `http://127.0.0.1:8000` — go-compat: `http://127.0.0.1:8099`
   */
  readonly VITE_UNIVER_BACKEND_URL?: string
  /** Univer Pro `license.txt` body (same string as backend `configs/license.txt`). */
  readonly VITE_UNIVER_LICENSE?: string
  /** Optional workspace/project namespace header for control-plane lookups. */
  readonly VITE_VERITLY_PROJECT_ID?: string
  /** Optional local WebSocket relay used by the Univer SDK bridge. */
  readonly VITE_UNIVER_SDK_WS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
