import { EMAILOCTOPUS_API_KEY } from "./app"
import { domain } from "./stage"

// Keep the deployed names and arguments: the R2 stats sync still uses this VPC
// and cluster after the legacy lake is removed.
const lakeVpc = new sst.aws.Vpc("LakeVpc")
const lakeCluster = new sst.aws.Cluster("LakeCluster", { vpc: lakeVpc })

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

export const app = new sst.cloudflare.x.SolidStart("Stats", {
  path: "packages/stats/app",
  buildCommand: "bun run build",
  domain: `stats.${domain}`,
  link: [database, EMAILOCTOPUS_API_KEY, new sst.Secret("StatsPublicModelAliases", "{}")],
  environment: {
    PUBLIC_URL: `https://${domain}/data`,
  },
})

////////////////
// SERVICES
////////////////

const statsSyncConfig = new sst.Linkable("StatsSyncConfig", {
  properties: {
    dataset: "zen",
  },
})

// Comma-separated model IDs kept off the public stats site. A secret, so excluding
// an unreleased model does not publish its name in git.
const statsHiddenModels = new sst.Secret("StatsHiddenModels", "")

const r2SqlAuthToken = new sst.Secret("R2SqlAuthToken")
const r2Sql = new sst.Linkable("R2Sql", {
  properties: {
    accountId: "15d29c8639fd3733b1b5486a2acfd968",
    bucket: `platform-${$app.stage}-lake`,
    namespace: "inference",
    table: "generation",
  },
})

export const statSync = new sst.aws.Service("StatsSyncService", {
  cluster: lakeCluster,
  architecture: "arm64",
  cpu: "0.25 vCPU",
  // 0.5 GB caused an OOM crash loop: every restart immediately re-ran the 4 Athena
  // stats queries (~$5/pass) every ~5 minutes instead of hourly.
  memory: "2 GB",
  image: {
    context: ".",
    dockerfile: "packages/stats/server/Dockerfile",
  },
  command: ["bun", "src/stat-sync.ts"],
  link: [database, r2Sql, r2SqlAuthToken, statsHiddenModels, statsSyncConfig],
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
