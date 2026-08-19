import { describe, expect, test } from "bun:test"
import { HttpApi, OpenApi } from "effect/unstable/httpapi"
import { WorkflowGroup } from "../src/groups/workflow"

describe("workflow protocol", () => {
  test("registers workflow routes in the default API", () => {
    const document = OpenApi.fromApi(HttpApi.make("workflow-test").add(WorkflowGroup))

    expect(new Set(Object.keys(document.paths).filter((item) => item.startsWith("/api/workflow")))).toEqual(new Set([
      "/api/workflow",
      "/api/workflow/{workflowID}",
      "/api/workflow/{workflowID}/cancel",
      "/api/workflow/{workflowID}/pause",
      "/api/workflow/{workflowID}/resume",
      "/api/workflow/preferences",
    ]))
    expect(document.paths["/api/workflow"]?.get).toBeDefined()
    expect(document.paths["/api/workflow"]?.post).toBeDefined()
    expect(document.paths["/api/workflow/preferences"]?.get).toBeDefined()
    expect(document.paths["/api/workflow/preferences"]?.put).toBeDefined()
  })
})
