## UAT gap: Add local repo picker behavior (UAT3)

### Observation

- Repository manager "Add local repo" errors on empty input instead of guiding users to a picker.
- The directory picker opens a search-only list that can be empty until typing.
- Selecting a folder closes the picker immediately and does not add the repo in the repository manager flow.
- Desired UX is a navigable folder picker with an explicit "Select" action.

### Evidence

- `RepositoryManagerDialog` enforces a non-empty text input before calling `repo.add`, and does not open a picker when the input is empty.

```46:65:packages/app/src/components/repo/repository-manager-dialog.tsx
  const handleAddLocal = async () => {
    const path = localPath().trim()
    if (!path) {
      showToast({ title: "Path required", description: "Enter a local path to add a repository." })
      return
    }
    try {
      const repo = await globalSDK.client.repo.add({ path }).then((x) => x.data)
      if (repo) {
        setLocalPath("")
        await refetch()
        showToast({ title: "Repository added", description: repo.name })
      }
    } catch (err) {
      showToast({
        title: "Failed to add repository",
        description: err instanceof Error ? err.message : "Unknown error",
      })
    }
  }
```

- The "Choose folder" flow only populates the text field and does not add the repo.

```79:90:packages/app/src/components/repo/repository-manager-dialog.tsx
  const handleSelectDirectory = () => {
    dialog.show(() => (
      <DialogSelectDirectory
        title="Add local repository"
        multiple={false}
        onSelect={(result) => {
          const path = Array.isArray(result) ? result[0] : result
          if (!path) return
          setLocalPath(path)
        }}
      />
    ))
  }
```

- The folder picker closes on any selection and has no explicit "Select" action.

```97:113:packages/app/src/components/dialog-select-directory.tsx
  function resolve(rel: string) {
    const absolute = join(root(), rel)
    props.onSelect(props.multiple ? [absolute] : absolute)
    dialog.close()
  }

  return (
    <Dialog title={props.title ?? "Open project"}>
      <List
        search={{ placeholder: "Search folders", autofocus: true }}
        emptyMessage={state.error || "No folders found"}
        items={directories}
        key={(x) => x}
        onSelect={(path) => {
          if (!path) return
          resolve(path)
        }}
      >
```

- The directory list uses `find.files` and relies on a cached scan that can be empty on the first request, so the initial empty search can legitimately return an empty array until a later query triggers another request.

```122:198:packages/opencode/src/file/index.ts
  const state = Instance.state(async () => {
    type Entry = { files: string[]; dirs: string[] }
    let cache: Entry = { files: [], dirs: [] }
    let fetching = false
    // ...
    const fn = async (result: Entry) => {
      // ...
      fetching = true
      // ... populate result ...
      cache = result
      fetching = false
    }
    fn(cache)

    return {
      async files() {
        if (!fetching) {
          fn({
            files: [],
            dirs: [],
          })
        }
        return cache
      },
    }
  })
```

```372:399:packages/opencode/src/file/index.ts
  export async function search(input: { query: string; limit?: number; dirs?: boolean; type?: "file" | "directory" }) {
    const query = input.query.trim()
    const limit = input.limit ?? 100
    const kind = input.type ?? (input.dirs === false ? "file" : "all")
    log.info("search", { query, kind })

    const result = await state().then((x) => x.files())
    // ...
    if (!query) {
      if (kind === "file") return result.files.slice(0, limit)
      return sortHiddenLast(result.dirs.toSorted()).slice(0, limit)
    }
```

### Root cause

- Repository manager relies on a free-form path input; "Add local repo" only validates the text field and does not funnel users into a picker, so empty input produces a toast rather than a guided flow.
- `DialogSelectDirectory` is search-only and auto-closes on selection; it does not support navigation or a confirm step, so users cannot browse into folders or confirm a selection.
- The folder list is backed by a cached scan that can be empty on the first request, so the initial empty search can show no results until another search triggers a subsequent request.

### Fix direction

- In `RepositoryManagerDialog`, make "Add local repo" open the picker when the input is empty (or disable the add button until a path is set), and optionally auto-add after selection or add a "Use selected path" button.
- Rework `DialogSelectDirectory` into a navigable picker:
  - Track `currentDir` and use `file.list` to show child directories, with breadcrumbs / ".." to navigate up.
  - Provide explicit "Select folder" and "Cancel" actions; do not auto-close on item click.
- Improve empty-state behavior for the current search-based picker:
  - Trigger a second `find.files` request after the initial scan completes (or poll once) so the initial empty search is populated without typing.
  - Alternatively, show a "Loading folders…" state while the scan fills, then re-fetch once.
