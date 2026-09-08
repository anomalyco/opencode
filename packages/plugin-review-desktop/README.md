# Review and files desktop extension

Built-in renderer extension for Git review, file trees, file previews, diff viewers,
line comments, and native “Open in” actions. It also supplies the compact mobile
review and file presentations.

The extension uses `@opencode/plugin/desktop`, the public client, TanStack Query,
`@opencode/session-ui`, and `@opencode/ui`. It does not import App, Desktop, Core,
or Server internals.

- The host owns panel order, focus, resizing, closing, workspace file caches,
  draft attachments, and annotations.
- The extension owns review queries and refreshes, selection, preview content,
  file navigation, and review preferences.
- Shared `file://` references let timeline links and the composer open documents.
- Related file panels share a content group to retain the sidebar while switching
  preview and pinned files.
- Commands and toolbar actions open files directly. The extension also contributes
  an entry to the optional panel menu.

This is part of the exploratory desktop extension SDK. Preferences use extension
storage; migration of the former host review and “Open in” preferences is pending.

Run `bun typecheck` and `bun test` in this package. App regression fixtures exercise
the real plugin with isolated session, file, and VCS data.
