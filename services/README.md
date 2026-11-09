# Services

Independently deployed services supporting OpenCode live here. Runtime packages
and clients live in `packages/`.

| Service                | Purpose                                   | Deployment                   |
| ---------------------- | ----------------------------------------- | ---------------------------- |
| [`site`](./site)       | The opencode.ai website and V2 docs       | `deploy-site.yml`, `cf`      |
| [`share`](./share)     | Deprecated: sharing tombstone on opncd.ai | `deploy.yml`, `cf`           |
| [`updates`](./updates) | Release metadata and update selection     | `release.yml`, Wrangler      |
| [`files`](./files)     | Public file distribution at `/files/*`    | `deploy-files.yml`, Wrangler |

These directories are Bun workspaces. Run package commands from each service's
directory. Repository-wide Turbo commands discover them through `services/*`.
