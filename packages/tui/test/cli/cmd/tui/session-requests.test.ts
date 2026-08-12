import { describe, expect, test } from "bun:test"
import { visibleSessionRequests } from "../../../../src/routes/session/request"

describe("session request visibility", () => {
  test("shows requests for the route session before the session record is hydrated", () => {
    expect(
      visibleSessionRequests({
        routeSessionID: "ses_parent",
        currentSession: undefined,
        sessions: [],
        requests: {
          ses_parent: [{ id: "perm_parent" }],
        },
      }).map((item) => item.id),
    ).toEqual(["perm_parent"])
  })

  test("shows known child session requests from the parent route", () => {
    expect(
      visibleSessionRequests({
        routeSessionID: "ses_parent",
        currentSession: { id: "ses_parent" },
        sessions: [{ id: "ses_parent" }, { id: "ses_child", parentID: "ses_parent" }],
        requests: {
          ses_child: [{ id: "perm_child" }],
        },
      }).map((item) => item.id),
    ).toEqual(["perm_child"])
  })

  test("shows requests for the child route itself", () => {
    expect(
      visibleSessionRequests({
        routeSessionID: "ses_child",
        currentSession: { id: "ses_child", parentID: "ses_parent" },
        sessions: [{ id: "ses_parent" }, { id: "ses_child", parentID: "ses_parent" }],
        requests: {
          ses_child: [{ id: "perm_child" }],
        },
      }).map((item) => item.id),
    ).toEqual(["perm_child"])
  })

  test("shows nested child session requests from the parent route", () => {
    expect(
      visibleSessionRequests({
        routeSessionID: "ses_parent",
        currentSession: { id: "ses_parent" },
        sessions: [
          { id: "ses_parent" },
          { id: "ses_child", parentID: "ses_parent" },
          { id: "ses_grandchild", parentID: "ses_child" },
        ],
        requests: {
          ses_grandchild: [{ id: "perm_grandchild" }],
        },
      }).map((item) => item.id),
    ).toEqual(["perm_grandchild"])
  })

  test("shows nested child session requests from a child route", () => {
    expect(
      visibleSessionRequests({
        routeSessionID: "ses_child",
        currentSession: { id: "ses_child", parentID: "ses_parent" },
        sessions: [
          { id: "ses_parent" },
          { id: "ses_child", parentID: "ses_parent" },
          { id: "ses_grandchild", parentID: "ses_child" },
        ],
        requests: {
          ses_grandchild: [{ id: "perm_grandchild" }],
        },
      }).map((item) => item.id),
    ).toEqual(["perm_grandchild"])
  })

  test("does not show parent requests from a child route", () => {
    expect(
      visibleSessionRequests({
        routeSessionID: "ses_child",
        currentSession: { id: "ses_child", parentID: "ses_parent" },
        sessions: [{ id: "ses_parent" }, { id: "ses_child", parentID: "ses_parent" }],
        requests: {
          ses_parent: [{ id: "perm_parent" }],
        },
      }),
    ).toEqual([])
  })
})
