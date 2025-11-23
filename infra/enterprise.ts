import { domain } from "./stage"

const storage = new sst.cloudflare.Bucket("EnterpriseStorage")

const enterprise = new sst.cloudflare.x.SolidStart("Enterprise", {
  domain: "enterprise." + domain,
  environment: {
    OPENCODE_STORAGE_ADAPTER: "r2",
    OPENCODE_STORAGE_ACCOUNT_ID: sst.cloudflare.DEFAULT_ACCOUNT_ID,
    OPENCODE_STORAGE_ACCESS_KEY_ID: "---",
    OPENCODE_STORAGE_SECRET_ACCESS_KEY: "---",
    OPENCODE_STORAGE_BUCKET: storage.name,
  },
})
