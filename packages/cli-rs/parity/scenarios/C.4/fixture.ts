// Shared routes for the C.4 `api` cases.
import type { Route } from "../../lib/fake-server"

export const openapi: Route = {
  path: "/openapi.json",
  json: {
    paths: {
      "/api/session": { parameters: [], get: { operationId: "session.list" } },
      "/api/session/{sessionID}": {
        get: { operationId: "session.get" },
        delete: { operationId: "session.remove" },
      },
    },
  },
}
