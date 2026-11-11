// The stage's resources, read from the environment. Deployed Workers (services/data) get them as bindings, which
// nodejs_compat copies into process.env; scripts on your machine read your exported variables. Each value is read
// when used, so importing this module never touches the environment.
const ACCOUNT_ID = "15d29c8639fd3733b1b5486a2acfd968"

function required(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

function stage() {
  return process.env.STAGE === "production" ? "production" : "dev"
}

export const Resource = {
  App: {
    get stage() {
      return stage()
    },
  },
  DataDatabase: {
    database: "opencode-stats",
    port: 3306,
    get host() {
      return required("DATA_DATABASE_HOST")
    },
    get username() {
      return required("DATA_DATABASE_USERNAME")
    },
    get password() {
      return required("DATA_DATABASE_PASSWORD")
    },
    get url() {
      return `mysql://${encodeURIComponent(this.username)}:${encodeURIComponent(this.password)}@${this.host}/${this.database}`
    },
  },
  R2Sql: {
    accountId: ACCOUNT_ID,
    namespace: "inference",
    table: "generation",
    get bucket() {
      return `platform-${stage()}-lake`
    },
  },
  R2SqlAuthToken: {
    get value() {
      return required("R2_SQL_AUTH_TOKEN")
    },
  },
  // Comma-separated model IDs kept off the public data site. A secret, so excluding an unreleased model does not
  // publish its name in git.
  DataHiddenModels: {
    get value() {
      return process.env.DATA_HIDDEN_MODELS ?? ""
    },
  },
  DataSyncConfig: {
    dataset: "zen",
  },
}
