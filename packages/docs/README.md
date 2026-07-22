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

The V2 theme token reference is generated from
`packages/tui/src/theme/v2/schema.ts`. Regenerate it after schema changes:

```bash
bun run generate
```

`bun validate` checks that the committed snippet is current. The repository's
generation workflow also refreshes it on pushes to `dev`, so Mintlify always
receives the generated MDX as part of the published docs tree.

The hosted preview is available at [opencode.mintlify.site](https://opencode.mintlify.site).
