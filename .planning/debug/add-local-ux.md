## UAT gap: Add local repo uses text input (no picker)

### Observation

- In the repository manager dialog, "Add local repo" is a free-form text input for a path.
- UAT expectation is a directory picker or clearer guidance; the current UI does not surface a picker and only shows a placeholder.

### Evidence

- `RepositoryManagerDialog` renders a `TextField` labeled "Local repository path" and submits `repo.add({ path })` on click; no directory picker is invoked.

```82:104:packages/app/src/components/repo/repository-manager-dialog.tsx
  <TextField
    label="Local repository path"
    placeholder="~/Projects/my-repo"
    value={localPath()}
    onChange={setLocalPath}
  />
  <Button size="normal" onClick={handleAddLocal}>
    <Icon name="plus-small" size="small" />
    Add local repo
  </Button>
```

- The "Add local" entry in the repo selector uses `DialogSelectDirectory`, which provides a directory list UI.

```123:144:packages/app/src/components/repo/repo-selector.tsx
  const handleAddLocal = () => {
    dialog.show(() => (
      <DialogSelectDirectory
        title="Add local repository"
        multiple={false}
        onSelect={async (result) => {
          const path = Array.isArray(result) ? result[0] : result
          if (!path) return
          // ...
        }}
      />
    ))
  }
```

- Platform APIs already expose a native directory picker on desktop via `openDirectoryPickerDialog`.

```23:58:packages/app/src/context/platform.tsx
  /** Open directory picker dialog (native on Tauri, server-backed on web) */
  openDirectoryPickerDialog?(opts?: { title?: string; multiple?: boolean }): Promise<string | string[] | null>
```

```43:58:packages/desktop/src/index.tsx
  async openDirectoryPickerDialog(opts) {
    const result = await open({
      directory: true,
      multiple: opts?.multiple ?? false,
      title: opts?.title ?? "Choose a folder",
    })
    return result
  },
```

### Root cause

The repository manager dialog implements "Add local repo" as a raw text field, while other entry points already use a directory picker (`DialogSelectDirectory` / `openDirectoryPickerDialog`). This inconsistency leaves users without a picker in the repo manager, making the flow feel confusing and error-prone.

### Suggested fix direction

- Align `RepositoryManagerDialog` with other entry points:
  - Primary: use `platform.openDirectoryPickerDialog` when available and local server.
  - Fallback: use `DialogSelectDirectory` instead of a text field.
- If a text field is kept for power users, add a "Choose folder" button and helper text that clarifies expected format and that `~` expands to the home directory.
