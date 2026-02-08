declare module "#terminal-backend" {
  import type { CreateBackendFn } from "./backend/types"
  export const createBackend: CreateBackendFn
}
