import * as digitalocean from "@pulumi/digitalocean"
import * as pulumi from "@pulumi/pulumi"

/** Set `DIGITALOCEAN_TOKEN` in the environment. Stack config: `pulumi config set region nyc3` and `pulumi config set bucketName your-bucket-name`. */

const cfg = new pulumi.Config()
const region = cfg.require("region")
const bucketName = cfg.require("bucketName")

/** Private bucket; app keys stay on the server; browsers only receive presigned PUT/GET URLs from univer-compat. */
const space = new digitalocean.SpacesBucket("univer-exchange", {
  name: bucketName,
  region,
  acl: "private",
  corsRules: [
    {
      allowedHeaders: ["*"],
      allowedMethods: ["GET", "PUT", "POST", "HEAD", "DELETE"],
      allowedOrigins: ["https://app.veritly.co.uk", "https://univer.veritly.co.uk"],
      maxAgeSeconds: 3000,
    },
  ],
})

export const spacesBucketName = space.name
export const spacesRegion = space.region
export const spacesEndpoint = pulumi.interpolate`https://${space.region}.digitaloceanspaces.com`
