import { domain, zoneID } from "./stage"

// opencode.ai and dev.opencode.ai belong to the site Worker (services/site). Their custom domain used to belong to
// the old Console Worker and was moved to the site Worker in place, keeping its ID (Cloudflare won't let a placeholder
// DNS record sit beside a Worker-managed one, and deleting the record first would leave the apex without DNS).
// SiteDomain adopts that resource so SST never deletes the live hostname: it is retained on delete, and its inputs are
// ignored so it is never updated or replaced. Its state still records the old Console service; Cloudflare has the
// site Worker. Keep it declared: dropping it only forgets it (retainOnDelete), but keeping it is a guaranteed no-op.
if ($app.stage === "production" || $app.stage === "dev") {
  new cloudflare.WorkersCustomDomain(
    "SiteDomain",
    {
      accountId: "15d29c8639fd3733b1b5486a2acfd968",
      hostname: domain,
      service: `opencode-site-${$app.stage}`,
      zoneId: zoneID,
      environment: "production",
    },
    {
      aliases: [
        `urn:pulumi:${$app.stage}::${$app.name}::sst:cloudflare:SolidStart$sst:cloudflare:Worker$cloudflare:index/workersCustomDomain:WorkersCustomDomain::ConsoleWorkerDomain`,
      ],
      retainOnDelete: true,
      ignoreChanges: ["accountId", "hostname", "service", "zoneId", "environment"],
    },
  )
}

// Archived Zen request/response dumps (writer removed May 2026). Retained on purpose; nothing reads or writes them.
new sst.cloudflare.Bucket("ZenData")
new sst.cloudflare.Bucket("ZenDataNew")
