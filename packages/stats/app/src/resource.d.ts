import "sst/resource"

declare module "sst/resource" {
  export interface Resource {
    EMAILOCTOPUS_API_KEY: {
      type: "sst.sst.Secret"
      value: string
    }
  }
}
