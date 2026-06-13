import "sst/resource"

declare module "sst/resource" {
  export interface Resource {
    Database: {
      database: string
      host: string
      password: string
      port: number
      type: "sst.sst.Linkable"
      username: string
    }
  }
}
