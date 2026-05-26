import { lakeAthenaWorkgroup, lakeCatalog, lakeCluster, lakeQueryPermissions, lakeRegion, tableBucket } from "./lake"

const domain = (() => {
  if ($app.stage === "production") return "stats.opencode.ai"
  if ($app.stage === "dev") return "stats.dev.opencode.ai"
  return `stats.${$app.stage}.dev.opencode.ai`
})()

////////////////
// LAKE
////////////////

const inferenceNamespace = new aws.s3tables.Namespace("LakeInferenceNamespace", {
  namespace: "inference",
  tableBucketArn: tableBucket.arn,
})

const inferenceEventTable = new aws.s3tables.Table(
  "LakeInferenceEventTable",
  {
    name: "event",
    namespace: inferenceNamespace.namespace,
    tableBucketArn: inferenceNamespace.tableBucketArn,
    format: "ICEBERG",
    metadata: {
      iceberg: {
        schema: {
          fields: [
            { name: "event_timestamp", type: "string", required: false },
            { name: "event_date", type: "string", required: false },
            { name: "event_type", type: "string", required: false },
            { name: "dataset", type: "string", required: false },
            { name: "cf_continent", type: "string", required: false },
            { name: "cf_country", type: "string", required: false },
            { name: "cf_city", type: "string", required: false },
            { name: "cf_region", type: "string", required: false },
            { name: "cf_latitude", type: "double", required: false },
            { name: "cf_longitude", type: "double", required: false },
            { name: "cf_timezone", type: "string", required: false },
            { name: "duration", type: "double", required: false },
            { name: "request_length", type: "long", required: false },
            { name: "status", type: "int", required: false },
            { name: "ip", type: "string", required: false },
            { name: "is_stream", type: "boolean", required: false },
            { name: "session", type: "string", required: false },
            { name: "request", type: "string", required: false },
            { name: "client", type: "string", required: false },
            { name: "user_agent", type: "string", required: false },
            { name: "model_variant", type: "string", required: false },
            { name: "source", type: "string", required: false },
            { name: "provider", type: "string", required: false },
            { name: "provider_model", type: "string", required: false },
            { name: "model", type: "string", required: false },
            { name: "llm_error_code", type: "int", required: false },
            { name: "llm_error_message", type: "string", required: false },
            { name: "error_response", type: "string", required: false },
            { name: "error_type", type: "string", required: false },
            { name: "error_message", type: "string", required: false },
            { name: "error_cause", type: "string", required: false },
            { name: "error_cause2", type: "string", required: false },
            { name: "api_key", type: "string", required: false },
            { name: "workspace", type: "string", required: false },
            { name: "is_subscription", type: "boolean", required: false },
            { name: "subscription", type: "string", required: false },
            { name: "response_length", type: "long", required: false },
            { name: "time_to_first_byte", type: "long", required: false },
            { name: "timestamp_first_byte", type: "long", required: false },
            { name: "timestamp_last_byte", type: "long", required: false },
            { name: "tokens_input", type: "long", required: false },
            { name: "tokens_output", type: "long", required: false },
            { name: "tokens_reasoning", type: "long", required: false },
            { name: "tokens_cache_read", type: "long", required: false },
            { name: "tokens_cache_write_5m", type: "long", required: false },
            { name: "tokens_cache_write_1h", type: "long", required: false },
            { name: "cost_input_microcents", type: "long", required: false },
            { name: "cost_output_microcents", type: "long", required: false },
            { name: "cost_cache_read_microcents", type: "long", required: false },
            { name: "cost_cache_write_microcents", type: "long", required: false },
            { name: "cost_total_microcents", type: "long", required: false },
            { name: "cost_input", type: "long", required: false },
            { name: "cost_output", type: "long", required: false },
            { name: "cost_cache_read", type: "long", required: false },
            { name: "cost_cache_write_5m", type: "long", required: false },
            { name: "cost_cache_write_1h", type: "long", required: false },
            { name: "cost_total", type: "long", required: false },
          ],
        },
      },
    },
  },
  { deleteBeforeReplace: $app.stage !== "production" },
)

export const inferenceEvent = new sst.Linkable("InferenceEvent", {
  properties: {
    region: lakeRegion,
    catalog: lakeCatalog,
    database: inferenceNamespace.namespace,
    table: inferenceEventTable.name,
    tableBucket: tableBucket.name,
    workgroup: lakeAthenaWorkgroup.name,
  },
})

////////////////
// DATABASE
////////////////

const cluster = planetscale.getDatabaseOutput({
  name: "opencode-stats",
  organization: "anomalyco",
})

const branch =
  $app.stage === "production"
    ? planetscale.getBranchOutput({
        name: "production",
        organization: cluster.organization,
        database: cluster.name,
      })
    : new planetscale.Branch("StatsDatabaseBranch", {
        database: cluster.name,
        organization: cluster.organization,
        name: $app.stage,
        parentBranch: "production",
      })

const password = new planetscale.Password("StatsDatabasePassword", {
  name: $app.stage,
  database: cluster.name,
  organization: cluster.organization,
  branch: branch.name,
})

const databaseUrl = $interpolate`mysql://${password.username.apply(encodeURIComponent)}:${password.plaintext.apply(
  encodeURIComponent,
)}@${password.accessHostUrl}/${cluster.name}`

export const database = new sst.Linkable("StatsDatabase", {
  properties: {
    host: password.accessHostUrl,
    database: cluster.name,
    username: password.username,
    password: password.plaintext,
    port: 3306,
    url: databaseUrl,
  },
})

new sst.x.DevCommand("StatsStudio", {
  link: [database],
  environment: {
    DATABASE_URL: databaseUrl,
  },
  dev: {
    command: "bun db:studio",
    directory: "packages/stats/core",
    autostart: false,
  },
})

////////////////
// APP
////////////////

// export const app = new sst.cloudflare.x.SolidStart("Stats", {
//   path: "packages/stats/app",
//   buildCommand: "bun run build",
//   domain,
//   link: [database],
//   environment: {
//     PUBLIC_URL: `https://${domain}`,
//   },
// })

////////////////
// SERVICES
////////////////

const statsSyncConfig = new sst.Linkable("StatsSyncConfig", {
  properties: {
    dataset: "zen",
  },
})

export const statSync = new sst.aws.Service("StatsSyncService", {
  cluster: lakeCluster,
  architecture: "arm64",
  cpu: "0.25 vCPU",
  memory: "0.5 GB",
  image: {
    context: ".",
    dockerfile: "packages/stats/server/Dockerfile",
  },
  command: ["bun", "src/stat-sync.ts"],
  link: [database, inferenceEvent, statsSyncConfig],
  permissions: lakeQueryPermissions,
  scaling: {
    min: 1,
    max: 1,
  },
  dev: {
    command: "bun src/stat-sync.ts",
    directory: "packages/stats/server",
    autostart: false,
  },
})
