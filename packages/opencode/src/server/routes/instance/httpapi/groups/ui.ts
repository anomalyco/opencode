import { UiProjectView } from "@/ui/project-view"
import { ProjectV2 } from "@opencode-ai/core/project"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { InvalidRequestError, ProjectNotFoundError } from "../errors"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/ui/project-view"

export const UiApi = HttpApi.make("ui")
  .add(
    HttpApiGroup.make("ui")
      .add(
        HttpApiEndpoint.get("getProjectView", root, {
          query: WorkspaceRoutingQuery,
          success: described(UiProjectView.Info, "UI project view"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "ui.projectView.get",
            summary: "Get UI project view",
            description: "Get opened projects and last project for the shared UI project view.",
          }),
        ),
        HttpApiEndpoint.put("replaceOpenProjects", `${root}/open-projects`, {
          query: WorkspaceRoutingQuery,
          payload: UiProjectView.ReplaceOpenProjectsInput,
          success: described(UiProjectView.Info, "Updated UI project view"),
          error: [HttpApiError.BadRequest, InvalidRequestError, ProjectNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "ui.projectView.openProjects.replace",
            summary: "Replace opened projects",
            description: "Replace the ordered opened-project list for the shared UI project view.",
          }),
        ),
        HttpApiEndpoint.post("openProject", `${root}/open-projects`, {
          query: WorkspaceRoutingQuery,
          payload: UiProjectView.OpenProjectInput,
          success: described(UiProjectView.Info, "Updated UI project view"),
          error: [HttpApiError.BadRequest, InvalidRequestError, ProjectNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "ui.projectView.openProjects.open",
            summary: "Open project",
            description: "Open a project by project ID or directory in the shared UI project view.",
          }),
        ),
        HttpApiEndpoint.patch("updateOpenProject", `${root}/open-projects/:projectID`, {
          params: { projectID: ProjectV2.ID },
          query: WorkspaceRoutingQuery,
          payload: UiProjectView.UpdateOpenProjectInput,
          success: described(UiProjectView.Info, "Updated UI project view"),
          error: [HttpApiError.BadRequest, ProjectNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "ui.projectView.openProjects.update",
            summary: "Update opened project",
            description: "Update expanded state or position for an opened project.",
          }),
        ),
        HttpApiEndpoint.delete("closeProject", `${root}/open-projects/:projectID`, {
          params: { projectID: ProjectV2.ID },
          query: WorkspaceRoutingQuery,
          success: described(UiProjectView.Info, "Updated UI project view"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "ui.projectView.openProjects.close",
            summary: "Close project",
            description: "Close a project in the shared UI project view without deleting project metadata.",
          }),
        ),
        HttpApiEndpoint.patch("setLastProject", `${root}/last-project`, {
          query: WorkspaceRoutingQuery,
          payload: UiProjectView.LastProjectInput,
          success: described(UiProjectView.Info, "Updated UI project view"),
          error: [HttpApiError.BadRequest, InvalidRequestError, ProjectNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "ui.projectView.lastProject.set",
            summary: "Set last project",
            description: "Set the last selected project by project ID or directory for the shared UI project view.",
          }),
        ),
      )
      .annotateMerge(OpenApi.annotations({ title: "ui", description: "Experimental HttpApi UI routes." }))
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )
