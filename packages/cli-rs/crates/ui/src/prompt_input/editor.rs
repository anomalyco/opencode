//! Launches the external editor and realigns mentions to the edited text.

use std::path::Path;
use std::process::Command;

/// Writes `text` to a temporary file, runs the editor on it, and reads it back: `None` when it came back empty.
pub fn edit(command: &str, text: &str, cwd: &Path) -> Result<Option<String>, String> {
    let file = create(text).map_err(|error| error.to_string())?;
    let result = run(command, &file, cwd);
    let _ = std::fs::remove_file(&file);
    result
}

/// Use an owner-only, newly created temp file: the draft may contain a pasted secret.
fn create(text: &str) -> std::io::Result<std::path::PathBuf> {
    use std::io::Write;
    let mut stamp =
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |elapsed| elapsed.as_millis());
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    loop {
        let file = std::env::temp_dir().join(format!("{stamp}.md"));
        match options.open(&file) {
            Ok(mut handle) => {
                let written = handle.write_all(text.as_bytes());
                if written.is_err() {
                    let _ = std::fs::remove_file(&file);
                }
                return written.map(|()| file);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => stamp += 1,
            Err(error) => return Err(error),
        }
    }
}

fn run(command: &str, file: &Path, cwd: &Path) -> Result<Option<String>, String> {
    let mut child = editor_command(command, file);
    if cwd.is_dir() {
        child.current_dir(cwd);
    }
    let status = child.status().map_err(|error| error.to_string())?;
    if !status.success() {
        return Err(format!("Editor exited with {}", exit_reason(&status)));
    }
    let content = std::fs::read_to_string(file).map_err(|error| error.to_string())?;
    Ok((!content.is_empty()).then_some(content))
}

#[cfg(not(windows))]
fn editor_command(command: &str, file: &Path) -> Command {
    // `editor.split(" ")`: arguments are separated by single spaces, without quoting.
    let mut parts = command.split(' ');
    let mut child = Command::new(parts.next().unwrap_or_default());
    child.args(parts).arg(file);
    child
}

/// `spawn(..., { shell: true })`: Node runs `%ComSpec%` (else `cmd.exe`) on the command line
/// [`shell_command_line`] builds, so `code` (a `.cmd`) and other batch files start.
#[cfg(windows)]
fn editor_command(command: &str, file: &Path) -> Command {
    use std::os::windows::process::CommandExt;
    let mut child = Command::new(std::env::var_os("ComSpec").unwrap_or_else(|| "cmd.exe".into()));
    child.raw_arg(shell_command_line(command, &file.to_string_lossy()));
    child
}

/// The arguments Node gives `cmd.exe` for a shell spawn: `/d /s /c "<editor> <file>"`, verbatim. `/s` strips the
/// outer quotes, so the editor string reaches cmd as written. TS leaves the file bare, which splits a temp path with
/// a space; this quotes it, which also keeps `&` and `^` literal (`parity/deviations/DW6-editor-file-quoted.md`).
/// cmd still expands a defined `%VAR%` inside quotes, as it does for TS; a Windows path holds no `"`.
#[cfg(any(windows, test))]
fn shell_command_line(command: &str, file: &str) -> String {
    format!("/d /s /c \"{command} \"{file}\"\"")
}

fn exit_reason(status: &std::process::ExitStatus) -> String {
    #[cfg(unix)]
    if let Some(signal) = std::os::unix::process::ExitStatusExt::signal(status) {
        let name = match signal {
            1 => "SIGHUP".to_owned(),
            2 => "SIGINT".to_owned(),
            3 => "SIGQUIT".to_owned(),
            6 => "SIGABRT".to_owned(),
            9 => "SIGKILL".to_owned(),
            15 => "SIGTERM".to_owned(),
            other => other.to_string(),
        };
        return format!("signal {name}");
    }
    format!("code {}", status.code().map_or_else(|| "null".to_owned(), |code| code.to_string()))
}

/// Drops the trailing line break that editors add to a one-line text (`normalizePromptContent`).
pub fn normalize(content: &str) -> String {
    for ending in ["\r\n", "\n"] {
        if let Some(body) = content.strip_suffix(ending) {
            return if body.contains(['\n', '\r']) { content.to_owned() } else { body.to_owned() };
        }
    }
    content.to_owned()
}

/// A mention's range: offsets as the cursor counts them, and its text.
#[derive(Clone, Debug, PartialEq)]
pub struct Mention {
    pub start: u32,
    pub end: u32,
    pub text: String,
}

/// An occurrence of a mention's text: its byte range in the content and its cursor offset.
#[derive(Clone, Copy, Debug)]
struct Candidate {
    start: usize,
    end: usize,
    offset: u32,
}

/// `realignPromptMentions`: longer texts claim their occurrences first, so a short mention never takes part of a
/// longer one. `offset` gives the cursor offset of a byte index of `content`, from the buffer that shows it.
pub fn realign_mentions(
    content: &str,
    mentions: &[Option<Mention>],
    offset: impl Fn(usize) -> u32,
) -> Vec<Option<Mention>> {
    let mut aligned = vec![None; mentions.len()];
    let mut groups: Vec<(String, Vec<(usize, &Mention)>)> = Vec::new();
    for (index, mention) in mentions.iter().enumerate() {
        let Some(mention) = mention else { continue };
        // An empty text occurs everywhere; such a mention stays as it is.
        if mention.text.is_empty() {
            aligned[index] = Some(mention.clone());
            continue;
        }
        match groups.iter_mut().find(|(text, _)| *text == mention.text) {
            Some((_, items)) => items.push((index, mention)),
            None => groups.push((mention.text.clone(), vec![(index, mention)])),
        }
    }
    let units = |text: &str| text.encode_utf16().count();
    groups.sort_by(|(left, _), (right, _)| {
        units(right).cmp(&units(left)).then_with(|| opencode_api_types::js::locale_compare(left, right))
    });
    let mut protected: Vec<Candidate> = Vec::new();
    for (text, items) in groups {
        let candidates = occurrences(content, &text, &offset);
        let available: Vec<Candidate> = candidates
            .iter()
            .copied()
            .filter(|candidate| {
                !protected.iter().any(|range| candidate.start < range.end && candidate.end > range.start)
            })
            .collect();
        for (index, candidate) in assign(items, &available) {
            aligned[index] = Some(Mention { start: candidate.offset, end: offset(candidate.end), text: text.clone() });
        }
        protected.extend(candidates);
    }
    aligned
}

fn occurrences(content: &str, text: &str, offset: impl Fn(usize) -> u32) -> Vec<Candidate> {
    let mut found = Vec::new();
    let mut from = 0;
    while let Some(at) = content[from..].find(text) {
        let start = from + at;
        found.push(Candidate { start, end: start + text.len(), offset: offset(start) });
        from = start + text.len();
    }
    found
}

/// Pairs mentions with occurrences in order: the most pairs, then the least total distance from the old offsets
/// (`assignMentions`). TS recurses with a memo; this fills the same table bottom-up, as a deep recursion would
/// overflow the stack on a text with many occurrences.
fn assign(mut items: Vec<(usize, &Mention)>, candidates: &[Candidate]) -> Vec<(usize, Candidate)> {
    items.sort_by(|left, right| left.1.start.cmp(&right.1.start).then(left.0.cmp(&right.0)));
    // `best[item][candidate]`: the pairs and distance of the items and candidates from these on.
    let width = candidates.len() + 1;
    let mut best = vec![(0usize, 0u64); (items.len() + 1) * width];
    let at = |item: usize, candidate: usize| item * width + candidate;
    let matched = |best: &[(usize, u64)], item: usize, candidate: usize| {
        let (pairs, distance) = best[at(item + 1, candidate + 1)];
        (pairs + 1, distance + u64::from(candidates[candidate].offset.abs_diff(items[item].1.start)))
    };
    // TS's order: the matched pair, then skipping the item, then skipping the candidate, each only when strictly better.
    let better =
        |next: (usize, u64), best: (usize, u64)| if next.0 != best.0 { next.0 > best.0 } else { next.1 < best.1 };
    for item in (0..items.len()).rev() {
        for candidate in (0..candidates.len()).rev() {
            best[at(item, candidate)] = [best[at(item + 1, candidate)], best[at(item, candidate + 1)]]
                .into_iter()
                .fold(matched(&best, item, candidate), |best, next| if better(next, best) { next } else { best });
        }
    }
    // A later choice was taken only when strictly better, so the first choice with the best value is the one taken.
    let mut pairs = Vec::new();
    let (mut item, mut candidate) = (0, 0);
    while item < items.len() && candidate < candidates.len() {
        let here = best[at(item, candidate)];
        if here == matched(&best, item, candidate) {
            pairs.push((items[item].0, candidates[candidate]));
            (item, candidate) = (item + 1, candidate + 1);
        } else if here == best[at(item + 1, candidate)] {
            item += 1;
        } else {
            candidate += 1;
        }
    }
    pairs
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_drops_the_break_after_one_line() {
        assert_eq!(normalize("hello\n"), "hello");
        assert_eq!(normalize("hello\r\n"), "hello");
        assert_eq!(normalize("a\nb\n"), "a\nb\n");
        assert_eq!(normalize("a\r\nb\r\n"), "a\r\nb\r\n");
        assert_eq!(normalize("plain"), "plain");
    }

    #[test]
    fn mentions_realign_as_typescript_does() {
        let at = |start, end, text: &str| Some(Mention { start, end, text: text.to_owned() });
        let realign = |text: &str, mentions: &[Option<Mention>]| realign_mentions(text, mentions, |index| index as u32);
        // Many occurrences align without a deep recursion.
        assert_eq!(realign(&"@x ".repeat(100_000), &[at(299_997, 299_999, "@x")]), [at(299_997, 299_999, "@x")]);
        // The longer text in UTF-16 claims an overlap.
        assert_eq!(realign("@abc日日", &[at(0, 0, "@abc"), at(0, 0, "c日日")]), [at(0, 4, "@abc"), None]);
        // A mention without text stays.
        assert_eq!(realign("x @a", &[at(3, 3, ""), at(0, 2, "@a"), None]), [at(3, 3, ""), at(2, 4, "@a"), None]);
    }

    #[test]
    fn the_shell_command_line_quotes_only_the_file() {
        let cases = [
            ("notepad", r"C:\Temp\1.md", r#"/d /s /c "notepad "C:\Temp\1.md"""#),
            ("code --wait", r"C:\Users\A B\Temp\1.md", r#"/d /s /c "code --wait "C:\Users\A B\Temp\1.md"""#),
            ("notepad", r"C:\a&b\1.md", r#"/d /s /c "notepad "C:\a&b\1.md"""#),
            ("notepad", r"C:\a^b\1.md", r#"/d /s /c "notepad "C:\a^b\1.md"""#),
            ("notepad", r"C:\100%\1.md", r#"/d /s /c "notepad "C:\100%\1.md"""#),
            (
                r#""C:\Program Files\Notepad++\notepad++.exe" -multiInst"#,
                r"C:\Temp\1.md",
                r#"/d /s /c ""C:\Program Files\Notepad++\notepad++.exe" -multiInst "C:\Temp\1.md"""#,
            ),
        ];
        for (command, file, line) in cases {
            assert_eq!(shell_command_line(command, file), line);
        }
    }

    #[cfg(windows)]
    #[test]
    fn the_editor_runs_through_cmd() {
        let dir = opencode_util::temp::tempdir().unwrap();
        // A batch file runs only through cmd; it rewrites the file at its quoted path, which has a space and an `&`.
        let script = dir.path().join("edit & go.cmd");
        std::fs::write(&script, "@echo edited> %1\r\n").unwrap();
        let file = dir.path().join("a b&c.md");
        std::fs::write(&file, "before").unwrap();
        let command = format!("\"{}\"", script.display());
        assert_eq!(run(&command, &file, dir.path()).unwrap().as_deref(), Some("edited\r\n"));
        assert_eq!(run("exit 3 &", &file, dir.path()), Err("Editor exited with code 3".to_owned()));
    }

    #[cfg(unix)]
    #[test]
    fn the_editor_file_is_private_to_its_owner() {
        use std::os::unix::fs::PermissionsExt;
        let dir = opencode_util::temp::tempdir().unwrap();
        let script = dir.path().join("editor");
        std::fs::write(&script, "#!/bin/sh\nmode=$(stat -c %a \"$1\")\necho \"$mode $(cat \"$1\")\" > \"$1\"\n")
            .unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
        let edited = edit(script.to_str().unwrap(), "secret", dir.path()).unwrap();
        assert_eq!(edited.as_deref(), Some("600 secret\n"));
    }
}
