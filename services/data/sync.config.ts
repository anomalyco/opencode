import { bindings, defineConfig, exports, triggers } from "cf/config"

// The Worker that syncs R2 SQL aggregates into the data database (packages/stats/server/src/worker.ts): the
// StatsSyncWorkflow, and the cron handler that starts its runs. The schedules must match
// packages/stats/server/src/schedule.ts, which maps the daily one to a history run.
export default defineConfig(({ mode }) => {
  const stage = mode === "dev" ? "dev" : "production"
  const name = `opencode-data-sync-${stage}`
  return {
    // Anomaly
    accountId: "15d29c8639fd3733b1b5486a2acfd968",
    worker: {
      name,
      compatibilityDate: "2026-07-25",
      // Also copies string bindings into process.env (packages/stats/core/src/resource.ts).
      compatibilityFlags: ["nodejs_compat"],
      // The 5-minute maximum, for ranking a full week of geo rows.
      limits: { cpuMs: 300_000 },
      exports: {
        // One instance per run: a plan step, then one step per stat period and retention cohort.
        StatsSyncWorkflow: exports.workflow({ name }),
      },
      env: {
        StatsSyncWorkflow: bindings.workflow({ name, worker: name, exportName: "StatsSyncWorkflow" }),
        STAGE: bindings.text(stage),
        // Set from AWS Secrets Manager (opencode/<stage>/*) by the deploy job.
        DATA_DATABASE_HOST: bindings.secret(),
        DATA_DATABASE_USERNAME: bindings.secret(),
        DATA_DATABASE_PASSWORD: bindings.secret(),
        R2_SQL_AUTH_TOKEN: bindings.secret(),
        DATA_HIDDEN_MODELS: bindings.secret(),
      },
      triggers: [triggers.scheduled({ schedule: "5 * * * *" }), triggers.scheduled({ schedule: "20 3 * * *" })],
      workersDev: false,
      previewUrls: false,
      observability: { enabled: true },
    },
  }
})
