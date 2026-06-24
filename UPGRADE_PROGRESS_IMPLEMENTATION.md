# Upgrade Command Progress Bar Feature

## Overview
This implementation adds progress feedback to the `opencode upgrade` command, addressing issue #31623.

## Changes

### New Files
- `packages/opencode/src/installation/progress.ts` - Progress tracking types and formatting utilities

### Modified Files
- `packages/opencode/src/installation/index.ts` - Added progress callback support to installation methods
- `packages/opencode/src/cli/cmd/upgrade.ts` - Integrated progress callbacks with CLI spinner

## Features

### Progress Stages
- **Checking**: Verifying latest version availability
- **Downloading**: Shows download progress with percentage, file size, and speed (for curl method)
- **Installing**: Installation in progress
- **Complete**: Upgrade finished successfully
- **Failed**: Error occurred with message

### Example Output
```
[spinner] Checking for updates...
[spinner] Downloading v1.17.0 (45%, 10.0 MB, 2.5 MB/s)...
[spinner] Installing...
[✓] Upgrade complete
```

## Implementation Details

### Progress Callback Interface
```typescript
type ProgressCallback = (progress: DownloadProgress | InstallationProgress) => void
```

### Supported Installation Methods
- **curl**: Full progress tracking (percentage, size, speed)
- **npm/pnpm/bun**: Stage-based progress (no detailed percentage)
- **brew/choco/scoop**: Stage-based progress (no detailed percentage)

### Technical Notes
- Progress tracking is optional and backwards compatible
- Stream-based downloading for accurate progress in curl method
- Graceful fallback if progress tracking fails
- Maintains existing error handling behavior

## Testing
Unit tests are included in `packages/opencode/test/installation/progress.test.ts` to verify progress formatting logic.

## Future Enhancements
- Add progress bars for package manager methods (may require different approaches)
- Add estimated time remaining
- Add retry indicators
- Visual progress bar using terminal capabilities