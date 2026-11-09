import { shortDomain } from "./stage"

// The Share worker takes over the hostname of the retired Teams worker. Cloudflare rejects a second custom domain for
// the same hostname, so adopt the Teams domain and replace it, deleting the old one first.
$transform(cloudflare.WorkersCustomDomain, (_args, opts, name) => {
  if (name !== "ShareDomain") return
  opts.aliases = [
    `urn:pulumi:${$app.stage}::${$app.name}::sst:cloudflare:SolidStart$sst:cloudflare:Worker$cloudflare:index/workersCustomDomain:WorkersCustomDomain::TeamsWorkerDomain`,
  ]
  opts.deleteBeforeReplace = true
  opts.replaceOnChanges = ["*"]
})

new sst.cloudflare.Worker("Share", {
  domain: shortDomain,
  handler: "packages/function/src/share.ts",
})
