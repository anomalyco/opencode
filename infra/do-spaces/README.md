# DigitalOcean Spaces (Univer exchange storage)

Private S3-compatible bucket for `univer-compat` (XLSX exchange uploads and unit bundles). Browsers only receive presigned PUT/GET URLs from the API.

## Prerequisites

- [Pulumi CLI](https://www.pulumi.com/docs/install/)
- `DIGITALOCEAN_TOKEN` (API token; `doctl` config works)
- `SPACES_ACCESS_KEY_ID` and `SPACES_SECRET_ACCESS_KEY` (DigitalOcean → API → Spaces keys; required to create buckets via Pulumi)
- `PULUMI_CONFIG_PASSPHRASE` when using `pulumi login --local` (this repo uses a local state file under `infra/do-spaces/`)

## Provision bucket

```bash
cd infra/do-spaces
bun install

export DIGITALOCEAN_TOKEN="dop_v1_..."

pulumi stack init prod   # once
pulumi config set region ams3
pulumi config set bucketName veritly-univer-exchange

export PULUMI_CONFIG_PASSPHRASE='your-passphrase'
export SPACES_ACCESS_KEY_ID='...'
export SPACES_SECRET_ACCESS_KEY='...'

pulumi login --local
./pulumi-up.sh
# or: pulumi preview && pulumi up
```

Stack outputs: `spacesBucketName`, `spacesRegion`, `spacesEndpoint`.

## Spaces access keys (manual)

Pulumi creates the bucket only. In DigitalOcean → API → Spaces Keys, create a key scoped to this bucket, then add to `.env.production`:

```bash
UNIVER_COMPAT_S3_ENDPOINT=https://ams3.digitaloceanspaces.com
# Optional; may match regional endpoint. If set to bucket host, univer-compat normalizes it for signing.
UNIVER_COMPAT_S3_PRESIGN_ENDPOINT=https://ams3.digitaloceanspaces.com
UNIVER_COMPAT_S3_REGION=ams3
UNIVER_COMPAT_S3_BUCKET=veritly-univer-exchange
UNIVER_COMPAT_S3_ACCESS_KEY=...
UNIVER_COMPAT_S3_SECRET_KEY=...
UNIVER_COMPAT_PERSIST_EVERY_REV=1
```

Sync to the cluster: `./deploy/k8s/sync-env.sh` then deploy `univer-compat` via `./deploy/k8s/deploy-production.sh`.
