export default {
  // NOTE: FOR markdown, javascript and typescript, we use the opentui built-in parsers
  // Warn: when taking queries from the nvim-treesitter repo, make sure to include the query dependencies as well
  //       marked with for example `; inherits: ecma` at the top of the file. Just put the dependencies before the actual query.
  //       ALSO: Some queries use breaking changes in the nvim-treesitter repo, that are not compatible with the (web-)tree-sitter parser.
  //
  // OFFLINE: When OPENCODE_PARSERS_DIR is set or a local parsers/ directory exists,
  // the resolveOffline() method replaces remote URLs with local file paths.
  parsers: [
    {
      filetype: "python",
      wasm: "https://github.com/tree-sitter/tree-sitter-python/releases/download/v0.23.6/tree-sitter-python.wasm",
      queries: {
        highlights: [
          // NOTE: This nvim-treesitter query is currently broken, because the parser is not compatible with the query apparently.
          //       it is using "except" nodes that the parser is complaining about, but it has been in the query for 3+ years.
          //       Unclear.
          // "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/python/highlights.scm",
          "https://github.com/tree-sitter/tree-sitter-python/raw/refs/heads/master/queries/highlights.scm",
        ],
        locals: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/python/locals.scm",
        ],
      },
    },
    {
      filetype: "rust",
      wasm: "https://github.com/tree-sitter/tree-sitter-rust/releases/download/v0.24.0/tree-sitter-rust.wasm",
      queries: {
        highlights: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/rust/highlights.scm",
        ],
        locals: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/rust/locals.scm",
        ],
      },
    },
    {
      filetype: "go",
      wasm: "https://github.com/tree-sitter/tree-sitter-go/releases/download/v0.25.0/tree-sitter-go.wasm",
      queries: {
        highlights: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/go/highlights.scm",
        ],
        locals: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/go/locals.scm",
        ],
      },
    },
    {
      filetype: "cpp",
      wasm: "https://github.com/tree-sitter/tree-sitter-cpp/releases/download/v0.23.4/tree-sitter-cpp.wasm",
      queries: {
        highlights: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/cpp/highlights.scm",
        ],
        locals: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/cpp/locals.scm",
        ],
      },
    },
    {
      filetype: "csharp",
      wasm: "https://github.com/tree-sitter/tree-sitter-c-sharp/releases/download/v0.23.1/tree-sitter-c_sharp.wasm",
      queries: {
        highlights: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/c_sharp/highlights.scm",
        ],
        locals: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/c_sharp/locals.scm",
        ],
      },
    },
    {
      filetype: "bash",
      wasm: "https://github.com/tree-sitter/tree-sitter-bash/releases/download/v0.25.0/tree-sitter-bash.wasm",
      queries: {
        highlights: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/bash/highlights.scm",
        ],
      },
    },
    {
      filetype: "c",
      wasm: "https://github.com/tree-sitter/tree-sitter-c/releases/download/v0.24.1/tree-sitter-c.wasm",
      queries: {
        highlights: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/c/highlights.scm",
        ],
        locals: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/c/locals.scm",
        ],
      },
    },
    {
      filetype: "java",
      wasm: "https://github.com/tree-sitter/tree-sitter-java/releases/download/v0.23.5/tree-sitter-java.wasm",
      queries: {
        highlights: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/java/highlights.scm",
        ],
        locals: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/java/locals.scm",
        ],
      },
    },
    {
      filetype: "kotlin",
      wasm: "https://github.com/fwcd/tree-sitter-kotlin/releases/download/0.3.8/tree-sitter-kotlin.wasm",
      queries: {
        highlights: ["https://raw.githubusercontent.com/fwcd/tree-sitter-kotlin/0.3.8/queries/highlights.scm"],
        locals: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/master/queries/kotlin/locals.scm"],
      },
    },
    {
      filetype: "ruby",
      wasm: "https://github.com/tree-sitter/tree-sitter-ruby/releases/download/v0.23.1/tree-sitter-ruby.wasm",
      queries: {
        highlights: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/ruby/highlights.scm",
        ],
        locals: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/ruby/locals.scm",
        ],
      },
    },
    {
      filetype: "php",
      wasm: "https://github.com/tree-sitter/tree-sitter-php/releases/download/v0.24.2/tree-sitter-php.wasm",
      queries: {
        highlights: [
          // NOTE: This nvim-treesitter query is currently broken, because the parser is not compatible with the query apparently.
          // "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/php/highlights.scm",
          "https://github.com/tree-sitter/tree-sitter-php/raw/refs/heads/master/queries/highlights.scm",
        ],
      },
    },
    {
      filetype: "scala",
      wasm: "https://github.com/tree-sitter/tree-sitter-scala/releases/download/v0.24.0/tree-sitter-scala.wasm",
      queries: {
        highlights: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/scala/highlights.scm",
        ],
      },
    },
    {
      filetype: "html",
      wasm: "https://github.com/tree-sitter/tree-sitter-html/releases/download/v0.23.2/tree-sitter-html.wasm",
      queries: {
        highlights: [
          // NOTE: This nvim-treesitter query is currently broken, because the parser is not compatible with the query apparently.
          // "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/html/highlights.scm",
          "https://github.com/tree-sitter/tree-sitter-html/raw/refs/heads/master/queries/highlights.scm",
        ],
        // TODO: Injections not working for some reason
        // injections: [
        //   "https://github.com/tree-sitter/tree-sitter-html/raw/refs/heads/master/queries/injections.scm",
        // ],
      },
      // injectionMapping: {
      //   nodeTypes: {
      //     script_element: "javascript",
      //     style_element: "css",
      //   },
      //   infoStringMap: {
      //     javascript: "javascript",
      //     css: "css",
      //   },
      // },
    },
    {
      filetype: "hcl",
      wasm: "https://github.com/tree-sitter-grammars/tree-sitter-hcl/releases/download/v1.2.0/tree-sitter-hcl.wasm",
      queries: {
        highlights: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/master/queries/hcl/highlights.scm",
        ],
      },
    },
    {
      filetype: "json",
      wasm: "https://github.com/tree-sitter/tree-sitter-json/releases/download/v0.24.8/tree-sitter-json.wasm",
      queries: {
        highlights: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/json/highlights.scm",
        ],
      },
    },
    {
      filetype: "yaml",
      wasm: "https://github.com/tree-sitter-grammars/tree-sitter-yaml/releases/download/v0.7.2/tree-sitter-yaml.wasm",
      queries: {
        highlights: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/yaml/highlights.scm",
        ],
      },
    },
    {
      filetype: "haskell",
      wasm: "https://github.com/tree-sitter/tree-sitter-haskell/releases/download/v0.23.1/tree-sitter-haskell.wasm",
      queries: {
        highlights: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/haskell/highlights.scm",
        ],
      },
    },
    {
      filetype: "css",
      wasm: "https://github.com/tree-sitter/tree-sitter-css/releases/download/v0.25.0/tree-sitter-css.wasm",
      queries: {
        highlights: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/css/highlights.scm",
        ],
      },
    },
    {
      filetype: "julia",
      wasm: "https://github.com/tree-sitter/tree-sitter-julia/releases/download/v0.23.1/tree-sitter-julia.wasm",
      queries: {
        highlights: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/julia/highlights.scm",
        ],
      },
    },
    {
      filetype: "lua",
      wasm: "https://github.com/tree-sitter-grammars/tree-sitter-lua/releases/download/v0.5.0/tree-sitter-lua.wasm",
      queries: {
        highlights: [
          "https://raw.githubusercontent.com/tree-sitter-grammars/tree-sitter-lua/v0.5.0/queries/highlights.scm",
        ],
        locals: ["https://raw.githubusercontent.com/tree-sitter-grammars/tree-sitter-lua/v0.5.0/queries/locals.scm"],
      },
    },
    {
      filetype: "ocaml",
      wasm: "https://github.com/tree-sitter/tree-sitter-ocaml/releases/download/v0.24.2/tree-sitter-ocaml.wasm",
      queries: {
        highlights: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/ocaml/highlights.scm",
        ],
      },
    },
    {
      filetype: "clojure",
      // temporarily using fork to fix issues
      wasm: "https://github.com/anomalyco/tree-sitter-clojure/releases/download/v0.0.1/tree-sitter-clojure.wasm",
      queries: {
        highlights: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/clojure/highlights.scm",
        ],
      },
    },
    {
      filetype: "swift",
      wasm: "https://github.com/alex-pinkus/tree-sitter-swift/releases/download/0.7.1/tree-sitter-swift.wasm",
      queries: {
        highlights: [
          // NOTE: Using parser repo queries instead of nvim-treesitter due to incompatible #lua-match? predicates
          // "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/highlights.scm
          "https://raw.githubusercontent.com/alex-pinkus/tree-sitter-swift/main/queries/highlights.scm",
        ],
        locals: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/swift/locals.scm",
        ],
      },
    },
    {
      filetype: "toml",
      wasm: "https://github.com/tree-sitter-grammars/tree-sitter-toml/releases/download/v0.7.0/tree-sitter-toml.wasm",
      queries: {
        highlights: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/master/queries/toml/highlights.scm",
        ],
      },
    },
    {
      filetype: "nix",
      // TODO: Replace with official tree-sitter-nix WASM when published
      // See: https://github.com/nix-community/tree-sitter-nix/issues/66
      wasm: "https://github.com/ast-grep/ast-grep.github.io/raw/40b84530640aa83a0d34a20a2b0623d7b8e5ea97/website/public/parsers/tree-sitter-nix.wasm",
      queries: {
        highlights: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/nix/highlights.scm",
        ],
        locals: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/nix/locals.scm",
        ],
      },
    },
  ],
  /**
   * Resolve parser URLs to local file paths for offline use.
   *
   * When OPENCODE_PARSERS_DIR is set or a local parsers/ directory exists
   * alongside the binary, this replaces remote GitHub URLs with local paths.
   * Falls back to the original URLs when no local cache is available.
   */
  resolveOffline() {
    const fs = require("fs") as typeof import("fs")
    const path = require("path") as typeof import("path")

    // Find parsers directory
    const envDir = process.env.OPENCODE_PARSERS_DIR
    let parsersDir: string | undefined
    if (envDir && fs.existsSync(envDir)) {
      parsersDir = envDir
    } else {
      const bunfsRoot = process.platform === "win32" ? "B:/~BUN/root/" : "/$bunfs/root/"
      const bunfsParsers = path.join(bunfsRoot, "parsers")
      try { if (fs.existsSync(bunfsParsers)) parsersDir = bunfsParsers } catch {}
      if (!parsersDir) {
        const localParsers = path.join(path.dirname(process.execPath), "parsers")
        if (fs.existsSync(localParsers)) parsersDir = localParsers
      }
      if (!parsersDir) {
        const cwdParsers = path.join(process.cwd(), "parsers")
        if (fs.existsSync(cwdParsers)) parsersDir = cwdParsers
      }
    }

    if (!parsersDir) return this

    // Resolve each parser's URLs to local paths
    const resolvedParsers = this.parsers.map((parser) => {
      const ft = parser.filetype
      const ftDir = path.join(parsersDir!, ft)

      // Resolve WASM
      let localWasm = parser.wasm
      if (fs.existsSync(ftDir)) {
        const wasmName = path.basename(new URL(parser.wasm).pathname)
        const wasmPath = path.join(ftDir, wasmName)
        if (fs.existsSync(wasmPath)) {
          localWasm = wasmPath
        } else {
          // Fallback: use any .wasm file in the directory
          const files = fs.readdirSync(ftDir)
          const firstWasm = files.find((f) => f.endsWith(".wasm"))
          if (firstWasm) localWasm = path.join(ftDir, firstWasm)
        }
      }

      // Resolve queries
      let localQueries = parser.queries
      if (parser.queries && fs.existsSync(ftDir)) {
        localQueries = Object.fromEntries(
          Object.entries(parser.queries).map(([queryType, urls]) => [
            queryType,
            urls.map((url) => {
              const queryName = `${queryType}.scm`
              const queryPath = path.join(ftDir, queryName)
              return fs.existsSync(queryPath) ? queryPath : url
            }),
          ]),
        )
      }

      return { ...parser, wasm: localWasm, queries: localQueries }
    })

    return { ...this, parsers: resolvedParsers }
  },
}
