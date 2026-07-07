# OpenCode documentation

The V2 documentation is a Mintlify site deployed from `packages/docs` on the `dev` branch.

## Local preview

From this directory, run:

```bash
bun dev
```

The preview opens at `http://localhost:3333` and reloads when MDX or `docs.json` changes.

Validate changes before opening a pull request:

```bash
bun validate
bun broken-links
```

The hosted preview is available at [opencode.mintlify.site](https://opencode.mintlify.site).
