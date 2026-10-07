# Dakota's desktop themes

Updated onto upstream V2 commit `34cf183c4c`, on local branch `dakota-themes`.
The installed `/Applications/OpenCode.app` is unchanged.

## Run locally

From `/Users/dakotacarnes/repos/opencode`:

```sh
bun install --frozen-lockfile
bun run dev:desktop --download-server 2.0.24
```

This runs the local desktop UI with a downloaded release server. To also run
the backend from the updated source, use `bun run dev:desktop` instead.
The desktop development script uses an isolated local server; it does not
restart the production app or its server.

Choose the themes in the desktop app's appearance settings. Both light and
dark palettes are included.

The development UI also has a temporary top-right "Your themes" switcher
on every page, listing only Dakota's seven themes, with a light/dark/system
selector. It is mounted once above the routes, so switching does not navigate
or change the current session. `import.meta.env.DEV` excludes it from release
builds. Remove `src/dev/theme-switcher.tsx` and its mount/import in
`packages/app/src/app.tsx` when it is no longer needed.

## What requires code?

| Display name | JSON file | Custom behaviour |
| --- | --- | --- |
| Buttercream | `buttercream.json` | None; ordinary palette and syntax colours. |
| Seafoam | `kota.json` | None; ordinary palette and syntax colours. |
| Evelyn | `forest.json` | Colour-only; shared CSS consumes its custom canvas, tab-text and wordmark tokens. |
| Mermaid | `mermaid.json` | Colour-only; shared CSS consumes its custom canvas, tab-text and wordmark tokens. |
| Elle | `elle.json` | Law-themed emoji tab avatars, plus shared colour-token CSS. |
| Sunshine Citron | `kota-blush.json` | Citrus emoji tab avatars, plus shared colour-token CSS. |
| Me Espresso | `sweetheart.json` | Kiss tab avatars, an espresso-martini send icon, a pink composer, plus shared colour-token CSS. |

All theme JSON files are in `packages/ui/src/theme/themes/`. Names are listed
in `packages/ui/src/theme/context.tsx`. The desktop app bundles these files;
the production desktop app currently has no user-facing theme importer.
These are desktop definitions, not terminal theme files.

The fancy features are in:

- `packages/app/src/shell/layout/session-tab-avatar.tsx`
- `packages/ui/src/data-display/project-avatar/project-avatar.tsx`
- `packages/ui/src/data-display/project-avatar/project-avatar.css`
- `packages/ui/src/actions/icon-button/icon-button.css`

Shared colour support is in:

- `packages/app/src/index.css`
- `packages/app/src/shell/titlebar/tab-nav.css`

Pop Star and its custom logo/icon code have been removed. The old changes
were migrated to current UI locations rather than restoring obsolete files.

## Handoff

The `dakota-themes` branch is prepared for review against the fork's updated
`v2` branch. Session screenshots for every theme in both modes are in
`docs/theme-previews/README.md`.
The pre-update user work remains in the Git stash named
`Dakota custom themes and UI before V2 update` as a recovery copy. Do not
reapply it blindly: it uses retired paths and includes removed Pop Star UI.
