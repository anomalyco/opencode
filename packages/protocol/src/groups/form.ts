import { Form } from "@opencode/schema/form"
import { Location } from "@opencode/schema/location"
import { Context, Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

export const makeFormGroup = <LocationId extends HttpApiMiddleware.AnyId, LocationService>(
  locationMiddleware: Context.Key<LocationId, LocationService>,
) =>
  HttpApiGroup.make("server.form")
    .add(
      HttpApiEndpoint.get("form.list", "/api/form", {
        query: LocationQuery,
        success: Location.response(Schema.Array(Form.Info)),
      })
        .annotateMerge(locationQueryOpenApi)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "form.list",
            summary: "List pending forms",
            description: "Retrieve pending forms for a location.",
          }),
        ),
    )
    .middleware(locationMiddleware)
    .annotateMerge(OpenApi.annotations({ title: "form", description: "Location form routes." }))
