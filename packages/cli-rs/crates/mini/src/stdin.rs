//! Piped stdin (`packages/cli/src/mini.ts:38`, `mini-host.ts:88-113`): `cat file | opencode mini` reads the pipe
//! into the first prompt, then reads keys from the controlling terminal instead.

use std::io::{IsTerminal, Read};

pub const INTERACTIVE_INPUT_ERROR: &str = "opencode mini requires a controlling terminal for input";

/// Reads piped stdin to its end, then puts the controlling terminal (`/dev/tty`) on fd 0, where the renderer reads
/// keys. Returns `None` when stdin is already a terminal.
pub fn take_piped() -> Result<Option<String>, String> {
    if std::io::stdin().is_terminal() {
        return Ok(None);
    }
    let mut bytes = Vec::new();
    std::io::stdin().read_to_end(&mut bytes).map_err(|error| format!("failed to read stdin: {error}"))?;
    reopen_terminal()?;
    Ok(Some(String::from_utf8_lossy(&bytes).into_owned()))
}

#[cfg(unix)]
fn reopen_terminal() -> Result<(), String> {
    let terminal =
        std::fs::OpenOptions::new().read(true).open("/dev/tty").map_err(|_| INTERACTIVE_INPUT_ERROR.to_owned())?;
    rustix::stdio::dup2_stdin(&terminal).map_err(|_| INTERACTIVE_INPUT_ERROR.to_owned())
}

#[cfg(not(unix))]
fn reopen_terminal() -> Result<(), String> {
    Err(INTERACTIVE_INPUT_ERROR.to_owned())
}

/// `mergeInput`: the piped text, then `--prompt` on its own line; either alone; `None` when both are empty.
pub fn merge_input(piped: Option<&str>, prompt: Option<&str>) -> Option<String> {
    let piped = piped.filter(|text| !text.is_empty());
    let prompt = prompt.filter(|text| !text.is_empty());
    match (piped, prompt) {
        (None, None) => None,
        (Some(text), None) | (None, Some(text)) => Some(text.to_owned()),
        (Some(piped), Some(prompt)) => Some(format!("{piped}\n{prompt}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_input_matches_mini_ts() {
        // The first two are the cases of `packages/cli/test/mini.test.ts`.
        assert_eq!(merge_input(Some("from stdin"), None).as_deref(), Some("from stdin"));
        assert_eq!(merge_input(Some("from stdin"), Some("from flag")).as_deref(), Some("from stdin\nfrom flag"));
        assert_eq!(merge_input(None, None), None);
        assert_eq!(merge_input(Some(""), Some("")), None);
        assert_eq!(merge_input(Some("piped"), None).as_deref(), Some("piped"));
        assert_eq!(merge_input(None, Some("prompt")).as_deref(), Some("prompt"));
        assert_eq!(merge_input(Some(""), Some("prompt")).as_deref(), Some("prompt"));
        assert_eq!(merge_input(Some("piped\n"), Some("prompt")).as_deref(), Some("piped\n\nprompt"));
    }
}
