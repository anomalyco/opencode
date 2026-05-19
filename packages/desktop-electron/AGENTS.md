# Desktop package notes

- IMPORTANT: All Issues, Pull Requests, and commit messages must be written in Japanese unless the user explicitly requests otherwise. SecureCode developers are all native Japanese speakers.
- Renderer process should only call `window.api` from `src/preload`.
- Main process should register IPC handlers in `src/main/ipc.ts`.
