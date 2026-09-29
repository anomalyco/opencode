# Invariant: `webcontents-view-security` - WebContentsView Security Policy

> Clauses: 3 | Unwanted: 3 | Witnesses: app-dock-security.test.ts:568-575

## Clauses
- App Dock WebContentsView is created with sandbox:true *(measured: app-dock-security.test.ts:568-575)*
- App Dock WebContentsView is created with contextIsolation:true *(measured: app-dock-security.test.ts:568-575)*
- App Dock WebContentsView is created with nodeIntegration:false *(measured: app-dock-security.test.ts:568-575)*

## Unwanted
- WebContentsView has sandbox:false *(measured: app-dock-security.test.ts:568-575)*
- WebContentsView has contextIsolation:false *(measured: app-dock-security.test.ts:568-575)*
- WebContentsView has nodeIntegration:true *(measured: app-dock-security.test.ts:568-575)*

