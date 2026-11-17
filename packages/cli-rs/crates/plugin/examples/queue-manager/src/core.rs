//! TS `src/queue-core.mjs`: the draft list's operations, pure. Each refuses what TS throws on, with TS's message.

/// TS `MAX_BATCH`.
pub const MAX_BATCH: u32 = 500;
/// TS `MAX_FILE_LINES`.
const MAX_FILE_LINES: usize = 1000;

/// TS `normalizeCount`: an integer from 1 to [`MAX_BATCH`], as `Number` reads it (surrounding blanks allowed).
pub fn normalize_count(value: &str) -> Result<u32, String> {
    let text = value.trim();
    let count = if text.is_empty() { Some(0.0) } else { text.parse::<f64>().ok() };
    match count {
        Some(count) if count.fract() == 0.0 && (1.0..=f64::from(MAX_BATCH)).contains(&count) => Ok(count as u32),
        _ => Err(format!("Count must be an integer between 1 and {MAX_BATCH}.")),
    }
}

/// TS `repeatMessage`.
pub fn repeat_message(text: &str, count: u32) -> Result<Vec<String>, String> {
    let message = text.trim();
    if message.is_empty() {
        return Err("Message cannot be blank.".to_owned());
    }
    Ok(vec![message.to_owned(); count as usize])
}

/// TS `parseMessageLines`: the file's non-blank lines, trimmed, without a leading byte-order mark.
pub fn parse_message_lines(content: &str) -> Result<Vec<String>, String> {
    let content = content.strip_prefix('\u{feff}').unwrap_or(content);
    let lines: Vec<String> =
        content.split('\n').map(|line| line.trim().to_owned()).filter(|line| !line.is_empty()).collect();
    if lines.is_empty() {
        return Err("File contains no non-empty lines.".to_owned());
    }
    if lines.len() > MAX_FILE_LINES {
        return Err(format!("File has more than {MAX_FILE_LINES} messages."));
    }
    Ok(lines)
}

/// TS `editAt`.
pub fn edit_at(items: &[String], index: usize, text: &str) -> Result<Vec<String>, String> {
    check(items, index)?;
    let message = text.trim();
    if message.is_empty() {
        return Err("Message cannot be blank.".to_owned());
    }
    let mut next = items.to_vec();
    next[index] = message.to_owned();
    Ok(next)
}

/// TS `deleteAt`.
pub fn delete_at(items: &[String], index: usize) -> Result<Vec<String>, String> {
    check(items, index)?;
    let mut next = items.to_vec();
    next.remove(index);
    Ok(next)
}

/// TS `moveAt`.
pub fn move_at(items: &[String], from: usize, to: usize) -> Result<Vec<String>, String> {
    check(items, from)?;
    check(items, to)?;
    let mut next = items.to_vec();
    let entry = next.remove(from);
    next.insert(to, entry);
    Ok(next)
}

/// TS `summarize`: one line, cut to `max` characters with `...`. TS counts UTF-16 units; this counts characters,
/// which differ only past the Basic Multilingual Plane.
pub fn summarize(text: &str, max: usize) -> String {
    let line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    match line.chars().count() > max {
        true => format!("{}...", line.chars().take(max - 1).collect::<String>()),
        false => line,
    }
}

fn check(items: &[String], index: usize) -> Result<(), String> {
    match index < items.len() {
        true => Ok(()),
        false => Err(format!("Invalid queue index: {index}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn list(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| (*item).to_owned()).collect()
    }

    #[test]
    fn counts_are_whole_numbers_up_to_the_batch() {
        let read: Vec<_> = ["10", " 150 ", "500", "0", "501", "2.5", "x", ""].map(normalize_count).to_vec();
        let error = Err("Count must be an integer between 1 and 500.".to_owned());
        assert_eq!(read, [Ok(10), Ok(150), Ok(500), error.clone(), error.clone(), error.clone(), error.clone(), error]);
    }

    #[test]
    fn the_list_moves_edits_and_deletes_as_ts() {
        let items = list(&["a", "b", "c"]);
        assert_eq!(move_at(&items, 1, 0).unwrap(), list(&["b", "a", "c"]));
        assert_eq!(move_at(&items, 0, 2).unwrap(), list(&["b", "c", "a"]));
        assert_eq!(edit_at(&items, 2, "  z ").unwrap(), list(&["a", "b", "z"]));
        assert_eq!(delete_at(&items, 0).unwrap(), list(&["b", "c"]));
        assert_eq!(delete_at(&items, 3), Err("Invalid queue index: 3".to_owned()));
        assert_eq!(edit_at(&items, 0, " "), Err("Message cannot be blank.".to_owned()));
    }

    #[test]
    fn lines_and_summaries_read_as_ts() {
        assert_eq!(parse_message_lines("\u{feff} one \r\n\n two\r\n").unwrap(), list(&["one", "two"]));
        assert_eq!(parse_message_lines("\n \n"), Err("File contains no non-empty lines.".to_owned()));
        assert_eq!(summarize("  run\n the   tests ", 90), "run the tests");
        assert_eq!(summarize("abcdefghij", 5), "abcd...");
        assert_eq!(repeat_message(" go ", 2).unwrap(), list(&["go", "go"]));
    }
}
