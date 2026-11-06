# Services

Independently deployed services supporting OpenCode live here. Runtime packages
and clients live in `packages/`.

| Service                    | Purpose                                | Deployment                       |
| -------------------------- | -------------------------------------- | -------------------------------- |
| [`site`](./site)           | The opencode.ai website                | `deploy-site.yml`, `cf`          |
| [`www`](./www)             | V2 documentation at `/v2`              | `deploy-www.yml`, Wrangler       |
| [`updates`](./updates)     | Release metadata and update selection  | `release.yml`, Wrangler          |
| [`files`](./files)         | Public file distribution at `/files/*` | `deploy-files.yml`, Wrangler     |
| [`changelog`](./changelog) | Release notes at `/changelog`          | `deploy-changelog.yml`, Wrangler |

These directories are Bun workspaces. Run package commands from each service's
directory. Repository-wide Turbo commands discover them through `services/*`.
