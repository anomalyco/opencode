# Services

Independently deployed services supporting OpenCode live here. Runtime packages
and clients live in `packages/`.

| Service                    | Purpose                                | Deployment                       |
| -------------------------- | -------------------------------------- | -------------------------------- |
| [`www`](./www)             | Website and V2 documentation           | `deploy-www.yml`, Wrangler       |
| [`update`](./update)       | Release metadata and update selection  | `deploy-update.yml`, Wrangler    |
| [`files`](./files)         | Public file distribution at `/files/*` | `deploy-files.yml`, Wrangler     |
| [`changelog`](./changelog) | Release notes at `/changelog`          | `deploy-changelog.yml`, Wrangler |

These directories are Bun workspaces. Run package commands from each service's
directory. Repository-wide Turbo commands discover them through `services/*`.
