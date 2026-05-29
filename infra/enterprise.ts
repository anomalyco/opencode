import { SECRET } from "./secret"
import { shortDomain } from "./stage"

const storage = new sst.cloudflare.Bucket("EnterpriseStorage")

new sst.cloudflare.x.SolidStart("Teams", {
  domain: shortDomain,
  path: "packages/enterprise",
  buildCommand: "bun run build:cloudflare",
  environment: {
    IMECODE_STORAGE_ADAPTER: "r2",
    IMECODE_STORAGE_ACCOUNT_ID: sst.cloudflare.DEFAULT_ACCOUNT_ID,
    IMECODE_STORAGE_ACCESS_KEY_ID: SECRET.R2AccessKey.value,
    IMECODE_STORAGE_SECRET_ACCESS_KEY: SECRET.R2SecretKey.value,
    IMECODE_STORAGE_BUCKET: storage.name,
  },
})
