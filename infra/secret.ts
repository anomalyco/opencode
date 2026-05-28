sst.Linkable.wrap(random.RandomPassword, (resource) => ({
  properties: {
    value: resource.result,
  },
}))

export const SECRET = {
  R2AccessKey: new sst.Secret("R2AccessKey", "unknown"),
  R2SecretKey: new sst.Secret("R2SecretKey", "unknown"),
  HoneycombWebhookSecret: new random.RandomPassword("HoneycombWebhookSecret", { length: 24 }),
}
