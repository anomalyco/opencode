// local-only: GENERIERT von script/vendor-parsers.mjs – nicht von Hand ändern.
// Lokale Tree-sitter-Grammatiken; ersetzt die Internet-URLs aus parsers-config.ts.
/// <reference path="./tree-sitter-assets.d.ts" />
import asset0 from "../assets/tree-sitter/python/tree-sitter-python.wasm" with { type: "file" }
import asset1 from "../assets/tree-sitter/python/highlights-0-highlights.scm" with { type: "file" }
import asset2 from "../assets/tree-sitter/python/locals-0-locals.scm" with { type: "file" }
import asset3 from "../assets/tree-sitter/rust/tree-sitter-rust.wasm" with { type: "file" }
import asset4 from "../assets/tree-sitter/rust/highlights-0-highlights.scm" with { type: "file" }
import asset5 from "../assets/tree-sitter/rust/locals-0-locals.scm" with { type: "file" }
import asset6 from "../assets/tree-sitter/go/tree-sitter-go.wasm" with { type: "file" }
import asset7 from "../assets/tree-sitter/go/highlights-0-highlights.scm" with { type: "file" }
import asset8 from "../assets/tree-sitter/go/locals-0-locals.scm" with { type: "file" }
import asset9 from "../assets/tree-sitter/cpp/tree-sitter-cpp.wasm" with { type: "file" }
import asset10 from "../assets/tree-sitter/cpp/highlights-0-highlights.scm" with { type: "file" }
import asset11 from "../assets/tree-sitter/cpp/locals-0-locals.scm" with { type: "file" }
import asset12 from "../assets/tree-sitter/csharp/tree-sitter-c_sharp.wasm" with { type: "file" }
import asset13 from "../assets/tree-sitter/csharp/highlights-0-highlights.scm" with { type: "file" }
import asset14 from "../assets/tree-sitter/csharp/locals-0-locals.scm" with { type: "file" }
import asset15 from "../assets/tree-sitter/bash/tree-sitter-bash.wasm" with { type: "file" }
import asset16 from "../assets/tree-sitter/bash/highlights-0-highlights.scm" with { type: "file" }
import asset17 from "../assets/tree-sitter/c/tree-sitter-c.wasm" with { type: "file" }
import asset18 from "../assets/tree-sitter/c/highlights-0-highlights.scm" with { type: "file" }
import asset19 from "../assets/tree-sitter/c/locals-0-locals.scm" with { type: "file" }
import asset20 from "../assets/tree-sitter/java/tree-sitter-java.wasm" with { type: "file" }
import asset21 from "../assets/tree-sitter/java/highlights-0-highlights.scm" with { type: "file" }
import asset22 from "../assets/tree-sitter/java/locals-0-locals.scm" with { type: "file" }
import asset23 from "../assets/tree-sitter/kotlin/tree-sitter-kotlin.wasm" with { type: "file" }
import asset24 from "../assets/tree-sitter/kotlin/highlights-0-highlights.scm" with { type: "file" }
import asset25 from "../assets/tree-sitter/kotlin/locals-0-locals.scm" with { type: "file" }
import asset26 from "../assets/tree-sitter/ruby/tree-sitter-ruby.wasm" with { type: "file" }
import asset27 from "../assets/tree-sitter/ruby/highlights-0-highlights.scm" with { type: "file" }
import asset28 from "../assets/tree-sitter/ruby/locals-0-locals.scm" with { type: "file" }
import asset29 from "../assets/tree-sitter/php/tree-sitter-php_only.wasm" with { type: "file" }
import asset30 from "../assets/tree-sitter/php/highlights-0-highlights.scm" with { type: "file" }
import asset31 from "../assets/tree-sitter/html/tree-sitter-html.wasm" with { type: "file" }
import asset32 from "../assets/tree-sitter/html/highlights-0-highlights.scm" with { type: "file" }
import asset33 from "../assets/tree-sitter/vue/tree-sitter-vue.wasm" with { type: "file" }
import asset34 from "../assets/tree-sitter/vue/highlights-0-highlights.scm" with { type: "file" }
import asset35 from "../assets/tree-sitter/vue/highlights-1-highlights.scm" with { type: "file" }
import asset36 from "../assets/tree-sitter/json/tree-sitter-json.wasm" with { type: "file" }
import asset37 from "../assets/tree-sitter/json/highlights-0-highlights.scm" with { type: "file" }
import asset38 from "../assets/tree-sitter/yaml/tree-sitter-yaml.wasm" with { type: "file" }
import asset39 from "../assets/tree-sitter/yaml/highlights-0-highlights.scm" with { type: "file" }
import asset40 from "../assets/tree-sitter/css/tree-sitter-css.wasm" with { type: "file" }
import asset41 from "../assets/tree-sitter/css/highlights-0-highlights.scm" with { type: "file" }
import asset42 from "../assets/tree-sitter/swift/tree-sitter-swift.wasm" with { type: "file" }
import asset43 from "../assets/tree-sitter/swift/highlights-0-highlights.scm" with { type: "file" }
import asset44 from "../assets/tree-sitter/swift/locals-0-locals.scm" with { type: "file" }
import asset45 from "../assets/tree-sitter/toml/tree-sitter-toml.wasm" with { type: "file" }
import asset46 from "../assets/tree-sitter/toml/highlights-0-highlights.scm" with { type: "file" }
import asset47 from "../assets/tree-sitter/diff/tree-sitter-diff.wasm" with { type: "file" }
import asset48 from "../assets/tree-sitter/diff/highlights-0-highlights.scm" with { type: "file" }
import asset49 from "../assets/tree-sitter/make/tree-sitter-make.wasm" with { type: "file" }
import asset50 from "../assets/tree-sitter/make/highlights-0-highlights.scm" with { type: "file" }
import asset51 from "../assets/tree-sitter/xml/tree-sitter-xml.wasm" with { type: "file" }
import asset52 from "../assets/tree-sitter/xml/highlights-0-highlights.scm" with { type: "file" }
import asset53 from "../assets/tree-sitter/xml/locals-0-locals.scm" with { type: "file" }

export const parsers = [
  { filetype: "python", wasm: asset0, queries: { highlights: [asset1], locals: [asset2] } },
  { filetype: "rust", wasm: asset3, queries: { highlights: [asset4], locals: [asset5] } },
  { filetype: "go", wasm: asset6, queries: { highlights: [asset7], locals: [asset8] } },
  { filetype: "cpp", wasm: asset9, queries: { highlights: [asset10], locals: [asset11] } },
  { filetype: "csharp", wasm: asset12, queries: { highlights: [asset13], locals: [asset14] } },
  { filetype: "bash", wasm: asset15, queries: { highlights: [asset16] } },
  { filetype: "c", wasm: asset17, queries: { highlights: [asset18], locals: [asset19] } },
  { filetype: "java", wasm: asset20, queries: { highlights: [asset21], locals: [asset22] } },
  { filetype: "kotlin", wasm: asset23, queries: { highlights: [asset24], locals: [asset25] } },
  { filetype: "ruby", wasm: asset26, queries: { highlights: [asset27], locals: [asset28] } },
  { filetype: "php", wasm: asset29, queries: { highlights: [asset30] } },
  { filetype: "html", wasm: asset31, queries: { highlights: [asset32] } },
  { filetype: "vue", wasm: asset33, queries: { highlights: [asset34, asset35] } },
  { filetype: "json", wasm: asset36, queries: { highlights: [asset37] } },
  { filetype: "yaml", wasm: asset38, queries: { highlights: [asset39] } },
  { filetype: "css", wasm: asset40, queries: { highlights: [asset41] } },
  { filetype: "swift", wasm: asset42, queries: { highlights: [asset43], locals: [asset44] } },
  { filetype: "toml", wasm: asset45, queries: { highlights: [asset46] } },
  { filetype: "diff", aliases: ["udiff","patch"], wasm: asset47, queries: { highlights: [asset48] } },
  { filetype: "make", aliases: ["makefile"], wasm: asset49, queries: { highlights: [asset50] } },
  { filetype: "xml", wasm: asset51, queries: { highlights: [asset52], locals: [asset53] } },
]
