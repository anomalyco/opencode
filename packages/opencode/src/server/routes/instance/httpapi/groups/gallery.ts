import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

// The one typed surface the model gallery is served from (model-gallery-ui
// task 5.7). The web app and the TUI both consume it through the generated
// SDK, so neither owns a private path into the catalog — a second entry point
// would let the two frontends drift into showing different verdicts for the
// same model on the same host, which is precisely the confusion this epic
// exists to remove.
//
// The shape mirrors the data plane deliberately: hosts, then rows. Ranking and
// classification are computed server-side and shipped as data, because they
// depend on llama-skein fit calls a browser cannot make and must not be
// reimplemented per frontend.

const root = "/gallery"

export const GalleryHostInfo = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  baseURL: Schema.String,
  source: Schema.Literals(["mdns", "localhost", "lan"]),
  online: Schema.Boolean,
  installedModelIDs: Schema.Array(Schema.String),
  defaultModel: Schema.NullOr(Schema.String),
}).annotate({ identifier: "GalleryHostInfo" })
export interface GalleryHostInfo extends Schema.Schema.Type<typeof GalleryHostInfo> {}

export const GalleryVariantFit = Schema.Struct({
  variantName: Schema.String,
  fitLevel: Schema.String,
  maxFitCtx: Schema.Number,
  vramRequiredMB: Schema.Number,
  modelMB: Schema.Number,
  reason: Schema.String,
}).annotate({ identifier: "GalleryVariantFit" })

export const GalleryScoreComponent = Schema.Struct({
  kind: Schema.String,
  points: Schema.Number,
  detail: Schema.String,
  measured: Schema.Boolean,
}).annotate({ identifier: "GalleryScoreComponent" })

export const GalleryEntry = Schema.Struct({
  candidateId: Schema.String,
  hostId: Schema.String,
  hostName: Schema.String,
  online: Schema.Boolean,
  installed: Schema.Boolean,
  // Absent means unknown, NOT idle. An unreachable host must never read as
  // free, or a caller dispatches into a hole.
  busy: Schema.optional(Schema.Boolean),
  // False when llama-skein could not be asked. Distinct from "does not fit".
  fitKnown: Schema.Boolean,
  state: Schema.String,
  stateDetail: Schema.String,
  replaces: Schema.optional(Schema.String),
  compatible: Schema.Boolean,
  incompatibleReasons: Schema.Array(Schema.String),
  score: Schema.Number,
  components: Schema.Array(GalleryScoreComponent),
  bestVariant: Schema.NullOr(GalleryVariantFit),
  recommendedVariant: Schema.NullOr(Schema.String),
  variants: Schema.Array(GalleryVariantFit),
  vramFreeMB: Schema.Number,
  vramTotalMB: Schema.Number,
}).annotate({ identifier: "GalleryEntry" })
export interface GalleryEntry extends Schema.Schema.Type<typeof GalleryEntry> {}

export const GalleryEvaluatePayload = Schema.Struct({
  /** Repository ids or search terms already resolved to candidates. */
  candidateIds: Schema.Array(Schema.String),
  /** Restrict to these host ids; empty means every discovered host. */
  hostIds: Schema.optional(Schema.Array(Schema.String)),
  desiredContext: Schema.optional(Schema.Number),
  requiredCapabilities: Schema.optional(Schema.Array(Schema.String)),
  /** Include rows the hard filters rejected, so the UI can explain them. */
  includeIncompatible: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "GalleryEvaluatePayload" })

export const GalleryApi = HttpApi.make("gallery").add(
  HttpApiGroup.make("gallery")
    .add(
      HttpApiEndpoint.get("hosts", `${root}/hosts`, {
        query: WorkspaceRoutingQuery,
        success: described(Schema.Array(GalleryHostInfo), "llama-skein hosts the gallery can offer"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "gallery.hosts",
          summary: "List gallery hosts",
          description:
            "Project opencode's existing llama-skein discovery into gallery hosts. Offline hosts are included so the UI can distinguish 'that host is down' from 'you have no such host'.",
        }),
      ),
      HttpApiEndpoint.post("evaluate", `${root}/evaluate`, {
        query: WorkspaceRoutingQuery,
        payload: GalleryEvaluatePayload,
        success: described(Schema.Array(GalleryEntry), "One ranked, classified entry per candidate/host pair"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "gallery.evaluate",
          summary: "Evaluate candidates across hosts",
          description:
            "Batch each candidate's variants through bounded concurrent hypothetical-fit calls to every compatible host, then filter, classify and rank. Entries carry an explained score breakdown rather than a bare number.",
        }),
      ),
    )
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware),
)
