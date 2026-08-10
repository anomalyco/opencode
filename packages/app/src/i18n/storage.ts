// Storage maintenance is experimental. Non-English dictionaries spread this
// block until translations are supplied by translators.
export const STORAGE_FALLBACK = {
  "settings.tab.storage": "Storage",
  "settings.storage.title": "Storage",
  "settings.storage.description":
    "Inspect and maintain the SQLite database used by this server. Maintenance runs against the selected server, not only this desktop app.",
  "settings.storage.status.loading": "Loading database information…",
  "settings.storage.progress.idle": "Preparing storage maintenance…",
  "settings.storage.progress.snapshot": "Creating a consistent analysis snapshot…",
  "settings.storage.progress.verify": "Checking snapshot integrity…",
  "settings.storage.progress.index": "Indexing event snapshots…",
  "settings.storage.progress.analyze": "Analyzing safe cleanup candidates…",
  "settings.storage.progress.backup": "Creating and verifying a backup…",
  "settings.storage.progress.drain": "Waiting for active session work to finish…",
  "settings.storage.progress.drainDetail": "{{completed}} of {{total}} active tasks finished",
  "settings.storage.progress.compact": "Compacting event history…",
  "settings.storage.progress.checkpoint": "Checkpointing the write-ahead log…",
  "settings.storage.progress.vacuum": "Rebuilding the database…",
  "settings.storage.progress.workers": "{{count}} workers",
  "settings.storage.progress.detail": "{{completed}} of {{total}} · {{count}} workers",
  "settings.storage.section.overview": "Database overview",
  "settings.storage.section.history": "Event history",
  "settings.storage.section.database": "Database files",
  "settings.storage.metric.total": "Files on disk",
  "settings.storage.metric.database": "Database file",
  "settings.storage.metric.wal": "Write-ahead log",
  "settings.storage.metric.allocated": "Allocated pages",
  "settings.storage.metric.reusable": "Reusable pages",
  "settings.storage.metric.path": "Database path",
  "settings.storage.action.analyze": "Analyze",
  "settings.storage.action.analyze.description":
    "Find superseded message snapshots that can be replaced without changing replayed sessions. The scan does not alter session history and temporarily needs about the current database size for a verified snapshot.",
  "settings.storage.action.backup": "Create backup",
  "settings.storage.action.backup.description":
    "Create a consistent, integrity-checked copy next to the active database.",
  "settings.storage.action.compact": "Compact history",
  "settings.storage.action.compact.description":
    "Replace only replay-safe superseded event snapshots. A verified backup is created automatically first.",
  "settings.storage.action.checkpoint": "Checkpoint WAL",
  "settings.storage.action.checkpoint.description":
    "Move committed write-ahead log frames into the database and truncate the log when active readers allow it.",
  "settings.storage.action.vacuum": "Vacuum database",
  "settings.storage.action.vacuum.description":
    "Rebuild the database to return reusable pages to the filesystem. A verified backup is created automatically first.",
  "settings.storage.analysis.candidates": "Safe candidates",
  "settings.storage.analysis.reclaimable": "Logical payload",
  "settings.storage.analysis.excluded": "Excluded",
  "settings.storage.analysis.type": "{{count}} events · {{size}}",
  "settings.storage.analysis.note":
    "Compact history reduces stored event payloads. Run Vacuum separately to shrink the physical database file.",
  "settings.storage.confirm.backup.title": "Create a verified backup?",
  "settings.storage.confirm.backup.description":
    "The backup is written next to the active database and is not removed automatically.",
  "settings.storage.confirm.backup.estimate": "Allow approximately {{size}} of additional disk space.",
  "settings.storage.confirm.compact.title": "Compact event history?",
  "settings.storage.confirm.compact.description":
    "Only snapshots that pass replay and compatibility checks are replaced. The verified backup remains on disk and its path is shown when the operation completes.",
  "settings.storage.confirm.compact.estimate":
    "Up to {{count}} events and {{size}} of payload are currently eligible. The automatic backup may need about {{backup}}.",
  "settings.storage.confirm.checkpoint.title": "Checkpoint the write-ahead log?",
  "settings.storage.confirm.checkpoint.description":
    "Committed frames will be moved into the database. An active reader can prevent complete truncation without losing data.",
  "settings.storage.confirm.checkpoint.estimate": "The write-ahead log currently uses {{size}}.",
  "settings.storage.confirm.vacuum.title": "Rebuild the database?",
  "settings.storage.confirm.vacuum.description":
    "Vacuum can temporarily block database work while SQLite rebuilds the file. The verified backup remains on disk and its path is shown when the operation completes.",
  "settings.storage.confirm.vacuum.estimate":
    "About {{size}} is currently reusable. The automatic backup may need about {{backup}}.",
  "settings.storage.result.analyze": "Found {{count}} safe candidates with {{size}} of logical payload.",
  "settings.storage.result.backup": "Created and verified a {{size}} backup.",
  "settings.storage.result.compact": "Replaced {{count}} snapshots representing {{size}} of logical payload.",
  "settings.storage.result.checkpoint": "Reduced the write-ahead log from {{before}} to {{after}}.",
  "settings.storage.result.checkpointBusy":
    "An active reader prevented complete truncation; the write-ahead log changed from {{before}} to {{after}}.",
  "settings.storage.result.vacuum": "Reduced database files on disk by {{size}}.",
  "settings.storage.result.vacuumCheckpointBusy":
    "Returned {{size}}, but active readers prevented the final WAL checkpoint.",
  "settings.storage.result.completed": "Maintenance completed",
  "settings.storage.result.failed": "Maintenance failed",
  "settings.storage.result.backupPath": "Verified backup: ",
  "settings.storage.toast.completed": "Storage maintenance completed",
  "settings.storage.error.unavailable": "Storage maintenance is unavailable on this server.",
  "settings.storage.error.emptyResponse": "The server returned an empty storage response.",
} as const
