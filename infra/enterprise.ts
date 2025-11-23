import { domain } from "./stage"

const storage = new sst.cloudflare.Bucket("EnterpriseStorage")
const token = new cloudflare.ApiToken("EnterpriseStorageToken", {
  name: `${$app.name}-${$app.stage}-enterprise-storage`,
  policies: [
    {
      effect: "allow",
      resources: {
        "com.cloudflare.api.account.*": "*",
      },
      permissionGroups: [
        {
          id: "c8d07a38f1654800b34e33e59b4e8f41",
        },
      ],
    },
  ],
})

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
