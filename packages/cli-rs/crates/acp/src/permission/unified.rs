//! The parts of jsdiff 8 (`diff`) the previews use: `parsePatch`, `reversePatch`, `applyPatch` with
//! its default options (no fuzz, line endings converted), and the hunk ranges of `structuredPatch`.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Hunk {
    pub old_start: i64,
    pub old_lines: i64,
    pub new_start: i64,
    pub new_lines: i64,
    pub lines: Vec<String>,
}

/// `parsePatch`: the hunks of each file in a unified diff, or `None` when it does not parse.
pub fn parse(text: &str) -> Option<Vec<Vec<Hunk>>> {
    let lines: Vec<&str> = text.split('\n').collect();
    let mut files = Vec::new();
    let mut index = 0;
    while index < lines.len() {
        let (hunks, next) = parse_index(&lines, index)?;
        files.push(hunks);
        index = next;
    }
    Some(files)
}

/// `parsePatch(text)[0]`.
pub fn parse_first(text: &str) -> Option<Vec<Hunk>> {
    parse(text)?.into_iter().next()
}

fn parse_index(lines: &[&str], start: usize) -> Option<(Vec<Hunk>, usize)> {
    let mut index = start;
    while index < lines.len() {
        let line = lines[index];
        if ["--- ", "+++ ", "@@ "].iter().any(|prefix| starts_with_header(line, prefix)) {
            break;
        }
        index += 1;
    }
    // `parseFileHeader` runs twice and takes `---` or `+++` each time.
    for _ in 0..2 {
        if lines
            .get(index)
            .is_some_and(|line| (line.starts_with("---") || line.starts_with("+++")) && header_space(&line[3..]))
        {
            index += 1;
        }
    }
    let mut hunks = Vec::new();
    while index < lines.len() {
        let line = lines[index];
        if line.starts_with("Index:") && header_space(&line[6..])
            || line.starts_with("diff") && header_space(&line[4..])
            || line.starts_with("---") && header_space(&line[3..])
            || line.starts_with("+++") && header_space(&line[3..])
            || line.starts_with("===================================================================")
        {
            break;
        }
        if line.starts_with("@@") {
            let (hunk, next) = parse_hunk(lines, index)?;
            hunks.push(hunk);
            index = next;
        } else if !line.is_empty() {
            return None;
        } else {
            index += 1;
        }
    }
    Some((hunks, index))
}

// `/^(---|\+\+\+|@@)\s/`
fn starts_with_header(line: &str, prefix: &str) -> bool {
    let marker = prefix.trim_end();
    line.starts_with(marker) && header_space(&line[marker.len()..])
}

fn header_space(rest: &str) -> bool {
    rest.starts_with(char::is_whitespace)
}

fn parse_hunk(lines: &[&str], start: usize) -> Option<(Hunk, usize)> {
    let header = lines[start];
    let (old_start, old_count, new_start, new_count) = parse_range(header)?;
    let mut hunk = Hunk {
        old_start: old_start + i64::from(old_count == 0),
        old_lines: old_count,
        new_start: new_start + i64::from(new_count == 0),
        new_lines: new_count,
        lines: Vec::new(),
    };
    let (mut added, mut removed) = (0, 0);
    let mut index = start + 1;
    while index < lines.len() && (removed < hunk.old_lines || added < hunk.new_lines || lines[index].starts_with('\\'))
    {
        let line = lines[index];
        let operation = if line.is_empty() && index != lines.len() - 1 { Some(' ') } else { line.chars().next() };
        match operation {
            Some('+') => added += 1,
            Some('-') => removed += 1,
            Some(' ') => {
                added += 1;
                removed += 1;
            }
            Some('\\') => {}
            _ => return None,
        }
        hunk.lines.push(line.to_owned());
        index += 1;
    }
    if added == 0 && hunk.new_lines == 1 {
        hunk.new_lines = 0;
    }
    if removed == 0 && hunk.old_lines == 1 {
        hunk.old_lines = 0;
    }
    (added == hunk.new_lines && removed == hunk.old_lines).then_some((hunk, index))
}

// `@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@`, anywhere in the line.
fn parse_range(header: &str) -> Option<(i64, i64, i64, i64)> {
    let mut search = header;
    while let Some(at) = search.find("@@ -") {
        if let Some(range) = parse_range_at(&search[at + 4..]) {
            return Some(range);
        }
        search = &search[at + 1..];
    }
    None
}

fn parse_range_at(text: &str) -> Option<(i64, i64, i64, i64)> {
    let (old_start, old_count, rest) = numbers(text)?;
    let rest = rest.strip_prefix(" +")?;
    let (new_start, new_count, rest) = numbers(rest)?;
    rest.starts_with(" @@").then_some((old_start, old_count, new_start, new_count))
}

fn numbers(text: &str) -> Option<(i64, i64, &str)> {
    let digits = |text: &str| text.find(|c: char| !c.is_ascii_digit()).unwrap_or(text.len());
    let first = digits(text);
    let start = text[..first].parse().ok()?;
    let rest = &text[first..];
    let Some(after) = rest.strip_prefix(',') else {
        return Some((start, 1, rest));
    };
    let second = digits(after);
    match after[..second].parse() {
        Ok(count) => Some((start, count, &after[second..])),
        // `,` without digits leaves the optional group unmatched.
        Err(_) => Some((start, 1, rest)),
    }
}

/// `reversePatch`.
pub fn reverse(hunks: &[Hunk]) -> Vec<Hunk> {
    hunks
        .iter()
        .map(|hunk| Hunk {
            old_start: hunk.new_start,
            old_lines: hunk.new_lines,
            new_start: hunk.old_start,
            new_lines: hunk.old_lines,
            lines: hunk
                .lines
                .iter()
                .map(|line| {
                    if let Some(rest) = line.strip_prefix('-') {
                        return format!("+{rest}");
                    }
                    if let Some(rest) = line.strip_prefix('+') {
                        return format!("-{rest}");
                    }
                    line.clone()
                })
                .collect(),
        })
        .collect()
}

/// `applyPatch(source, patch)`: the patched text, or `None` when a hunk does not fit.
pub fn apply(source: &str, hunks: &[Hunk]) -> Option<String> {
    let converted;
    let hunks = if has_only_win_line_endings(source) && is_unix(hunks) {
        converted = unix_to_win(hunks);
        &converted
    } else if has_only_unix_line_endings(source) && is_win(hunks) {
        converted = win_to_unix(hunks);
        &converted
    } else {
        hunks
    };
    let mut lines: Vec<&str> = source.split('\n').collect();
    let Some(last) = hunks.last() else {
        return Some(source.to_owned());
    };
    let (mut remove_eofnl, mut add_eofnl) = (false, false);
    let mut previous = "";
    for line in &last.lines {
        if line.starts_with('\\') {
            if previous.starts_with('+') {
                remove_eofnl = true;
            } else if previous.starts_with('-') {
                add_eofnl = true;
            }
        }
        previous = line;
    }
    let ends_empty = lines.last() == Some(&"");
    if remove_eofnl {
        if add_eofnl {
            if ends_empty {
                return None;
            }
        } else if ends_empty {
            lines.pop();
        } else {
            return None;
        }
    } else if add_eofnl {
        if ends_empty {
            return None;
        }
        lines.push("");
    }

    let mut result: Vec<&str> = Vec::new();
    let mut min_line: i64 = 0;
    let mut previous_offset: i64 = 0;
    for hunk in hunks {
        let max_line = lines.len() as i64 - hunk.old_lines;
        let start = hunk.old_start + previous_offset - 1;
        let mut positions = DistanceIterator::new(start, min_line, max_line);
        let mut to_pos = Some(start);
        let fitted = loop {
            let Some(position) = to_pos else {
                break None;
            };
            if let Some(fitted) = apply_hunk(&lines, &hunk.lines, position) {
                break Some((position, fitted));
            }
            to_pos = positions.next();
        };
        let (position, (patched, old_last)) = fitted?;
        // Past the end, JS pushes `undefined`, which `join` writes as an empty string.
        for index in min_line..position {
            result.push(lines.get(index as usize).copied().unwrap_or_default());
        }
        result.extend(patched);
        min_line = old_last + 1;
        previous_offset = position + 1 - hunk.old_start;
    }
    result.extend(lines.iter().skip(min_line.max(0) as usize));
    Some(result.join("\n"))
}

fn apply_hunk<'a>(lines: &[&'a str], hunk_lines: &'a [String], mut to_pos: i64) -> Option<(Vec<&'a str>, i64)> {
    let line_at = |position: i64| usize::try_from(position).ok().and_then(|i| lines.get(i));
    let mut patched = Vec::new();
    let mut trailing_context = 0;
    for hunk_line in hunk_lines {
        let (operation, content) = match hunk_line.chars().next() {
            Some(first) => (first, &hunk_line[first.len_utf8()..]),
            None => (' ', hunk_line.as_str()),
        };
        match operation {
            '-' => {
                if line_at(to_pos) != Some(&content) {
                    return None;
                }
                to_pos += 1;
                trailing_context = 0;
            }
            '+' => {
                patched.push(content);
                trailing_context = 0;
            }
            ' ' => {
                trailing_context += 1;
                let line = line_at(to_pos).filter(|line| **line == content)?;
                patched.push(*line);
                to_pos += 1;
            }
            _ => {}
        }
    }
    patched.truncate(patched.len() - trailing_context);
    Some((patched, to_pos - trailing_context as i64 - 1))
}

/// jsdiff's `distanceIterator`: positions in `[min, max]` by distance from `start`, forward first.
struct DistanceIterator {
    start: i64,
    min: i64,
    max: i64,
    want_forward: bool,
    backward_exhausted: bool,
    forward_exhausted: bool,
    offset: i64,
}

impl DistanceIterator {
    fn new(start: i64, min: i64, max: i64) -> Self {
        Self { start, min, max, want_forward: true, backward_exhausted: false, forward_exhausted: false, offset: 1 }
    }
}

impl Iterator for DistanceIterator {
    type Item = i64;

    fn next(&mut self) -> Option<i64> {
        loop {
            if self.want_forward && !self.forward_exhausted {
                if self.backward_exhausted {
                    self.offset += 1;
                } else {
                    self.want_forward = false;
                }
                if self.start + self.offset <= self.max {
                    return Some(self.start + self.offset);
                }
                self.forward_exhausted = true;
            }
            if self.backward_exhausted {
                return None;
            }
            if !self.forward_exhausted {
                self.want_forward = true;
            }
            if self.min <= self.start - self.offset {
                let position = self.start - self.offset;
                self.offset += 1;
                return Some(position);
            }
            self.backward_exhausted = true;
        }
    }
}

fn has_only_win_line_endings(text: &str) -> bool {
    text.contains("\r\n")
        && !text.starts_with('\n')
        && !text.as_bytes().windows(2).any(|pair| pair[1] == b'\n' && pair[0] != b'\r')
}

fn has_only_unix_line_endings(text: &str) -> bool {
    !text.contains("\r\n") && text.contains('\n')
}

fn is_unix(hunks: &[Hunk]) -> bool {
    !hunks.iter().flat_map(|hunk| &hunk.lines).any(|line| !line.starts_with('\\') && line.ends_with('\r'))
}

fn is_win(hunks: &[Hunk]) -> bool {
    hunks.iter().flat_map(|hunk| &hunk.lines).any(|line| line.ends_with('\r'))
        && hunks
            .iter()
            .all(|hunk| hunk.lines.iter().enumerate().all(|(index, line)| keeps_ending(&hunk.lines, index, line)))
}

fn keeps_ending(lines: &[String], index: usize, line: &str) -> bool {
    line.starts_with('\\') || line.ends_with('\r') || lines.get(index + 1).is_some_and(|next| next.starts_with('\\'))
}

fn unix_to_win(hunks: &[Hunk]) -> Vec<Hunk> {
    hunks
        .iter()
        .map(|hunk| Hunk {
            lines: hunk
                .lines
                .iter()
                .enumerate()
                .map(
                    |(index, line)| {
                        if keeps_ending(&hunk.lines, index, line) { line.clone() } else { format!("{line}\r") }
                    },
                )
                .collect(),
            ..hunk.clone()
        })
        .collect()
}

fn win_to_unix(hunks: &[Hunk]) -> Vec<Hunk> {
    hunks
        .iter()
        .map(|hunk| Hunk {
            lines: hunk.lines.iter().map(|line| line.strip_suffix('\r').unwrap_or(line).to_owned()).collect(),
            ..hunk.clone()
        })
        .collect()
}

/// The `oldStart,oldLines,newStart,newLines` of each hunk, space-separated.
pub fn ranges(hunks: &[Hunk]) -> String {
    hunks
        .iter()
        .map(|hunk| format!("{},{},{},{}", hunk.old_start, hunk.old_lines, hunk.new_start, hunk.new_lines))
        .collect::<Vec<_>>()
        .join(" ")
}

/// The hunk ranges `structuredPatch(old, new)` reports, with its default four lines of context.
pub fn structured_ranges(old: &str, new: &str) -> String {
    const CONTEXT: usize = 4;
    let changes = diff_lines(old, new);
    let mut hunks = Vec::new();
    let (mut old_line, mut new_line) = (1, 1);
    // Where the open hunk starts, its leading context included.
    let mut start: Option<(usize, usize)> = None;
    let mut close = |(old_start, new_start): (usize, usize), old_line: usize, new_line: usize, context: usize| {
        hunks.push(format!(
            "{old_start},{},{new_start},{}",
            old_line - old_start + context,
            new_line - new_start + context
        ))
    };
    for (index, &(change, count)) in changes.iter().enumerate() {
        if change != Change::Same {
            start.get_or_insert_with(|| {
                let before = index.checked_sub(1).map_or(0, |previous| changes[previous].1.min(CONTEXT));
                (old_line - before, new_line - before)
            });
            match change {
                Change::Added => new_line += count,
                _ => old_line += count,
            }
            continue;
        }
        // Context of up to twice the window joins two changes, unless nothing follows it.
        if let Some(open) = start
            && (count > 2 * CONTEXT || index + 1 == changes.len())
        {
            close(open, old_line, new_line, count.min(CONTEXT));
            start = None;
        }
        old_line += count;
        new_line += count;
    }
    if let Some(open) = start {
        close(open, old_line, new_line, 0);
    }
    hunks.join(" ")
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Change {
    Same,
    Added,
    Removed,
}

/// `diffLines`: runs of `(change, lines)`, by jsdiff's own Myers search, whose tie-breaking (prefer the path that
/// is further along the old text, and on a tie an insertion) decides where equal-cost changes land.
fn diff_lines(old: &str, new: &str) -> Vec<(Change, usize)> {
    search(old, new).0
}

/// The runs, and the most components alive at once.
fn search(old: &str, new: &str) -> (Vec<(Change, usize)>, usize) {
    // `tokenize`: lines with their `\n` or `\r\n`; an empty text has none.
    let (old, new): (Vec<&str>, Vec<&str>) = (old.split_inclusive('\n').collect(), new.split_inclusive('\n').collect());
    let (old_len, new_len) = (old.len() as isize, new.len() as isize);
    let mut arena = Arena::default();
    let common = |arena: &mut Arena, path: &mut Path, diagonal: isize| {
        let mut old_pos = path.old_pos;
        let mut new_pos = old_pos - diagonal;
        let begin = old_pos;
        while new_pos + 1 < new_len
            && old_pos + 1 < old_len
            && old[(old_pos + 1) as usize] == new[(new_pos + 1) as usize]
        {
            old_pos += 1;
            new_pos += 1;
        }
        if old_pos > begin {
            // The new component takes over the path's hold on its predecessor.
            path.last = Some(arena.push((Change::Same, (old_pos - begin) as usize, path.last)));
        }
        path.old_pos = old_pos;
        new_pos
    };
    let offset = old_len + new_len + 1;
    let mut best: Vec<Option<Path>> = vec![None; (2 * offset + 1) as usize];
    let slot = |diagonal: isize| (diagonal + offset) as usize;
    let mut first = Path { old_pos: -1, last: None };
    let new_pos = common(&mut arena, &mut first, 0);
    if first.old_pos + 1 >= old_len && new_pos + 1 >= new_len {
        return (arena.build(first.last), arena.peak);
    }
    best[slot(0)] = Some(first);
    let (mut min_diagonal, mut max_diagonal) = (isize::MIN, isize::MAX);
    for edit_length in 1..=old_len + new_len {
        let mut diagonal = min_diagonal.max(-edit_length);
        while diagonal <= max_diagonal.min(edit_length) {
            let remove_path = best[slot(diagonal - 1)].take();
            let add_path = best[slot(diagonal + 1)];
            let can_add = add_path.is_some_and(|path| (0..new_len).contains(&(path.old_pos - diagonal)));
            let can_remove = remove_path.is_some_and(|path| path.old_pos + 1 < old_len);
            let replaced = if !can_add && !can_remove {
                best[slot(diagonal)].take()
            } else {
                let mut path = match (add_path, remove_path) {
                    (Some(add), remove) if !can_remove || (can_add && remove.unwrap().old_pos < add.old_pos) => {
                        arena.extend(add, Change::Added, 0)
                    }
                    (_, remove) => arena.extend(remove.unwrap(), Change::Removed, 1),
                };
                let new_pos = common(&mut arena, &mut path, diagonal);
                if path.old_pos + 1 >= old_len && new_pos + 1 >= new_len {
                    return (arena.build(path.last), arena.peak);
                }
                if path.old_pos + 1 >= old_len {
                    max_diagonal = max_diagonal.min(diagonal - 1);
                }
                if new_pos + 1 >= new_len {
                    min_diagonal = min_diagonal.max(diagonal + 1);
                }
                best[slot(diagonal)].replace(path)
            };
            // Like jsdiff, drop the paths no longer kept, and with them the components only they reached.
            for dropped in [remove_path, replaced].into_iter().flatten() {
                arena.release(dropped.last);
            }
            diagonal += 2;
        }
    }
    unreachable!("an edit script is at most as long as both texts")
}

#[derive(Clone, Copy)]
struct Path {
    old_pos: isize,
    /// The component this path holds a reference to.
    last: Option<usize>,
}

/// Components form linked lists that paths share. Each counts the paths and components that point at it; one that
/// reaches zero goes back to the free list, as jsdiff's garbage collector would reclaim it.
#[derive(Default)]
struct Arena {
    components: Vec<(Change, usize, Option<usize>)>,
    refs: Vec<u32>,
    free: Vec<usize>,
    live: usize,
    peak: usize,
}

impl Arena {
    /// A new component, held once by the caller; it takes over a reference to its predecessor.
    fn push(&mut self, component: (Change, usize, Option<usize>)) -> usize {
        self.live += 1;
        self.peak = self.peak.max(self.live);
        if let Some(index) = self.free.pop() {
            self.components[index] = component;
            self.refs[index] = 1;
            return index;
        }
        self.components.push(component);
        self.refs.push(1);
        self.components.len() - 1
    }

    fn retain(&mut self, index: Option<usize>) {
        if let Some(index) = index {
            self.refs[index] += 1;
        }
    }

    fn release(&mut self, mut index: Option<usize>) {
        while let Some(at) = index {
            self.refs[at] -= 1;
            if self.refs[at] > 0 {
                return;
            }
            self.free.push(at);
            self.live -= 1;
            index = self.components[at].2;
        }
    }

    /// `addToPath`: one more line added or removed, as a new component (a longer copy of the last when it is the
    /// same change). The returned path holds its own reference; `path` keeps its own.
    fn extend(&mut self, path: Path, change: Change, old_step: isize) -> Path {
        let component = match path.last.map(|last| self.components[last]) {
            Some((last, count, previous)) if last == change => (change, count + 1, previous),
            _ => (change, 1, path.last),
        };
        self.retain(component.2);
        Path { old_pos: path.old_pos + old_step, last: Some(self.push(component)) }
    }

    /// `buildValues`: the list ending at `last`, in order.
    fn build(&self, mut last: Option<usize>) -> Vec<(Change, usize)> {
        let mut out = Vec::new();
        while let Some(index) = last {
            let (change, count, previous) = self.components[index];
            out.push((change, count));
            last = previous;
        }
        out.reverse();
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PATCH: &str = "===================================================================\n--- a.ts\n+++ a.ts\n@@ -1,3 +1,3 @@\n one\n-two\n+three\n four\n";

    #[test]
    fn parses_applies_and_reverses() {
        let hunks = parse_first(PATCH).unwrap();
        assert_eq!(ranges(&hunks), "1,3,1,3");
        assert_eq!(apply("one\ntwo\nfour\n", &hunks).as_deref(), Some("one\nthree\nfour\n"));
        assert_eq!(apply("one\nthree\nfour\n", &reverse(&hunks)).as_deref(), Some("one\ntwo\nfour\n"));
        assert_eq!(apply("x\ny\n", &hunks), None);
        // Line endings follow the source.
        assert_eq!(apply("one\r\ntwo\r\nfour\r\n", &hunks).as_deref(), Some("one\r\nthree\r\nfour\r\n"));
        // A shifted hunk still fits.
        assert_eq!(apply("zero\none\ntwo\nfour\n", &hunks).as_deref(), Some("zero\none\nthree\nfour\n"));
    }

    #[test]
    fn handles_missing_final_newlines_and_empty_counts() {
        let patch = "--- a\n+++ a\n@@ -0,0 +1 @@\n+one\n\\ No newline at end of file\n";
        let hunks = parse_first(patch).unwrap();
        assert_eq!(ranges(&hunks), "1,0,1,1");
        assert_eq!(apply("", &hunks).as_deref(), Some("one"));
        assert_eq!(parse_first("@@ -1,2 +1,2 @@\n-a\n"), None);
    }

    #[test]
    fn structured_ranges_match_jsdiff() {
        // Written by script/gen/structured-patch.ts from jsdiff itself.
        let cases: Vec<[String; 3]> = serde_json::from_str(include_str!("structured_patch.json")).unwrap();
        for [old, new, ranges] in cases {
            assert_eq!(structured_ranges(&old, &new), ranges, "{old:?} -> {new:?}");
        }
    }

    #[test]
    fn search_keeps_only_reachable_components() {
        // No common line: the search visits the whole grid, so keeping every component it makes holds about a
        // million here (16,640 for 128 lines, over 512 MiB for 4,096). Only those of the live paths may remain.
        let lines = 1024;
        let old: String = (0..lines).map(|i| format!("    old {i}\n")).collect();
        let new: String = (0..lines).map(|i| format!("    new {i}\n")).collect();
        let (changes, peak) = search(&old, &new);
        assert_eq!(changes, [(Change::Removed, lines), (Change::Added, lines)]);
        assert!(peak <= 4 * lines, "{peak} components alive at once");
    }
}
