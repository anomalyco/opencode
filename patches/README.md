# Dependency patches

This directory contains Bun `patchedDependencies` for third-party packages that need local fixes before they are available in upstream releases. Bun applies these patches during `bun install` using the exact package versions listed in the root `package.json` and `bun.lock`.

## Active patches

| Package                                      | Patch file                                           | Why it exists                                                                                                                                                                                   | Removal criteria                                                                                                                               |
| -------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `@npmcli/agent@4.0.0`                        | `@npmcli%2Fagent@4.0.0.patch`                        | Converts the internal proxy `URL` object to a string before returning agent options. This avoids downstream consumers receiving a non-serializable `URL` object where a URL string is expected. | Remove after the project no longer resolves `@npmcli/agent@4.0.0`, or after upstream ships equivalent behavior and the dependency is upgraded. |
| `@standard-community/standard-openapi@0.2.9` | `@standard-community%2Fstandard-openapi@0.2.9.patch` | Handles absolute JSON Schema `$ref` values without treating them as local component references. This keeps OpenAPI generation from producing invalid local schema names for external refs.      | Remove after `hono-openapi` or this package resolves to a version with equivalent external `$ref` handling.                                    |
| `solid-js@1.9.10`                            | `solid-js@1.9.10.patch`                              | Applies the Solid transition committed-value fix tracked upstream as Solid issue `#2046`. The app and TUI depend on Solid's committed value being correct during transitions.                   | Remove after the Solid catalog version is upgraded to a release containing the upstream fix.                                                   |

## Maintenance workflow

1. Keep patch filenames in Bun's encoded format: `<package>@<version>.patch`, with `/` encoded as `%2F` for scoped packages.
2. Keep each patch scoped to the installed package contents. Do not include generated `.bun-tag-*` files or absolute local paths.
3. After editing a patch, run `bun install --frozen-lockfile` from the repository root and verify the patched file in `node_modules` contains the intended change.
4. If a dependency version changes, regenerate or remove the matching patch in the same change as the version bump.
5. Prefer upstream fixes. Keep a patch only when the current dependency graph still requires it.
