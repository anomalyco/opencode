//! Tree-sitter grammars (U.4b): the TypeScript TUI's grammars, linked statically, with the highlight queries it uses
//! (`assets/queries`, written by `script/gen/grammars.ts`). Each is registered with
//! [`Grammar::core_captures`], so captures and their styles combine as in Core, and
//! [`crate::code::syntax_theme`] colors the same tokens the same way.
//!
//! opentui-rust bundles JavaScript, TypeScript, TSX, Markdown, Zig, and Rust with each grammar crate's own query.
//! [`register`] replaces those with Core's queries, and the `grammars` feature (on by default) adds the rest of
//! `packages/tui/src/parsers-config.ts`. Kotlin, OCaml, F#, and Swift are not linked
//! (`parity/deviations/H06-highlight-queries.md`).

use opentui::syntax::tree_sitter::Language;
use opentui::syntax::{self, CompiledGrammar, Grammar, GrammarError};
use std::collections::BTreeSet;
use std::sync::{Mutex, Once, PoisonError};
use std::thread;

/// One grammar: its filetype, language, query file under `assets/queries`, and the aliases `parsers-config.ts` gives
/// it.
#[derive(Clone, Copy)]
struct Entry {
    filetype: &'static str,
    language: fn() -> Language,
    query: &'static str,
    injections: &'static str,
    aliases: &'static [&'static str],
}

macro_rules! entry {
    ($filetype:literal, $language:expr) => {
        entry!($filetype, $language, [])
    };
    ($filetype:literal, $language:expr, [$($alias:literal),*]) => {
        Entry {
            filetype: $filetype,
            language: || $language.into(),
            query: include_str!(concat!("../../../../assets/queries/", $filetype, "/highlights.scm")),
            injections: "",
            aliases: &[$($alias),*],
        }
    };
}

/// opentui-rust's Markdown injections, kept because the widget needs them. Core's nvim-treesitter query names a fence's
/// language with a directive only Core implements (`#set-lang-from-info-string!`), and its `inline` content leaves
/// out the punctuation the inline grammar needs. The capture names come from the injected grammars, so the colors
/// stay Core's.
const MARKDOWN_INJECTIONS: &str = r#"
(fenced_code_block
  (info_string (language) @injection.language)
  (code_fence_content) @injection.content
  (#set! injection.include-unnamed-children))
((html_block) @injection.content (#set! injection.language "html"))
((minus_metadata) @injection.content (#set! injection.language "yaml"))
((plus_metadata) @injection.content (#set! injection.language "toml"))
([(inline) (pipe_table_cell)] @injection.content
  (#set! injection.language "markdown_inline")
  (#set! injection.include-unnamed-children))
"#;

/// Every linked grammar. Core gives only Markdown injections, so the others have none.
#[cfg_attr(not(feature = "grammars"), allow(unused_mut))]
fn entries() -> Vec<Entry> {
    use tree_sitter_md as md;
    use tree_sitter_typescript as ts;
    let mut entries = vec![
        entry!("javascript", tree_sitter_javascript::LANGUAGE, ["javascriptreact"]),
        entry!("typescript", ts::LANGUAGE_TYPESCRIPT),
        entry!("typescriptreact", ts::LANGUAGE_TSX),
        Entry { injections: MARKDOWN_INJECTIONS, ..entry!("markdown", md::LANGUAGE) },
        entry!("markdown_inline", md::INLINE_LANGUAGE),
        entry!("zig", tree_sitter_zig::LANGUAGE),
        entry!("rust", tree_sitter_rust::LANGUAGE),
    ];
    #[cfg(feature = "grammars")]
    entries.extend([
        entry!("python", tree_sitter_python::LANGUAGE),
        entry!("go", tree_sitter_go::LANGUAGE),
        entry!("bash", tree_sitter_bash::LANGUAGE),
        entry!("html", tree_sitter_html::LANGUAGE),
        entry!("json", tree_sitter_json::LANGUAGE),
        entry!("yaml", tree_sitter_yaml::LANGUAGE),
        entry!("css", tree_sitter_css::LANGUAGE),
        entry!("diff", tree_sitter_diff::LANGUAGE, ["udiff", "patch"]),
        entry!("cpp", tree_sitter_cpp::LANGUAGE),
        entry!("csharp", tree_sitter_c_sharp::LANGUAGE),
        entry!("c", tree_sitter_c::LANGUAGE),
        entry!("java", tree_sitter_java::LANGUAGE),
        entry!("ruby", tree_sitter_ruby::LANGUAGE),
        entry!("php", tree_sitter_php::LANGUAGE_PHP_ONLY),
        entry!("scala", tree_sitter_scala::LANGUAGE),
        entry!("vue", tree_sitter_vue_next::LANGUAGE),
        entry!("hcl", tree_sitter_hcl::LANGUAGE),
        entry!("haskell", tree_sitter_haskell::LANGUAGE),
        entry!("julia", tree_sitter_julia::LANGUAGE),
        entry!("lua", tree_sitter_lua::LANGUAGE),
        entry!("clojure", tree_sitter_clojure_orchard::LANGUAGE),
        entry!("toml", tree_sitter_toml_ng::LANGUAGE),
        entry!("nix", tree_sitter_nix::LANGUAGE),
        entry!("elixir", tree_sitter_elixir::LANGUAGE),
        entry!("r", tree_sitter_r::LANGUAGE),
        entry!("make", tree_sitter_make::LANGUAGE, ["makefile"]),
        entry!("vim", tree_sitter_vim::language()),
        entry!("xml", tree_sitter_xml::LANGUAGE_XML),
        entry!("agda", tree_sitter_agda::LANGUAGE),
    ]);
    entries
}

/// Registers every linked grammar with its TypeScript query, once per process. The code, Markdown, and diff wrappers
/// call it before they highlight. Registering compiles nothing: each query compiles the first time its filetype is
/// highlighted, so showing code does not wait for every grammar. A grammar whose query does not compile is logged then
/// and stays plain, as Core skips it.
pub fn register() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        for entry in entries() {
            syntax::register_lazy(entry.filetype, move || {
                #[cfg(test)]
                tests::loaded(entry.filetype);
                compile(&entry).inspect_err(|error| log::warn!("grammar {}: {error}", entry.filetype)).ok()
            });
            for alias in entry.aliases {
                syntax::register_alias(alias, entry.filetype);
            }
        }
    });
}

/// Compiles the grammars `filetypes` name (filetypes, or info strings as fences give them) on worker threads, one each,
/// so the first highlight that needs one waits for less of its compile, or none. A query costs 2 to 50 ms and about
/// 1.5 MB, so callers name only grammars about to show. Highlights stay synchronous: one that needs a grammar still
/// compiling waits for it. Names without a grammar, or asked for before, start nothing.
pub fn prewarm<'a>(filetypes: impl IntoIterator<Item = &'a str>) {
    static ASKED: Mutex<BTreeSet<String>> = Mutex::new(BTreeSet::new());
    register();
    let mut asked = ASKED.lock().unwrap_or_else(PoisonError::into_inner);
    for filetype in filetypes {
        if !syntax::has_grammar(filetype) || !asked.insert(filetype.to_owned()) {
            continue;
        }
        let filetype = filetype.to_owned();
        let spawned = thread::Builder::new().name("grammar".into()).spawn(move || syntax::prewarm(&filetype));
        if let Err(error) = spawned {
            log::warn!("grammar prewarm: {error}");
        }
    }
}

/// The language each fenced code block in Markdown `text` names: the first word of its info string.
pub fn fence_languages(text: &str) -> impl Iterator<Item = &str> {
    text.lines().filter_map(|line| {
        let fence = line.trim_start_matches(' ');
        let mark = fence.chars().next().filter(|mark| matches!(mark, '`' | '~'))?;
        let info = fence.trim_start_matches(mark);
        let fenced = line.len() - fence.len() <= 3 && fence.len() - info.len() >= 3;
        fenced.then(|| info.split_whitespace().next()).flatten()
    })
}

fn compile(entry: &Entry) -> Result<CompiledGrammar, GrammarError> {
    Grammar::new((entry.language)(), entry.query).injections(entry.injections).core_captures().compile()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use std::sync::Mutex;

    /// The table against the generator's manifest: every TypeScript filetype the build links, with its aliases.
    #[test]
    fn entries_match_the_manifest() {
        let manifest: Vec<serde_json::Value> =
            serde_json::from_str(include_str!("../../../../assets/queries/manifest.json")).unwrap();
        let entries = entries();
        for entry in &entries {
            let listed = manifest
                .iter()
                .find(|item| item["filetype"] == entry.filetype)
                .unwrap_or_else(|| panic!("{} is not in the manifest", entry.filetype));
            let aliases: Vec<&str> =
                listed["aliases"].as_array().unwrap().iter().map(|alias| alias.as_str().unwrap()).collect();
            assert_eq!(aliases, entry.aliases, "{} aliases", entry.filetype);
        }
        // Every filetype of the manifest but Kotlin and Swift with grammars; seven otherwise.
        assert_eq!(entries.len(), if cfg!(feature = "grammars") { manifest.len() - 2 } else { 7 });
    }

    #[test]
    fn every_query_compiles() {
        let failed: Vec<String> = entries()
            .iter()
            .filter_map(|entry| Some(format!("{}: {}", entry.filetype, compile(entry).err()?)))
            .collect();
        assert!(failed.is_empty(), "{failed:#?}");
    }

    /// How often each filetype's query compiled through [`register`].
    static LOADS: Mutex<BTreeMap<&str, usize>> = Mutex::new(BTreeMap::new());

    pub(super) fn loaded(filetype: &'static str) {
        *LOADS.lock().unwrap().entry(filetype).or_default() += 1;
    }

    fn loads(filetype: &str) -> usize {
        LOADS.lock().unwrap().get(filetype).copied().unwrap_or_default()
    }

    /// Registering the whole set compiles no query; highlighting a filetype compiles its query once.
    #[test]
    fn register_compiles_on_first_highlight_only() {
        register();
        // TypeScript is left out: another test highlights it, maybe already.
        let compiled: Vec<&str> = entries()
            .iter()
            .map(|entry| entry.filetype)
            .filter(|filetype| *filetype != "typescript" && loads(filetype) > 0)
            .collect();
        assert!(compiled.is_empty(), "{compiled:?}");
        assert!(syntax::has_grammar("zig"));
        for _ in 0..2 {
            assert!(syntax::highlights("const a = 1;\n", "zig").is_some());
        }
        assert_eq!(loads("zig"), 1);
        assert_eq!(loads("rust"), 0);
    }

    /// A prewarmed grammar compiles once, off the caller's thread, and the highlight that needs it uses that compile.
    /// TypeScript, because another test highlights it anyway (see above).
    #[test]
    fn prewarm_compiles_each_grammar_once() {
        prewarm(["ts", "ts", "cobol", "typescript"]);
        assert!(syntax::highlights("const a = 1\n", "typescript").is_some());
        assert_eq!(loads("typescript"), 1);
    }

    #[test]
    fn fence_languages_reads_each_opening_fence() {
        let text = "a\n```rust\nfn main() {}\n```\n   ~~~~ ts title=x\nb\n~~~~\n    ```go\n``python\n```\n";
        assert_eq!(fence_languages(text).collect::<Vec<_>>(), ["rust", "ts"]);
    }

    /// Core's TypeScript query: `import` is `keyword.import`, and comments add `spell`.
    #[test]
    fn typescript_uses_cores_capture_names() {
        register();
        let source = "import { a } from \"b\"\n// note\n";
        let names: Vec<&str> =
            syntax::highlights(source, "typescript").unwrap().iter().map(|capture| capture.name).collect();
        assert!(names.contains(&"keyword.import"), "{names:?}");
        assert!(names.contains(&"spell"), "{names:?}");
    }
}
