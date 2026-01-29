---
created: 2026-01-29T15:24
title: Fix site manifest 401
area: general
files:
  - packages/opencode/src/server/server.ts
---

## Problem

Accessing the UI from Docker yields a 401 when fetching `http://localhost:3000/site.webmanifest`,
which blocks the manifest from loading in the browser.

## Solution

TBD
