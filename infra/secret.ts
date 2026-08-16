sst.Linkable.wrap(random.RandomPassword, (resource) => ({
  properties: {
    value: resource.result,
  },
}))

export const SECRET = {
  R2AccessKey: new sst.Secret("R2AccessKey", "unknown"),
  R2SecretKey: new sst.Secret("R2SecretKey", "unknown"),
  HoneycombApiKey: new sst.Secret("HONEYCOMB_API_KEY"),
  HoneycombWebhookSecret: new random.RandomPassword("HoneycombWebhookSecret", { length: 24 }),
  SupportApiKey: new sst.Secret("SUPPORT_API_KEY"),
  UpstashRedisRestUrl: new sst.Secret("UpstashRedisRestUrl"),
  UpstashRedisRestToken: new sst.Secret("UpstashRedisRestToken"),
}
