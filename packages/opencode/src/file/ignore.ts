export namespace FileIgnore {
  const DEFAULT_PATTERNS = [
    // Dependencies
    "**/node_modules/**",
    "**/bower_components/**",
    "**/.pnpm-store/**",
    "**/vendor/**",

    // vcs
    "**/.git/**",

    // Build outputs
    "**/dist/**",
    "**/build/**",
    "**/out/**",
    "**/.next/**",
    "**/target/**", // Rust
    "**/bin/**",
    "**/obj/**", // .NET

    // Version control
    "**/.git/**",
    "**/.svn/**",
    "**/.hg/**",

    // IDE/Editor
    "**/.vscode/**",
    "**/.idea/**",
    "**/*.swp",
    "**/*.swo",

    // OS
    "**/.DS_Store",
    "**/Thumbs.db",

    // Logs & temp
    "**/logs/**",
    "**/tmp/**",
    "**/temp/**",
    "**/*.log",

    // Coverage/test outputs
    "**/coverage/**",
    "**/.nyc_output/**",

    // Binary files (regardless of size)
    "**/*.exe",
    "**/*.dll",
    "**/*.so",
    "**/*.dylib",
    "**/*.app/**",
    "**/*.dmg",
    "**/*.pkg",
    "**/*.msi",
    "**/*.deb",
    "**/*.rpm",
    "**/*.jar",
    "**/*.war",
    "**/*.ear",
    "**/*.class",
    "**/*.o",
    "**/*.a",
    "**/*.pyc",
    "**/*.pyo",
    "**/*.wasm",

    // Image files (binary by nature)
    "**/*.jpg",
    "**/*.jpeg",
    "**/*.png",
    "**/*.gif",
    "**/*.bmp",
    "**/*.tiff",
    "**/*.webp",
    "**/*.ico",

    // Media files (binary by nature)
    "**/*.mp4",
    "**/*.avi",
    "**/*.mkv",
    "**/*.mov",
    "**/*.mp3",
    "**/*.wav",
    "**/*.flac",
    "**/*.pdf",

    // Cache directories (can contain binary files)
    "**/__pycache__/**",
    "**/.cache/**",
    "**/cache/**",
    "**/.pytest_cache/**",
    "**/.tox/**",
  ]

  const GLOBS = DEFAULT_PATTERNS.map((p) => new Bun.Glob(p))

  export function match(
    filepath: string,
    opts: {
      extra?: Bun.Glob[]
    },
  ) {
    const extra = opts.extra || []
    for (const glob of [...GLOBS, ...extra]) {
      if (glob.match(filepath)) return true
    }
    return false
  }
}
