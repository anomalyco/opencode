//! The external editor and mention realignment, shared by the TUI and mini (`openEditor` in `editor.ts`,
//! `normalizePromptContent`, `realignPromptMentions`).

use std::collections::HashMap;
use std::path::Path;
use std::process::Command;

use super::parse::measure;

/// Writes `text` to a temporary file, runs the editor on it, and reads it back: `None` when it came back empty.
pub fn edit(command: &str, text: &str, cwd: &Path) -> Result<Option<String>, String> {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis());
    let file = std::env::temp_dir().join(format!("{stamp}.md"));
    std::fs::write(&file, text).map_err(|error| error.to_string())?;
    let result = run(command, &file, cwd);
    let _ = std::fs::remove_file(&file);
    result
}

fn run(command: &str, file: &Path, cwd: &Path) -> Result<Option<String>, String> {
    // `editor.split(" ")`: arguments are separated by single spaces, without quoting.
    let mut parts = command.split(' ');
    let program = parts.next().unwrap_or_default();
    let mut child = Command::new(program);
    child.args(parts).arg(file);
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
    format!(
        "code {}",
        status
            .code()
            .map_or_else(|| "null".to_owned(), |code| code.to_string())
    )
}

/// Drops the trailing line break that editors add to a one-line text (`normalizePromptContent`).
pub fn normalize(content: &str) -> String {
    for ending in ["\r\n", "\n"] {
        if let Some(body) = content.strip_suffix(ending) {
            return if body.contains(['\n', '\r']) {
                content.to_owned()
            } else {
                body.to_owned()
            };
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
/// longer one.
pub fn realign_mentions(content: &str, mentions: &[Option<Mention>]) -> Vec<Option<Mention>> {
    let mut aligned = vec![None; mentions.len()];
    let mut groups: Vec<(String, Vec<(usize, &Mention)>)> = Vec::new();
    for (index, mention) in mentions.iter().enumerate() {
        let Some(mention) = mention else { continue };
        match groups.iter_mut().find(|(text, _)| *text == mention.text) {
            Some((_, items)) => items.push((index, mention)),
            None => groups.push((mention.text.clone(), vec![(index, mention)])),
        }
    }
    groups.sort_by(|(left, _), (right, _)| right.len().cmp(&left.len()).then(left.cmp(right)));
    let mut protected: Vec<Candidate> = Vec::new();
    for (text, items) in groups {
        let candidates = occurrences(content, &text);
        let available: Vec<Candidate> = candidates
            .iter()
            .copied()
            .filter(|candidate| !protected.iter().any(|range| overlaps(candidate, range)))
            .collect();
        for (index, candidate) in assign(items, &available) {
            aligned[index] = Some(Mention {
                start: candidate.offset,
                end: candidate.offset + measure(&text),
                text: text.clone(),
            });
        }
        protected.extend(candidates);
    }
    aligned
}

fn occurrences(content: &str, text: &str) -> Vec<Candidate> {
    let mut found = Vec::new();
    let mut from = 0;
    while let Some(at) = content[from..].find(text) {
        let start = from + at;
        found.push(Candidate {
            start,
            end: start + text.len(),
            offset: measure(&content[..start]),
        });
        from = start + text.len();
    }
    found
}

fn overlaps(left: &Candidate, right: &Candidate) -> bool {
    left.start < right.end && left.end > right.start
}

/// Pairs mentions with occurrences in order: the most pairs, then the least total distance from the old offsets
/// (`assignMentions`).
fn assign(mut items: Vec<(usize, &Mention)>, candidates: &[Candidate]) -> Vec<(usize, Candidate)> {
    items.sort_by(|left, right| left.1.start.cmp(&right.1.start).then(left.0.cmp(&right.0)));
    let mut memo = HashMap::new();
    solve(&items, candidates, 0, 0, &mut memo).2
}

type Solution = (usize, u64, Vec<(usize, Candidate)>);

fn solve(
    items: &[(usize, &Mention)],
    candidates: &[Candidate],
    item: usize,
    candidate: usize,
    memo: &mut HashMap<(usize, usize), Solution>,
) -> Solution {
    if item >= items.len() || candidate >= candidates.len() {
        return (0, 0, Vec::new());
    }
    if let Some(cached) = memo.get(&(item, candidate)) {
        return cached.clone();
    }
    let tail = solve(items, candidates, item + 1, candidate + 1, memo);
    let (index, current) = items[item];
    let range = candidates[candidate];
    let mut pairs = vec![(index, range)];
    pairs.extend(tail.2);
    let matched = (
        tail.0 + 1,
        tail.1 + u64::from(range.offset.abs_diff(current.start)),
        pairs,
    );
    let options = [
        solve(items, candidates, item + 1, candidate, memo),
        solve(items, candidates, item, candidate + 1, memo),
    ];
    let best = options.into_iter().fold(matched, |best, next| {
        let better = if next.0 != best.0 {
            next.0 > best.0
        } else {
            next.1 < best.1
        };
        if better { next } else { best }
    });
    memo.insert((item, candidate), best.clone());
    best
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
}
