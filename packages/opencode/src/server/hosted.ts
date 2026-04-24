/** Veritly: the API has no on-disk “project” for tool registry (read/grep/… on host). */
export function localFilesystemDisabled() {
  return true
}

/**
 * No-op. Legacy guard for OpenCode’s local-directory project model; Veritly uses PostgreSQL
 * and optional on-disk work only on non-Postgres `project.create` paths in development.
 */
export function assertHostedFilesystemEnabled() {}