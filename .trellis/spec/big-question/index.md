# Electron + Vite Common Pitfalls

> Documented pitfalls from building Electron apps with Vite, React, and SQLite.
> These issues apply to any project using this technology stack.

## Severity Levels

| Level | Description                                   |
| ----- | --------------------------------------------- |
| P0    | App crashes or fails to start                 |
| P1    | Feature completely broken, data loss possible |
| P2    | Degraded experience, workaround exists        |

---

## By Category

### Packaging (Most Critical)

| Document                                                         | Severity | Summary                                       |
| ---------------------------------------------------------------- | -------- | --------------------------------------------- |
| [native-module-packaging.md](./native-module-packaging.md)       | P0       | Native modules missing after packaging        |
| [native-module-complex-deps.md](./native-module-complex-deps.md) | P0       | Native modules with many JS dependencies fail |

### IPC Communication

| Document                                                     | Severity | Summary                                        |
| ------------------------------------------------------------ | -------- | ---------------------------------------------- |
| [ipc-handler-registration.md](./ipc-handler-registration.md) | P1       | IPC handlers not working despite code existing |

### Network

| Document                                                       | Severity | Summary                                      |
| -------------------------------------------------------------- | -------- | -------------------------------------------- |
| [network-stack-differences.md](./network-stack-differences.md) | P1       | Main process fetch fails while browser works |

### Database

| Document                                                         | Severity | Summary                                                |
| ---------------------------------------------------------------- | -------- | ------------------------------------------------------ |
| [timestamp-precision.md](./timestamp-precision.md)               | P1       | Timestamp precision mismatch (seconds vs milliseconds) |
| [transaction-silent-failure.md](./transaction-silent-failure.md) | P1       | Transaction helper functions fail silently             |

### React

| Document                                                   | Severity | Summary                                     |
| ---------------------------------------------------------- | -------- | ------------------------------------------- |
| [react-usestate-function.md](./react-usestate-function.md) | P2       | Storing functions in useState executes them |

### CSS/Layout

| Document                                         | Severity | Summary                                          |
| ------------------------------------------------ | -------- | ------------------------------------------------ |
| [css-flex-centering.md](./css-flex-centering.md) | P2       | Visual vs mathematical centering in flex layouts |

### Hardware / Input

| Document                                               | Severity | Summary                                          |
| ------------------------------------------------------ | -------- | ------------------------------------------------ |
| [bluetooth-hid-device.md](./bluetooth-hid-device.md)   | P2       | Bluetooth remote triggers break normal keyboard  |
| [global-keyboard-hooks.md](./global-keyboard-hooks.md) | P2       | Global hotkeys conflict or limited functionality |

---

## Quick Debugging Checklist

### App Crashes on Startup (P0)

1. Check for `Cannot find module` errors -> See [native-module-packaging.md](./native-module-packaging.md)
2. Check for missing dependencies -> See [native-module-complex-deps.md](./native-module-complex-deps.md)
3. Review `forge.config.ts` ignore patterns

### IPC Not Working (P1)

1. Is the handler registered in `index.ts`? -> See [ipc-handler-registration.md](./ipc-handler-registration.md)
2. Is the channel name consistent across all files?
3. Is the preload API exposed correctly?

### Network Requests Failing (P1)

1. Does `curl` work from terminal?
2. Are you behind a proxy/VPN?
3. Consider using `electron.net.fetch` -> See [network-stack-differences.md](./network-stack-differences.md)

### Data Not Persisting (P1)

1. Check timestamp precision -> See [timestamp-precision.md](./timestamp-precision.md)
2. Check transaction error handling -> See [transaction-silent-failure.md](./transaction-silent-failure.md)

### Hardware Triggers Not Working (P2)

1. Using globalShortcut for Bluetooth remote? -> See [bluetooth-hid-device.md](./bluetooth-hid-device.md)
2. Need push-to-talk or key hold detection? -> See [global-keyboard-hooks.md](./global-keyboard-hooks.md)
3. Check Input Monitoring permission on macOS

---

## Technology Stack Coverage

These pitfalls were discovered while building with:

- **Electron** (v28+) + **Electron Forge**
- **Vite** as bundler
- **React 18** for renderer
- **better-sqlite3** for local database
- **Drizzle ORM** for database abstraction
- **TypeScript** throughout

Most issues apply to similar stacks (e.g., `sqlite3`, Prisma, etc.).
