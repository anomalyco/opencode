//! Client-local files shared with the TypeScript client: paths, locks, config, and state.

pub mod channel;
pub mod cli_config;
pub mod generated;
pub mod id;
pub mod jsonc;
pub mod jsonl;
pub mod lock;
pub mod migrate;
pub mod model_pref;
pub mod paths;
pub mod pins;
pub mod registration;
pub mod serial;
pub mod service_config;
pub mod storage;
pub mod watch;

/// Reads `file` as Node's `readFile(file, "utf8")` does: invalid UTF-8 becomes U+FFFD.
pub(crate) fn read_lossy(file: &std::path::Path) -> std::io::Result<String> {
    Ok(String::from_utf8_lossy(&std::fs::read(file)?).into_owned())
}

/// Reads `file` as Effect's `FileSystem.readFileString` does: [`read_lossy`], without a leading BOM, so a file an
/// editor saved with either reads as TypeScript reads it.
pub(crate) fn read_text(file: &std::path::Path) -> std::io::Result<String> {
    let text = read_lossy(file)?;
    Ok(if text.starts_with('\u{feff}') { text['\u{feff}'.len_utf8()..].to_owned() } else { text })
}
