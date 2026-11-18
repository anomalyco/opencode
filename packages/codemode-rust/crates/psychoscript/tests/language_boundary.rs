//! The language layer (`src/language/`) knows nothing about Code Mode (`src/codemode/`), which is built on it, as the
//! reference's `test/language-boundary.test.ts` checks for its own `src/language/` and `src/codemode/`.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

#[test]
fn nothing_in_the_language_layer_reaches_code_mode() {
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let files = rust_files(&src.join("language"));
    assert!(!files.is_empty());
    let lib = std::fs::read_to_string(src.join("lib.rs")).expect("lib.rs");
    let code_mode = code_mode_names(&code(&lib));
    assert!(
        code_mode.contains("Runtime") && code_mode.contains("Tool"),
        "{code_mode:?}"
    );
    let mut outside = Vec::new();
    for file in &files {
        let text = code(&std::fs::read_to_string(file).expect("source"));
        let name = file
            .strip_prefix(&src)
            .unwrap_or(file)
            .display()
            .to_string();
        if text.contains("codemode::") {
            outside.push(format!("{name} names a path through codemode::"));
        }
        for item in crate_items(&text) {
            if code_mode.contains(&item) {
                outside.push(format!("{name} uses crate::{item}, which is Code Mode's"));
            }
        }
    }
    assert_eq!(outside, Vec::<String>::new());
}

/// Every `.rs` file under `dir`.
fn rust_files(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(dir).expect("directory").flatten() {
        let path = entry.path();
        if path.is_dir() {
            out.extend(rust_files(&path));
        } else if path.extension().is_some_and(|e| e == "rs") {
            out.push(path);
        }
    }
    out
}

/// The source without its line comments, so documentation may name the other layer.
fn code(text: &str) -> String {
    text.lines()
        .map(|line| match line.find("//") {
            Some(at) => &line[..at],
            None => line,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// The names the crate root takes from Code Mode: what its `use codemode::...` items bring in.
fn code_mode_names(lib: &str) -> BTreeSet<String> {
    let mut names = BTreeSet::new();
    for statement in lib.split(';') {
        let Some(at) = statement.find("use codemode::") else {
            continue;
        };
        let path = &statement[at + "use codemode::".len()..];
        match path.find('{') {
            Some(open) => names.extend(
                path[open + 1..]
                    .trim_end_matches(|c: char| c == '}' || c.is_whitespace())
                    .split(',')
                    .map(|n| n.trim().rsplit("::").next().unwrap_or("").to_owned())
                    .filter(|n| !n.is_empty()),
            ),
            None => names.extend(path.trim().rsplit("::").next().map(str::to_owned)),
        }
    }
    names
}

/// The top-level names a source takes from the crate root: `crate::Name` and each name in `crate::{...}`.
fn crate_items(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(at) = rest.find("crate::") {
        rest = &rest[at + "crate::".len()..];
        if let Some(group) = rest.strip_prefix('{') {
            let end = group.find('}').unwrap_or(group.len());
            out.extend(
                group[..end]
                    .split(',')
                    .map(|n| n.trim().split("::").next().unwrap_or("").to_owned())
                    .filter(|n| !n.is_empty()),
            );
        } else {
            let end = rest
                .find(|c: char| !(c.is_alphanumeric() || c == '_'))
                .unwrap_or(rest.len());
            out.push(rest[..end].to_owned());
        }
    }
    out
}
