# OpenClaw Return Reload Investigation

## Problem

Desktop should return from OpenClaw to the last active local project without eagerly reloading every cached local project.

Current observed behavior:

- Start desktop with one local project loaded
- Switch to OpenClaw
- Switch back to local
- Multiple local projects become loaded again, including projects the user did not reopen

## Goal

Trace the exact chain that restores local project state after the OpenClaw to local transition and identify the first point where all cached projects become eligible for reload.

## Investigation Targets

- `globalSDK.version` driven server-switch resets
- persisted `server.projects` buckets for local vs OpenClaw
- `rail.projects` reuse on return from OpenClaw
- `layout.projects.open()` and its implicit `loadSessions(root)`
- `visibleSessionDirs()` driven follow-up loads

## Logging Plan

- Remove existing scroll and prompt debugging noise
- Add focused debug logs around:
  - server active-key switches
  - local project bucket reopen/touch operations
  - `layout.projects.open()`
  - `globalSync` server-switch resets
  - `bootstrapInstance()`
  - `loadSessions()`
  - `visibleSessionDirs()` triggered loads

## Success Criteria

- Reproduce the issue with logs
- Identify the first function that expands reload scope beyond the intended local project
- Produce a concrete fix plan that keeps inactive projects unloaded after returning from OpenClaw
