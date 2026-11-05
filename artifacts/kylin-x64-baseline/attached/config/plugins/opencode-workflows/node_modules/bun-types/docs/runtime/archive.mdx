---
title: Archive
description: Create and extract tar archives with Bun's fast native implementation
---

Bun provides a fast, native implementation for working with tar archives through `Bun.Archive`. It supports creating archives from in-memory data, extracting archives to disk, and reading archive contents without extraction.

## Quickstart

**Create an archive from files:**

```ts
const archive = new Bun.Archive({
  "hello.txt": "Hello, World!",
  "data.json": JSON.stringify({ foo: "bar" }),
  "nested/file.txt": "Nested content",
});

// Write to disk
await Bun.write("bundle.tar", archive);
```

**Extract an archive:**

```ts
const tarball = await Bun.file("package.tar.gz").bytes();
const archive = new Bun.Archive(tarball);
const entryCount = await archive.extract("./output");
console.log(`Extracted ${entryCount} entries`);
```

**Read archive contents without extracting:**

```ts
const tarball = await Bun.file("package.tar.gz").bytes();
const archive = new Bun.Archive(tarball);
const files = await archive.files();

for (const [path, file] of files) {
  console.log(`${path}: ${await file.text()}`);
}
```

## Creating Archives

Use `new Bun.Archive()` to create an archive from an object where keys are file paths and values are file contents. By default, archives are uncompressed:

```ts
// Creates an uncompressed tar archive (default)
const archive = new Bun.Archive({
  "README.md": "# My Project",
  "src/index.ts": "console.log('Hello');",
  "package.json": JSON.stringify({ name: "my-project" }),
});
```

File contents can be:

- **Strings** - Text content
- **Blobs** - Binary data
- **ArrayBufferViews** (e.g., `Uint8Array`) - Raw bytes
- **ArrayBuffers** - Raw binary data

```ts
const data = "binary data";
const arrayBuffer = new ArrayBuffer(8);

const archive = new Bun.Archive({
  "text.txt": "Plain text",
  "blob.bin": new Blob([data]),
  "bytes.bin": new Uint8Array([1, 2, 3, 4]),
  "buffer.bin": arrayBuffer,
});
```

### Writing Archives to Disk

Use `Bun.write()` to write an archive to disk:

```ts
// Write uncompressed tar (default)
const archive = new Bun.Archive({
  "file1.txt": "content1",
  "file2.txt": "content2",
});
await Bun.write("output.tar", archive);

// Write gzipped tar
const compressed = new Bun.Archive({ "src/index.ts": "console.log('Hello');" }, { compress: "gzip" });
await Bun.write("output.tar.gz", compressed);
```

### Getting Archive Bytes

Get the archive data as bytes or a Blob:

```ts
const archive = new Bun.Archive({ "hello.txt": "Hello, World!" });

// As Uint8Array
const bytes = await archive.bytes();

// As Blob
const blob = await archive.blob();

// With gzip compression (set at construction)
const gzipped = new Bun.Archive({ "hello.txt": "Hello, World!" }, { compress: "gzip" });
const gzippedBytes = await gzipped.bytes();
const gzippedBlob = await gzipped.blob();
```

## Extracting Archives

### From Existing Archive Data

Create an archive from existing tar/tar.gz data:

```ts
// From a file
const tarball = await Bun.file("package.tar.gz").bytes();
const archiveFromFile = new Bun.Archive(tarball);
```

```ts
// From a fetch response
const response = await fetch("https://example.com/archive.tar.gz");
const archiveFromFetch = new Bun.Archive(await response.blob());
```

### Extracting to Disk

Use `.extract()` to write all files to a directory:

```ts
const tarball = await Bun.file("package.tar.gz").bytes();
const archive = new Bun.Archive(tarball);
const count = await archive.extract("./extracted");
console.log(`Extracted ${count} entries`);
```

The target directory is created automatically if it doesn't exist. Existing files are overwritten. The returned count includes files, directories, and symlinks (on POSIX systems).

**Note**: On Windows, symbolic links in archives are always skipped during extraction. Bun does not attempt to create them regardless of privilege level. On Linux and macOS, symlinks are extracted normally.

**Security note**: Bun.Archive validates paths during extraction, rejecting absolute paths (POSIX `/`, Windows drive letters like `C:\` or `C:/`, and UNC paths like `\\server\share`). Path traversal components (`..`) are normalized away (e.g., `dir/sub/../file` becomes `dir/file`) to prevent directory escape attacks.

### Filtering Extracted Files

Use glob patterns to extract only specific files. Patterns are matched against archive entry paths normalized to use forward slashes (`/`). Positive patterns specify what to include, and negative patterns (prefixed with `!`) specify what to exclude. Negative patterns are applied after positive patterns, so **using only negative patterns will match nothing** (you must include a positive pattern like `**` first):

```ts
const tarball = await Bun.file("package.tar.gz").bytes();
const archive = new Bun.Archive(tarball);

// Extract only TypeScript files
const tsCount = await archive.extract("./extracted", { glob: "**/*.ts" });

// Extract files from multiple directories
const multiCount = await archive.extract("./extracted", {
  glob: ["src/**", "lib/**"],
});
```

Use negative patterns (prefixed with `!`) to exclude files. When mixing positive and negative patterns, entries must match at least one positive pattern and not match any negative pattern:

```ts
// Extract everything except node_modules
const distCount = await archive.extract("./extracted", {
  glob: ["**", "!node_modules/**"],
});

// Extract source files but exclude tests
const srcCount = await archive.extract("./extracted", {
  glob: ["src/**", "!**/*.test.ts", "!**/__tests__/**"],
});
```

## Reading Archive Contents

### Get All Files

Use `.files()` to get archive contents as a `Map` of `File` objects without extracting to disk. Unlike `extract()` which processes all entry types, `files()` returns only regular files (no directories):

```ts
const tarball = await Bun.file("package.tar.gz").bytes();
const archive = new Bun.Archive(tarball);
const files = await archive.files();

for (const [path, file] of files) {
  console.log(`${path}: ${file.size} bytes`);
  console.log(await file.text());
}
```

Each `File` object includes:

- `name` - The file path within the archive (always uses forward slashes `/` as separators)
- `size` - File size in bytes
- `lastModified` - Modification timestamp
- Standard `Blob` methods: `text()`, `arrayBuffer()`, `stream()`, etc.

**Note**: `files()` loads file contents into memory. For large archives, consider using `extract()` to write directly to disk instead.

### Error Handling

Archive operations can fail due to corrupted data, I/O errors, or invalid paths. Use try/catch to handle these cases:

```ts
try {
  const tarball = await Bun.file("package.tar.gz").bytes();
  const archive = new Bun.Archive(tarball);
  const count = await archive.extract("./output");
  console.log(`Extracted ${count} entries`);
} catch (e: unknown) {
  if (e instanceof Error) {
    const error = e as Error & { code?: string };
    if (error.code === "EACCES") {
      console.error("Permission denied");
    } else if (error.code === "ENOSPC") {
      console.error("Disk full");
    } else {
      console.error("Archive error:", error.message);
    }
  } else {
    console.error("Archive error:", String(e));
  }
}
```

Common error scenarios:

- **Corrupted/truncated archives** - `new Archive()` loads the archive data; errors may be deferred until read/extract operations
- **Permission denied** - `extract()` throws if the target directory is not writable
- **Disk full** - `extract()` throws if there's insufficient space
- **Invalid paths** - Operations throw for malformed file paths

The count returned by `extract()` includes all successfully written entries (files, directories, and symlinks on POSIX systems).

**Security note**: Bun.Archive automatically validates paths during extraction. Absolute paths (POSIX `/`, Windows drive letters, UNC paths) and unsafe symlink targets are rejected. Path traversal components (`..`) are normalized away to prevent directory escape.

For additional security with untrusted archives, you can enumerate and validate paths before extraction:

```ts
const archive = new Bun.Archive(untrustedData);
const files = await archive.files();

// Optional: Custom validation for additional checks
for (const [path] of files) {
  // Example: Reject hidden files
  if (path.startsWith(".") || path.includes("/.")) {
    throw new Error(`Hidden file rejected: ${path}`);
  }
  // Example: Whitelist specific directories
  if (!path.startsWith("src/") && !path.startsWith("lib/")) {
    throw new Error(`Unexpected path: ${path}`);
  }
}

// Extract to a controlled destination
await archive.extract("./safe-output");
```

When using `files()` with a glob pattern, an empty `Map` is returned if no files match:

```ts
const matches = await archive.files("*.nonexistent");
if (matches.size === 0) {
  console.log("No matching files found");
}
```

### Filtering with Glob Patterns

Pass a glob pattern to filter which files are returned:

```ts
// Get only TypeScript files
const tsFiles = await archive.files("**/*.ts");

// Get files in src directory
const srcFiles = await archive.files("src/*");

// Get all JSON files (recursive)
const jsonFiles = await archive.files("**/*.json");

// Get multiple file types with array of patterns
const codeFiles = await archive.files(["**/*.ts", "**/*.js"]);
```

Supported glob patterns (subset of [Bun.Glob](/docs/api/glob) syntax):

- `*` - Match any characters except `/`
- `**` - Match any characters including `/`
- `?` - Match single character
- `[abc]` - Match character set
- `{a,b}` - Match alternatives
- `!pattern` - Exclude files matching pattern (negation). Must be combined with positive patterns; using only negative patterns matches nothing.

See [Bun.Glob](/docs/api/glob) for the full glob syntax including escaping and advanced patterns.

## Compression

Bun.Archive creates uncompressed tar archives by default. Use `{ compress: "gzip" }` to enable gzip compression:

```ts
// Default: uncompressed tar
const archive = new Bun.Archive({ "hello.txt": "Hello, World!" });

// Reading: automatically detects gzip
const gzippedTarball = await Bun.file("archive.tar.gz").bytes();
const readArchive = new Bun.Archive(gzippedTarball);

// Enable gzip compression
const compressed = new Bun.Archive({ "hello.txt": "Hello, World!" }, { compress: "gzip" });

// Gzip with custom level (1-12)
const maxCompression = new Bun.Archive({ "hello.txt": "Hello, World!" }, { compress: "gzip", level: 12 });
```

The options accept:

- No options or `undefined` - Uncompressed tar (default)
- `{ compress: "gzip" }` - Enable gzip compression at level 6
- `{ compress: "gzip", level: number }` - Gzip with custom level 1-12 (1 = fastest, 12 = smallest)

## Examples

### Bundle Project Files

```ts
import { Glob } from "bun";

// Collect source files
const files: Record<string, string> = {};
const glob = new Glob("src/**/*.ts");

for await (const path of glob.scan(".")) {
  // Normalize path separators to forward slashes for cross-platform compatibility
  const archivePath = path.replaceAll("\\", "/");
  files[archivePath] = await Bun.file(path).text();
}

// Add package.json
files["package.json"] = await Bun.file("package.json").text();

// Create compressed archive and write to disk
const archive = new Bun.Archive(files, { compress: "gzip" });
await Bun.write("bundle.tar.gz", archive);
```

### Extract and Process npm Package

```ts
const response = await fetch("https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz");
const archive = new Bun.Archive(await response.blob());

// Get package.json
const files = await archive.files("package/package.json");
const packageJson = files.get("package/package.json");

if (packageJson) {
  const pkg = JSON.parse(await packageJson.text());
  console.log(`Package: ${pkg.name}@${pkg.version}`);
}
```

### Create Archive from Directory

```ts
import { readdir } from "node:fs/promises";
import { join } from "node:path";

async function archiveDirectory(dir: string, compress = false): Promise<Bun.Archive> {
  const files: Record<string, Blob> = {};

  async function walk(currentDir: string, prefix: string = "") {
    const entries = await readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      const archivePath = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        await walk(fullPath, archivePath);
      } else {
        files[archivePath] = Bun.file(fullPath);
      }
    }
  }

  await walk(dir);
  return new Bun.Archive(files, compress ? { compress: "gzip" } : undefined);
}

const archive = await archiveDirectory("./my-project", true);
await Bun.write("my-project.tar.gz", archive);
```

## Reference

> **Note**: The following type signatures are simplified for documentation purposes. See [`packages/bun-types/bun.d.ts`](https://github.com/oven-sh/bun/blob/main/packages/bun-types/bun.d.ts) for the full type definitions.

```ts
type ArchiveInput =
  | Record<string, string | Blob | Bun.ArrayBufferView | ArrayBufferLike>
  | Blob
  | Bun.ArrayBufferView
  | ArrayBufferLike;

type ArchiveOptions = {
  /** Compression algorithm. Currently only "gzip" is supported. */
  compress?: "gzip";
  /** Compression level 1-12 (default 6 when gzip is enabled). */
  level?: number;
};

interface ArchiveExtractOptions {
  /** Glob pattern(s) to filter extraction. Supports negative patterns with "!" prefix. */
  glob?: string | readonly string[];
}

class Archive {
  /**
   * Create an Archive from input data
   * @param data - Files to archive (as object) or existing archive data (as bytes/blob)
   * @param options - Compression options. Uncompressed by default.
   *                  Pass { compress: "gzip" } to enable compression.
   */
  constructor(data: ArchiveInput, options?: ArchiveOptions);

  /**
   * Extract archive to a directory
   * @returns Number of entries extracted (files, directories, and symlinks)
   */
  extract(path: string, options?: ArchiveExtractOptions): Promise<number>;

  /**
   * Get archive as a Blob (uses compression setting from constructor)
   */
  blob(): Promise<Blob>;

  /**
   * Get archive as a Uint8Array (uses compression setting from constructor)
   */
  bytes(): Promise<Uint8Array<ArrayBuffer>>;

  /**
   * Get archive contents as File objects (regular files only, no directories)
   */
  files(glob?: string | readonly string[]): Promise<Map<string, File>>;
}
```
