import { EMAILOCTOPUS_API_KEY } from "./app"
import { domain } from "./stage"

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
  link: [database, EMAILOCTOPUS_API_KEY],
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

// One instance per run: a plan step, then one step per stat period and retention
// cohort. See packages/stats/README.md for triggering a run by hand.
export const statsSyncWorkflow = new sst.cloudflare.Workflow("StatsSyncWorkflow", {
  handler: "packages/stats/server/src/workflow.ts",
  className: "StatsSyncWorkflow",
  link: [database, r2Sql, r2SqlAuthToken, statsHiddenModels, statsSyncConfig],
  transform: {
    worker: {
      transform: {
        worker: (args) => {
          // Raise CPU time from the 30-second default to the 5-minute maximum for
          // ranking a full week of geo rows.
          args.limits = { cpuMs: 300_000 }
          args.observability = { enabled: true }
        },
      },
    },
  },
})

// Schedules must match packages/stats/server/src/schedule.ts, which maps the
// daily one to a history run.
if (!$dev)
  new sst.cloudflare.Cron("StatsSyncCron", {
    schedules: ["5 * * * *", "20 3 * * *"],
    worker: {
      handler: "packages/stats/server/src/cron.ts",
      link: [statsSyncWorkflow],
      transform: {
        worker: (args) => {
          args.observability = { enabled: true }
        },
      },
    },
  })

new sst.x.DevCommand("StatsSync", {
  link: [database, r2Sql, r2SqlAuthToken, statsHiddenModels, statsSyncConfig],
  dev: {
    command: "bun src/sync.ts",
    directory: "packages/stats/server",
    autostart: false,
  },
})
