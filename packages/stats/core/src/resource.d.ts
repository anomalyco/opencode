import "sst/resource"

declare module "sst/resource" {
  export interface Resource {
    StatsPublicModelAliases: {
      type: "sst.sst.Secret"
      value: string
    }
    R2Sql: {
      accountId: string
      bucket: string
      namespace: string
      table: string
      type: "sst.sst.Linkable"
    }
    R2SqlAuthToken: {
      type: "sst.sst.Secret"
      value: string
    }
    StatsHiddenModels: {
      type: "sst.sst.Secret"
      value: string
    }
    StatsSyncConfig: {
      dataset: string
      type: "sst.sst.Linkable"
    }
    StatsDatabase: {
      database: string
      host: string
      password: string
      port: number
      type: "sst.sst.Linkable"
      url: string
      username: string
    }
  }
}
