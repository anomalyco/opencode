/**
 * Contract audit: mirrors [`univer-go-compat/internal/api/handler.go`](../../../../veritly/packages/univer-go-compat/internal/api/handler.go)
 * — universer-style routes used by Veritly OSS (`snapshot/save`, exchange import, optional comb stubs).
 */
export const universerRoutes = [
  "GET /healthz",
  "GET /health",
  "GET /livez",
  "GET /readyz",
  "GET /universer-api/user/session-ticket",
  "POST /universer-api/authz/allowed",
  "POST /universer-api/authz/batch-allowed",
  "POST /universer-api/authz/-/object/-/allowed",
  "POST /universer-api/authz/-/object/-/batch_allowed",
  "GET /universer-api/authz/list-collaborators",
  "POST /universer-api/stream/file/upload",
  "GET /universer-api/file/:fileID/sign-url",
  "POST /universer-api/exchange/:type/import",
  "POST /universer-api/exchange/:type/export",
  "GET /universer-api/exchange/task/:taskID",
  "POST /universer-api/snapshot/:type/unit/-/create",
  "GET /universer-api/snapshot/:type/unit/:unitID/rev/:revision/ensure",
  "GET /universer-api/snapshot/:type/unit/:unitID/rev/:revision",
  "POST /universer-api/snapshot/:type/unit/:unitID/save",
  "POST /universer-api/snapshot/:type/unit/:unitID/changeset",
  "GET /universer-api/snapshot/:type/unit/:unitID/changesets",
  "GET /universer-api/snapshot/block/:type/unit/:unitID/block/:blockID",
  "POST /universer-api/comb/new-change",
  "POST /universer-api/comb/:type/unit/:unitID/new_changes",
  "GET /universer-api/comb/connect",
  "POST /universer-api/license/formula/limit/start",
  "GET /universer-api/license/formula/limit/status",
  "POST /universer-api/license/formula/limit/done",
] as const

export const exchangeMultipartVsJson = {
  upload:
    "multipart form field `file` OR raw body with Content-Type sheet mime and query `?size=&source=&flate=` (size must match body length)",
  import: "JSON POST body includes at least `{ fileID }` (extra keys ignored by compat)",
  taskPoll: "GET returns `{ error, taskID, status, import: { outputType, unitID, jsonID } }`",
} as const
