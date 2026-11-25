# S3 artifacts

An opt-in OpenCode plugin that publishes artifacts to an S3-compatible bucket (AWS S3, Cloudflare R2, MinIO and others) as public static pages. It registers the `s3` artifact provider only once a bucket is configured.

## Install

```sh
opencode plugin add 'git+https://github.com/anomalyco/opencode.git#path:packages/plugins/s3-artifacts'
```

Then configure it in `opencode.jsonc`:

```jsonc
{
  "plugins": [
    {
      "package": "@opencode/plugin-s3-artifacts",
      "options": {
        "bucket": "my-artifacts",
        "prefix": "pages",
        "publicBaseUrl": "https://my-artifacts.s3.us-east-1.amazonaws.com",
      },
    },
  ],
}
```

| Option                                           |                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bucket`                                         | Required. The bucket objects are written to.                                                                                                                                                                                                                                            |
| `publicBaseUrl`                                  | Required. The URL readers open the bucket at, such as a public bucket URL, an R2 custom domain or a CDN. Artifact links are `<publicBaseUrl>/<prefix>/<artifactID>/<entry>`.                                                                                                            |
| `prefix`                                         | Folder in the bucket that holds every artifact. Defaults to the bucket's root.                                                                                                                                                                                                          |
| `region`                                         | Defaults to `AWS_REGION`, `AWS_DEFAULT_REGION` or `us-east-1`. Use `auto` for R2.                                                                                                                                                                                                       |
| `endpoint`                                       | The S3 API endpoint objects are written through. Defaults to `https://s3.<region>.amazonaws.com`; set it for R2 (`https://<account>.r2.cloudflarestorage.com`) or MinIO. Requests use path-style URLs at the endpoint's origin, so a path in it is ignored.                             |
| `spaRewrite`                                     | Set to `true` only when the host in front of `publicBaseUrl` serves `<prefix>/<artifactID>/index.html` with status 200 for paths under that folder that match no object. Single-page apps are refused without it.                                                                       |
| `profile`                                        | A profile in the shared credentials file to sign with.                                                                                                                                                                                                                                  |
| `accessKeyId`, `secretAccessKey`, `sessionToken` | Keys to sign with. Without them, the plugin uses `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` (and `AWS_SESSION_TOKEN`), then the `AWS_PROFILE` (or `default`) profile's static keys in `~/.aws/credentials` (or `AWS_SHARED_CREDENTIALS_FILE`). It reads no other credential store. |

The keys need `s3:PutObject` and `s3:DeleteObject` on `<bucket>/<prefix>/*`, and readers need public read access to the same objects.

## What it hosts

Static files only, readable by anyone with the link. Each artifact gets its own folder, so pages must link their assets with relative paths. A Markdown entry is rendered to an HTML page next to it, and the link opens that page. Server code, databases, storage and crons are refused before anything is uploaded.

Updates write every file again and delete the ones the artifact no longer has. Deleting an artifact deletes only the objects it published. An artifact is pinned to `s3:<endpoint host>/<bucket>/<prefix>`, so changing any of them refuses updates and deletes of artifacts published before.

## Test

```sh
bun test
```

The tests run against an in-process fake S3. To run the same lifecycle against a real S3-compatible server, set `S3_ARTIFACTS_LIVE_ENDPOINT`, `S3_ARTIFACTS_LIVE_BUCKET`, `S3_ARTIFACTS_LIVE_PUBLIC_BASE_URL`, `S3_ARTIFACTS_LIVE_ACCESS_KEY_ID` and `S3_ARTIFACTS_LIVE_SECRET_ACCESS_KEY`.
