import { Shell } from "@opencode-ai/schema/shell"
import { Location } from "@opencode-ai/schema/location"
import { NonNegativeInt } from "@opencode-ai/schema/schema"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { ShellNotFoundError } from "../errors.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

const TimeoutInput = Schema.Struct({
  timeout: NonNegativeInt,
})

export const ShellGroup = HttpApiGroup.make("server.shell")
  .add(
    HttpApiEndpoint.get("shell.list", "/api/shell", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Shell.Info)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.shell.list",
          summary: "List running shell commands",
          description: "List currently running shell commands for a location. Exited commands are not included.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("shell.create", "/api/shell", {
      query: LocationQuery,
      payload: Shell.CreateInput,
      success: Location.response(Shell.Info),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.shell.create",
          summary: "Run shell command",
          description:
            "Spawn one non-interactive shell command for a location. Combined stdout/stderr is captured to a file pageable via output.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("shell.get", "/api/shell/:id", {
      params: { id: Shell.ID },
      query: LocationQuery,
      success: Location.response(Shell.Info),
      error: ShellNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.shell.get",
          summary: "Get shell command",
          description: "Get one shell command, including its status and exit code once exited.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.patch("shell.timeout", "/api/shell/:id/timeout", {
      params: { id: Shell.ID },
      query: LocationQuery,
      payload: TimeoutInput,
      success: Location.response(Shell.Info),
      error: ShellNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.shell.timeout",
          summary: "Update shell timeout",
          description: "Replace a running shell command's timeout from now, or clear it with zero.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("shell.output", "/api/shell/:id/output", {
      params: { id: Shell.ID },
      query: Schema.Struct({ ...LocationQuery.fields, ...Shell.OutputInput.fields }),
      success: Location.response(Shell.Output),
      error: ShellNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.shell.output",
          summary: "Read shell output",
          description: "Page through captured combined output by absolute byte cursor.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.delete("shell.remove", "/api/shell/:id", {
      params: { id: Shell.ID },
      query: LocationQuery,
      success: HttpApiSchema.NoContent,
      error: ShellNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.shell.remove",
          summary: "Remove shell command",
          description: "Terminate and remove one shell command and its retained output.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({ title: "shell", description: "Experimental location-scoped shell command routes." }),
  )
