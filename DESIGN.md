# Interaction conventions

## Explicit project directories

Opening a project preserves the exact directory selected by the user. Multiple
checkouts or worktrees sharing a Git project identity may be opened independently
on the same server. Server metadata enriches these entries; it does not replace
them with the first directory registered for that Git project.

An explicitly opened directory takes precedence over another project's workspace
membership when selecting the active project. Closing and reopening an entry must
preserve the same directory. These rules do not change backend project identities,
session history, or the existing visual design.

References: `packages/app/src/context/layout.tsx`,
`packages/app/src/context/global.tsx`, and `packages/app/src/pages/layout.tsx`.

## Explicit local connection requests

The `opencode://connect` link opens a confirmation dialog showing both the local
server address and the exact folder. It does not connect, add a server, or send
project data until confirmed. Cancellation leaves saved choices unchanged.
Confirmation opens a draft on that server without changing the default server,
deleting existing connections, or replacing their credentials. Only unauthenticated
loopback HTTP origins and absolute Unix directories are accepted in the link.

Use the existing dialog and button components, keyboard dismissal, and responsive
width constraints. Long addresses and paths wrap instead of widening the dialog.
The Desktop package advertises support through `Resources/capabilities.json`;
launchers must refuse automatic onboarding when that capability is absent.
