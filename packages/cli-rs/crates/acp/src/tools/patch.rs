//! The patch tool's format: `parse` and `derive` of `packages/util/src/patch.ts`. Parse errors carry no
//! detail here; the agent only needs to know that a patch did not parse.

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Hunk {
    Add { path: String, contents: String },
    Delete { path: String },
    Update { path: String, move_path: Option<String>, chunks: Vec<Chunk> },
}

impl Hunk {
    pub fn path(&self) -> &str {
        match self {
            Self::Add { path, .. } | Self::Delete { path } | Self::Update { path, .. } => path,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Chunk {
    pub old_lines: Vec<String>,
    pub new_lines: Vec<String>,
    pub change_context: Option<String>,
    pub end_of_file: bool,
}

/// `Patch.parse`, or `None` when the text is not a valid patch.
pub fn parse(patch_text: &str) -> Option<Vec<Hunk>> {
    let stripped = strip_heredoc(js_trim(patch_text));
    let lines: Vec<&str> = stripped.split('\n').map(|line| line.strip_suffix('\r').unwrap_or(line)).collect();
    if js_trim(lines[0]) != "*** Begin Patch" {
        return None;
    }
    let end = lines.len() - 1;
    if js_trim(lines[end]) != "*** End Patch" || end == 0 {
        return None;
    }
    let mut hunks = Vec::new();
    let mut index = 1;
    while index < end {
        let header = js_trim(lines[index]);
        if index == 1
            && let Some(rest) = header.strip_prefix("*** Environment ID:")
            && !js_trim(rest).is_empty()
        {
            index += 1;
            continue;
        }
        if let Some(path) = header.strip_prefix("*** Add File: ") {
            let path = js_trim(path).to_owned();
            let mut content = Vec::new();
            index += 1;
            while index < end && !is_boundary(js_trim(lines[index])) {
                content.push(lines[index].strip_prefix('+')?);
                index += 1;
            }
            hunks.push(Hunk::Add { path, contents: content.join("\n") });
            continue;
        }
        if let Some(path) = header.strip_prefix("*** Delete File: ") {
            if index + 1 < end && !is_boundary(js_trim(lines[index + 1])) {
                return None;
            }
            hunks.push(Hunk::Delete { path: js_trim(path).to_owned() });
            index += 1;
            continue;
        }
        if let Some(path) = header.strip_prefix("*** Update File: ") {
            let mut next = index + 1;
            while lines.get(next).map(|line| line.trim_end()) == Some("*** End of File") {
                next += 1;
            }
            let mut move_path = None;
            if let Some(line) = lines.get(next).map(|line| line.trim_end())
                && (line == "*** Move to:" || line.starts_with("*** Move to: "))
            {
                let target = js_trim(line.get("*** Move to: ".len()..).unwrap_or_default());
                if target.is_empty() {
                    return None;
                }
                move_path = Some(target.to_owned());
                next += 1;
            }
            let (chunks, after) = parse_update(&lines, next, end)?;
            hunks.push(Hunk::Update { path: js_trim(path).to_owned(), move_path, chunks });
            index = after;
            continue;
        }
        return None;
    }
    Some(hunks)
}

/// `Patch.derive`: `original` with `chunks` applied. The BOM is dropped from the content.
pub fn derive(path: &str, chunks: &[Chunk], original: &str) -> Result<String, String> {
    let mut lines: Vec<String> = original.trim_start_matches('\u{feff}').split('\n').map(str::to_owned).collect();
    if lines.last().is_some_and(String::is_empty) {
        lines.pop();
    }
    let mut replacements = compute_replacements(&lines, path, chunks)?;
    replacements.reverse();
    for (start, remove, insert) in replacements {
        lines.splice(start..start + remove, insert);
    }
    if lines.last().is_none_or(|line| !line.is_empty()) {
        lines.push(String::new());
    }
    Ok(lines.join("\n").trim_start_matches('\u{feff}').to_owned())
}

fn parse_update(lines: &[&str], start: usize, end: usize) -> Option<(Vec<Chunk>, usize)> {
    let mut chunks: Vec<Chunk> = Vec::new();
    let mut index = start;
    let mut after_end_of_file = false;
    let empty = |chunk: &Chunk| chunk.old_lines.is_empty() && chunk.new_lines.is_empty();
    while index < end {
        let line = lines[index];
        let update_line = line.trim_end();
        if after_end_of_file {
            if update_line.is_empty() {
                index += 1;
                continue;
            }
            if update_line == "@@" || update_line.starts_with("@@ ") {
                after_end_of_file = false;
            } else if is_boundary(update_line) {
                break;
            } else {
                return None;
            }
        }
        if update_line == "*** End of File" {
            if let Some(chunk) = chunks.last_mut() {
                if empty(chunk) {
                    return None;
                }
                chunk.end_of_file = true;
                after_end_of_file = true;
            }
            index += 1;
            continue;
        }
        if is_boundary(update_line) {
            break;
        }
        if update_line == "@@" || update_line.starts_with("@@ ") {
            if chunks.last().is_some_and(empty) {
                return None;
            }
            chunks
                .push(Chunk { change_context: update_line.strip_prefix("@@ ").map(str::to_owned), ..Chunk::default() });
            index += 1;
            continue;
        }
        if chunks.is_empty() {
            chunks.push(Chunk::default());
        }
        let chunk = chunks.last_mut()?;
        if line.is_empty() {
            chunk.old_lines.push(String::new());
            chunk.new_lines.push(String::new());
        } else if let Some(rest) = line.strip_prefix(' ') {
            chunk.old_lines.push(rest.to_owned());
            chunk.new_lines.push(rest.to_owned());
        } else if let Some(rest) = line.strip_prefix('-') {
            chunk.old_lines.push(rest.to_owned());
        } else {
            chunk.new_lines.push(line.strip_prefix('+')?.to_owned());
        }
        index += 1;
    }
    if chunks.last().is_none_or(empty) {
        return None;
    }
    Some((chunks, index))
}

fn is_boundary(line: &str) -> bool {
    line == "*** End Patch"
        || line.starts_with("*** Add File: ")
        || line.starts_with("*** Delete File: ")
        || line.starts_with("*** Update File: ")
}

type Replacement = (usize, usize, Vec<String>);

fn compute_replacements(lines: &[String], path: &str, chunks: &[Chunk]) -> Result<Vec<Replacement>, String> {
    let mut replacements = Vec::new();
    let mut line_index = 0;
    for chunk in chunks {
        if let Some(context) = chunk.change_context.as_deref().filter(|c| !c.is_empty()) {
            let found = seek(lines, &[context.to_owned()], line_index, false)
                .ok_or_else(|| format!("Failed to find context '{context}' in {path}"))?;
            line_index = found + 1;
        }
        if chunk.old_lines.is_empty() {
            replacements.push((lines.len(), 0, chunk.new_lines.clone()));
            continue;
        }
        let mut old_lines = chunk.old_lines.as_slice();
        let mut new_lines = chunk.new_lines.as_slice();
        let mut found = seek(lines, old_lines, line_index, chunk.end_of_file);
        if found.is_none() && old_lines.last().is_some_and(String::is_empty) {
            old_lines = &old_lines[..old_lines.len() - 1];
            if new_lines.last().is_some_and(String::is_empty) {
                new_lines = &new_lines[..new_lines.len() - 1];
            }
            found = seek(lines, old_lines, line_index, chunk.end_of_file);
        }
        let found = found.ok_or_else(|| format!("Failed to find expected lines in {path}"))?;
        replacements.push((found, old_lines.len(), new_lines.to_vec()));
        line_index = found + old_lines.len();
    }
    replacements.sort_by_key(|replacement| replacement.0);
    Ok(replacements)
}

fn seek(lines: &[String], pattern: &[String], start: usize, eof: bool) -> Option<usize> {
    if pattern.is_empty() || pattern.len() > lines.len() {
        return None;
    }
    let last = lines.len() - pattern.len();
    let compares: [fn(&str, &str) -> bool; 4] = [
        |left, right| left == right,
        |left, right| left.trim_end() == right.trim_end(),
        |left, right| js_trim(left) == js_trim(right),
        |left, right| normalize(js_trim(left)) == normalize(js_trim(right)),
    ];
    let matches = |offset: usize, compare: fn(&str, &str) -> bool| {
        pattern.iter().enumerate().all(|(index, line)| compare(&lines[offset + index], line))
    };
    if eof {
        if last < start {
            return None;
        }
        return compares.iter().any(|compare| matches(last, *compare)).then_some(last);
    }
    compares.iter().find_map(|compare| (start..=last).find(|offset| matches(*offset, *compare)))
}

fn normalize(value: &str) -> String {
    value
        .chars()
        .map(|char| match char {
            '\u{2018}' | '\u{2019}' | '\u{201A}' | '\u{201B}' => '\'',
            '\u{201C}' | '\u{201D}' | '\u{201E}' | '\u{201F}' => '"',
            '\u{2010}'..='\u{2015}' | '\u{2212}' => '-',
            '\u{00A0}' | '\u{2002}'..='\u{200A}' | '\u{202F}' | '\u{205F}' | '\u{3000}' => ' ',
            other => other,
        })
        .collect()
}

/// `String.prototype.trim`, which also strips the BOM.
fn js_trim(value: &str) -> &str {
    value.trim_matches(|char: char| char.is_whitespace() || char == '\u{feff}')
}

/// `stripHeredoc`: the body of `cat <<EOF ... EOF` (or `<<'EOF'`, `<<"EOF"`), else the input.
fn strip_heredoc(input: &str) -> &str {
    heredoc_body(input).unwrap_or(input)
}

fn heredoc_body(input: &str) -> Option<&str> {
    let mut rest = input;
    if let Some(after) = rest.strip_prefix("cat")
        && after.starts_with(char::is_whitespace)
    {
        rest = after.trim_start();
    }
    rest = rest.strip_prefix("<<")?;
    let quote = rest.chars().next().filter(|char| *char == '\'' || *char == '"');
    if let Some(quote) = quote {
        rest = &rest[1..];
        let word_len = rest.find(|char: char| !(char.is_ascii_alphanumeric() || char == '_')).unwrap_or(rest.len());
        let word = &rest[..word_len];
        rest = rest[word_len..].strip_prefix(quote)?;
        return heredoc_rest(input, rest, word);
    }
    let word_len = rest.find(|char: char| !(char.is_ascii_alphanumeric() || char == '_')).unwrap_or(rest.len());
    heredoc_rest(input, &rest[word_len..], &rest[..word_len])
}

// `\s*\n([\s\S]*?)\n<word>\s*$` on input that is already trimmed: the body ends before the last line,
// which must be the word, and starts after the last newline of the whitespace that follows the header.
fn heredoc_rest<'a>(input: &'a str, rest: &'a str, word: &str) -> Option<&'a str> {
    if word.is_empty() {
        return None;
    }
    let close = input.len().checked_sub(word.len() + 1)?;
    if !input.ends_with(word) || input.as_bytes()[close] != b'\n' {
        return None;
    }
    let header_end = input.len() - rest.len();
    let space = rest.len() - rest.trim_start().len();
    let start = rest[..space]
        .char_indices()
        .filter(|(_, char)| *char == '\n')
        .map(|(offset, _)| header_end + offset + 1)
        .rfind(|start| *start <= close)?;
    Some(&input[start..close])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_add_delete_update_and_move() {
        let text = "*** Begin Patch\n*** Add File: a.txt\n+one\n+two\n*** Delete File: b.txt\n*** Update File: c.txt\n*** Move to: d.txt\n@@ fn main\n-old\n+new\n*** End Patch";
        assert_eq!(
            parse(text),
            Some(vec![
                Hunk::Add { path: "a.txt".into(), contents: "one\ntwo".into() },
                Hunk::Delete { path: "b.txt".into() },
                Hunk::Update {
                    path: "c.txt".into(),
                    move_path: Some("d.txt".into()),
                    chunks: vec![Chunk {
                        old_lines: vec!["old".into()],
                        new_lines: vec!["new".into()],
                        change_context: Some("fn main".into()),
                        end_of_file: false,
                    }],
                },
            ])
        );
        assert_eq!(parse("*** Begin Patch\n*** End Patch"), Some(Vec::new()));
        assert_eq!(parse("nope"), None);
        assert_eq!(parse("*** Begin Patch\n*** Update File: c.txt\n*** End Patch"), None);
    }

    #[test]
    fn strips_a_heredoc() {
        let text = "cat <<'EOF'\n*** Begin Patch\n*** Delete File: x\n*** End Patch\nEOF";
        assert_eq!(parse(text), Some(vec![Hunk::Delete { path: "x".into() }]));
        assert_eq!(strip_heredoc("<<EOF\nbody\nEOF"), "body");
        assert_eq!(strip_heredoc("<<EOF\nbody\nEND"), "<<EOF\nbody\nEND");
    }

    #[test]
    fn derives_with_fuzzy_matching_and_a_trailing_newline() {
        let chunks = vec![Chunk { old_lines: vec!["  b".into()], new_lines: vec!["  B".into()], ..Chunk::default() }];
        assert_eq!(derive("f", &chunks, "a\nb\nc"), Ok("a\n  B\nc\n".into()));
        let append = vec![Chunk { new_lines: vec!["z".into()], ..Chunk::default() }];
        assert_eq!(derive("f", &append, "a\n"), Ok("a\nz\n".into()));
        assert!(derive("f", &chunks, "x\n").is_err());
    }
}
