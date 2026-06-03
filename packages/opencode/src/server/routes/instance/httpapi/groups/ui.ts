import { UiProjectView } from "@/ui/project-view"
import { UiSettings } from "@/ui/settings"
import { ProjectV2 } from "@opencode-ai/core/project"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { InvalidRequestError, ProjectNotFoundError } from "../errors"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

const projectViewRoot = "/ui/project-view"
const settingsRoot = "/ui/settings"

export const UiApi = HttpApi.make("ui")
  .add(
    HttpApiGroup.make("ui")
      .add(
        HttpApiEndpoint.get("getProjectView", projectViewRoot, {
          query: WorkspaceRoutingQuery,
          success: described(UiProjectView.Info, "UI project view"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "ui.projectView.get",
            summary: "Get UI project view",
            description: "Get opened projects and last project for the shared UI project view.",
          }),
        ),
        HttpApiEndpoint.put("replaceOpenProjects", `${projectViewRoot}/open-projects`, {
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
        HttpApiEndpoint.post("openProject", `${projectViewRoot}/open-projects`, {
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
        HttpApiEndpoint.patch("updateOpenProject", `${projectViewRoot}/open-projects/:projectID`, {
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
        HttpApiEndpoint.delete("closeProject", `${projectViewRoot}/open-projects/:projectID`, {
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
        HttpApiEndpoint.patch("setLastProject", `${projectViewRoot}/last-project`, {
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
        HttpApiEndpoint.get("getSettings", settingsRoot, {
          query: WorkspaceRoutingQuery,
          success: described(UiSettings.Info, "UI settings"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "ui.settings.get",
            summary: "Get UI settings",
            description: "Get shared UI app settings, keybinds, and model preferences.",
          }),
        ),
        HttpApiEndpoint.put("updateAppSettings", `${settingsRoot}/app`, {
          query: WorkspaceRoutingQuery,
          payload: UiSettings.AppSettings,
          success: described(UiSettings.Info, "Updated UI settings"),
          error: [HttpApiError.BadRequest],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "ui.settings.app.update",
            summary: "Update UI app settings",
            description: "Replace typed shared UI app settings.",
          }),
        ),
        HttpApiEndpoint.put("replaceKeybinds", `${settingsRoot}/keybinds`, {
          query: WorkspaceRoutingQuery,
          payload: UiSettings.KeybindsInput,
          success: described(UiSettings.Info, "Updated UI settings"),
          error: [HttpApiError.BadRequest],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "ui.settings.keybinds.replace",
            summary: "Replace UI keybinds",
            description: "Replace shared UI keybind overrides.",
          }),
        ),
        HttpApiEndpoint.patch("updateModelPreference", `${settingsRoot}/models/:providerID/:modelID`, {
          params: { providerID: Schema.String, modelID: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: UiSettings.ModelPreferenceInput,
          success: described(UiSettings.Info, "Updated UI settings"),
          error: [HttpApiError.BadRequest],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "ui.settings.models.update",
            summary: "Update UI model preference",
            description: "Update shared visibility or favorite preference for a model.",
          }),
        ),
        HttpApiEndpoint.put("replaceRecentModels", `${settingsRoot}/models/recent`, {
          query: WorkspaceRoutingQuery,
          payload: UiSettings.RecentModelsInput,
          success: described(UiSettings.Info, "Updated UI settings"),
          error: [HttpApiError.BadRequest],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "ui.settings.models.recent.replace",
            summary: "Replace recent UI models",
            description: "Replace the ordered shared recent-model list.",
          }),
        ),
        HttpApiEndpoint.patch("updateModelVariant", `${settingsRoot}/models/:providerID/:modelID/variant`, {
          params: { providerID: Schema.String, modelID: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: UiSettings.ModelVariantInput,
          success: described(UiSettings.Info, "Updated UI settings"),
          error: [HttpApiError.BadRequest],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "ui.settings.models.variant.update",
            summary: "Update UI model variant",
            description: "Set or clear the shared selected variant for a model.",
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
