# OpenCode documentation

The V2 documentation is a Mintlify site deployed from `packages/docs` on the `dev` branch.

## Local preview

The Mintlify CLI requires Node.js 20 through 24.

From this directory, run:

```bash
npx mint dev
```

The preview opens at `http://localhost:3000` and reloads when MDX or `docs.json` changes.

Validate changes before opening a pull request:

```bash
npx mint validate
npx mint broken-links
```

The hosted preview is available at [opencode.mintlify.site](https://opencode.mintlify.site).
