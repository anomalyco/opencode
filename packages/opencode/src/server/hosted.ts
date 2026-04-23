const API_HOST_PROJECT_DIR_DISABLED =
  "This server does not expose a host project directory. Work happens in the database and executor, not the API’s filesystem."

/** Veritly: the API has no on-disk “project” for clients to list or read. */
export function localFilesystemDisabled() {
  return true
}

export function hostedFilesystemDisabledResponse() {
  return new Response(
    JSON.stringify({
      error: API_HOST_PROJECT_DIR_DISABLED,
    }),
    {
      status: 501,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    },
  )
}

/**
 * No-op. Legacy guard for OpenCode’s local-directory project model; Veritly uses PostgreSQL
 * and optional on-disk work only on non-Postgres `project.create` paths in development.
 */
export function assertHostedFilesystemEnabled() {}