import "sst/resource"

declare module "sst/resource" {
  export interface Resource {
    InferenceEvent: {
      catalog: string
      database: string
      region: string
      table: string
      tableBucket: string
      type: "sst.sst.Linkable"
      workgroup: string
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
