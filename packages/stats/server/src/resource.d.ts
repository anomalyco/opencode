import "sst/resource"

declare module "sst/resource" {
  export interface Resource {
    LakeIngestConfig: {
      secret: string
      streamName: string
      type: "sst.sst.Linkable"
    }
  }
}
