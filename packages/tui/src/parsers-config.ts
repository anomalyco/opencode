// The committed stub exports `{}`, so dev falls back to pinned URLs. During a build,
// `build.ts` replaces it with embedded `$bunfs` paths via `import { type: "file" }`.
import bundled from "./bundled-grammars.gen"
import { bundledGrammars } from "../../opencode/script/bundled-grammars"

const bundledAsset = (name: string, kind: string) => {
  const paths = bundled[name]?.queries?.[kind]
  return paths?.length ? paths : (bundledGrammars[name]?.queries[kind]?.map((asset) => asset.url) ?? [])
}

export default {
  // NOTE: FOR markdown, javascript and typescript, we use the opentui built-in parsers
  // Warn: when taking queries from the nvim-treesitter repo, make sure to include the query dependencies as well
  //       marked with for example `; inherits: ecma` at the top of the file. Just put the dependencies before the actual query.
  //       ALSO: Some queries use breaking changes in the nvim-treesitter repo, that are not compatible with the (web-)tree-sitter parser.
  parsers: [
    {
      filetype: "python",
      wasm: bundled["python"]?.wasm ?? bundledGrammars.python.wasm.url,
      queries: {
        // NOTE: This nvim-treesitter query is currently broken, because the parser is not compatible with the query apparently.
        //       it is using "except" nodes that the parser is complaining about, but it has been in the query for 3+ years.
        //       Unclear.
        // "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/python/highlights.scm",
        highlights: bundledAsset("python", "highlights"),
        locals: bundledAsset("python", "locals"),
      },
    },
    {
      filetype: "rust",
      wasm: bundled["rust"]?.wasm ?? bundledGrammars.rust.wasm.url,
      queries: {
        highlights: bundledAsset("rust", "highlights"),
        locals: bundledAsset("rust", "locals"),
      },
    },
    {
      filetype: "go",
      wasm: bundled["go"]?.wasm ?? bundledGrammars.go.wasm.url,
      queries: {
        highlights: bundledAsset("go", "highlights"),
        locals: bundledAsset("go", "locals"),
      },
    },
    {
      filetype: "cpp",
      wasm: bundled["cpp"]?.wasm ?? bundledGrammars.cpp.wasm.url,
      queries: {
        highlights: bundledAsset("cpp", "highlights"),
        locals: bundledAsset("cpp", "locals"),
      },
    },
    {
      filetype: "csharp",
      wasm: bundled["csharp"]?.wasm ?? bundledGrammars.csharp.wasm.url,
      queries: {
        highlights: bundledAsset("csharp", "highlights"),
        locals: bundledAsset("csharp", "locals"),
      },
    },
    {
      filetype: "bash",
      wasm: bundled["bash"]?.wasm ?? bundledGrammars.bash.wasm.url,
      queries: {
        highlights: bundledAsset("bash", "highlights"),
      },
    },
    {
      filetype: "c",
      wasm: bundled["c"]?.wasm ?? bundledGrammars.c.wasm.url,
      queries: {
        highlights: bundledAsset("c", "highlights"),
        locals: bundledAsset("c", "locals"),
      },
    },
    {
      filetype: "java",
      wasm: bundled["java"]?.wasm ?? bundledGrammars.java.wasm.url,
      queries: {
        highlights: bundledAsset("java", "highlights"),
        locals: bundledAsset("java", "locals"),
      },
    },
    {
      filetype: "kotlin",
      wasm: bundled["kotlin"]?.wasm ?? bundledGrammars.kotlin.wasm.url,
      queries: {
        highlights: bundledAsset("kotlin", "highlights"),
        locals: bundledAsset("kotlin", "locals"),
      },
    },
    {
      filetype: "ruby",
      wasm: bundled["ruby"]?.wasm ?? bundledGrammars.ruby.wasm.url,
      queries: {
        highlights: bundledAsset("ruby", "highlights"),
        locals: bundledAsset("ruby", "locals"),
      },
    },
    {
      filetype: "php",
      wasm: bundled["php"]?.wasm ?? bundledGrammars.php.wasm.url,
      queries: {
        // NOTE: This nvim-treesitter query is currently broken, because the parser is not compatible with the query apparently.
        // "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/php/highlights.scm",
        highlights: bundledAsset("php", "highlights"),
      },
    },
    {
      filetype: "scala",
      wasm: bundled["scala"]?.wasm ?? bundledGrammars.scala.wasm.url,
      queries: {
        highlights: bundledAsset("scala", "highlights"),
      },
    },
    {
      filetype: "html",
      wasm: bundled["html"]?.wasm ?? bundledGrammars.html.wasm.url,
      queries: {
        // NOTE: This nvim-treesitter query is currently broken, because the parser is not compatible with the query apparently.
        // "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/html/highlights.scm",
        highlights: bundledAsset("html", "highlights"),
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
      filetype: "vue",
      wasm: bundled["vue"]?.wasm ?? bundledGrammars.vue.wasm.url,
      queries: {
        highlights: bundledAsset("vue", "highlights"),
      },
    },
    {
      filetype: "hcl",
      wasm: bundled["hcl"]?.wasm ?? bundledGrammars.hcl.wasm.url,
      queries: {
        highlights: bundledAsset("hcl", "highlights"),
      },
    },
    {
      filetype: "json",
      wasm: bundled["json"]?.wasm ?? bundledGrammars.json.wasm.url,
      queries: {
        highlights: bundledAsset("json", "highlights"),
      },
    },
    {
      filetype: "yaml",
      wasm: bundled["yaml"]?.wasm ?? bundledGrammars.yaml.wasm.url,
      queries: {
        highlights: bundledAsset("yaml", "highlights"),
      },
    },
    {
      filetype: "haskell",
      wasm: bundled["haskell"]?.wasm ?? bundledGrammars.haskell.wasm.url,
      queries: {
        highlights: bundledAsset("haskell", "highlights"),
      },
    },
    {
      filetype: "css",
      wasm: bundled["css"]?.wasm ?? bundledGrammars.css.wasm.url,
      queries: {
        highlights: bundledAsset("css", "highlights"),
      },
    },
    {
      filetype: "julia",
      wasm: bundled["julia"]?.wasm ?? bundledGrammars.julia.wasm.url,
      queries: {
        highlights: bundledAsset("julia", "highlights"),
      },
    },
    {
      filetype: "lua",
      wasm: bundled["lua"]?.wasm ?? bundledGrammars.lua.wasm.url,
      queries: {
        highlights: bundledAsset("lua", "highlights"),
        locals: bundledAsset("lua", "locals"),
      },
    },
    {
      filetype: "ocaml",
      wasm: bundled["ocaml"]?.wasm ?? bundledGrammars.ocaml.wasm.url,
      queries: {
        highlights: bundledAsset("ocaml", "highlights"),
      },
    },
    {
      filetype: "clojure",
      // temporarily using fork to fix issues
      wasm: bundled["clojure"]?.wasm ?? bundledGrammars.clojure.wasm.url,
      queries: {
        highlights: bundledAsset("clojure", "highlights"),
      },
    },
    {
      filetype: "swift",
      wasm: bundled["swift"]?.wasm ?? bundledGrammars.swift.wasm.url,
      queries: {
        // NOTE: Using parser repo queries instead of nvim-treesitter due to incompatible #lua-match? predicates
        // "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/highlights.scm
        highlights: bundledAsset("swift", "highlights"),
        locals: bundledAsset("swift", "locals"),
      },
    },
    {
      filetype: "toml",
      wasm: bundled["toml"]?.wasm ?? bundledGrammars.toml.wasm.url,
      queries: {
        highlights: bundledAsset("toml", "highlights"),
      },
    },
    {
      filetype: "nix",
      // TODO: Replace with official tree-sitter-nix WASM when published
      // See: https://github.com/nix-community/tree-sitter-nix/issues/66
      wasm: bundled["nix"]?.wasm ?? bundledGrammars.nix.wasm.url,
      queries: {
        highlights: bundledAsset("nix", "highlights"),
        locals: bundledAsset("nix", "locals"),
      },
    },
    {
      filetype: "diff",
      aliases: ["udiff", "patch"],
      wasm: bundled["diff"]?.wasm ?? bundledGrammars.diff.wasm.url,
      queries: {
        highlights: bundledAsset("diff", "highlights"),
      },
    },
    {
      filetype: "elixir",
      wasm: bundled["elixir"]?.wasm ?? bundledGrammars.elixir.wasm.url,
      queries: {
        highlights: bundledAsset("elixir", "highlights"),
        locals: bundledAsset("elixir", "locals"),
      },
    },
    {
      filetype: "fsharp",
      wasm: bundled["fsharp"]?.wasm ?? bundledGrammars.fsharp.wasm.url,
      queries: {
        highlights: bundledAsset("fsharp", "highlights"),
      },
    },
    {
      filetype: "r",
      wasm: bundled["r"]?.wasm ?? bundledGrammars.r.wasm.url,
      queries: {
        highlights: bundledAsset("r", "highlights"),
        locals: bundledAsset("r", "locals"),
      },
    },
    {
      filetype: "make",
      aliases: ["makefile"],
      wasm: bundled["make"]?.wasm ?? bundledGrammars.make.wasm.url,
      queries: {
        highlights: bundledAsset("make", "highlights"),
      },
    },
    {
      filetype: "vim",
      wasm: bundled["vim"]?.wasm ?? bundledGrammars.vim.wasm.url,
      queries: {
        highlights: bundledAsset("vim", "highlights"),
        locals: bundledAsset("vim", "locals"),
      },
    },
    {
      filetype: "xml",
      wasm: bundled["xml"]?.wasm ?? bundledGrammars.xml.wasm.url,
      queries: {
        highlights: bundledAsset("xml", "highlights"),
        locals: bundledAsset("xml", "locals"),
      },
    },
    {
      filetype: "agda",
      wasm: bundled["agda"]?.wasm ?? bundledGrammars.agda.wasm.url,
      queries: {
        highlights: bundledAsset("agda", "highlights"),
      },
    },
  ],
}
