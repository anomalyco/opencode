//! Text rules of the prompt autocomplete, shared by the TUI and mini: where a trigger starts
//! (`prompt/display.ts`), line ranges and slash heads (`prompt/parse.ts`), and directory completion
//! (`prompt/directory-completion.ts`).
//!
//! Offsets count as the textarea's cursor does: display columns, with one per line break.

use unicode_width::UnicodeWidthStr;

use crate::path::Flavor;

/// The cursor offset at the end of `text` (`measureEditText`).
pub fn measure(text: &str) -> u32 {
    text.split('\n').map(|line| line.width() + 1).sum::<usize>() as u32 - 1
}

/// The byte index in `text` whose offset is `offset`, or the last character boundary before it
/// (`promptOffsetIndex`). Offsets never decrease as a prefix grows, so it binary searches.
pub fn index_at(text: &str, offset: u32) -> usize {
    let boundaries: Vec<usize> = text.char_indices().map(|(index, _)| index).chain([text.len()]).collect();
    let (mut low, mut high) = (0, boundaries.len() - 1);
    while low < high {
        let middle = (low + high).div_ceil(2);
        if measure(&text[..boundaries[middle]]) > offset {
            high = middle - 1;
            continue;
        }
        low = middle;
    }
    boundaries[low]
}

/// `mentionTriggerIndex`: the offset of the last `@` that starts a word with no whitespace after it.
pub fn mention_trigger(text: &str) -> Option<u32> {
    let index = text.rfind('@')?;
    let before = text[..index].chars().next_back();
    let open = before.is_none_or(char::is_whitespace) && !text[index..].contains(char::is_whitespace);
    open.then(|| measure(&text[..index]))
}

/// `slashTriggerIndex`: the offset of a `/` that starts a word, with no whitespace or `/` after it.
pub fn slash_trigger(text: &str) -> Option<u32> {
    for (index, _) in text.match_indices('/').rev() {
        let before = text[..index].chars().next_back();
        if before.is_some_and(|before| !before.is_whitespace()) {
            continue;
        }
        let query = &text[index..];
        if query.contains(char::is_whitespace) || query[1..].contains('/') {
            return None;
        }
        return Some(measure(&text[..index]));
    }
    None
}

/// A `#12` or `#12-20` suffix on a file query.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LineRange {
    pub start: u32,
    pub end: Option<u32>,
}

/// `parseFileLineRange`: the query without its line range, and the range.
pub fn file_line_range(input: &str) -> (&str, Option<LineRange>) {
    let Some(hash) = input.rfind('#').filter(|&hash| hash > 0) else { return (input, None) };
    let suffix = &input[hash + 1..];
    let (start, end) = suffix.split_once('-').unwrap_or((suffix, ""));
    let digits = |text: &str| text.chars().all(|c| c.is_ascii_digit());
    let ranged = suffix.contains('-');
    if start.is_empty() || !digits(start) || !digits(end) {
        return (input, None);
    }
    let start: u32 = start.parse().unwrap_or(u32::MAX);
    let end = (ranged && !end.is_empty()).then(|| end.parse::<u32>().ok()).flatten().filter(|&end| start < end);
    (&input[..hash], Some(LineRange { start, end }))
}

/// `parseSlashHead(text, /\s/)`: the name after `/`, the text after the first whitespace, and the
/// byte index of that whitespace (the text's length without one).
pub fn slash_head(text: &str) -> Option<(&str, &str, usize)> {
    let rest = text.strip_prefix('/')?;
    let Some(end) = rest.find(char::is_whitespace) else { return Some((rest, "", text.len())) };
    let separator = rest[end..].chars().next().map_or(1, char::len_utf8);
    Some((&rest[..end], &rest[end + separator..], end + 1))
}

/// Where a directory query lists, what its values start with, and the name part it filters by
/// (`directoryAutocompleteSearch`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DirectorySearch {
    pub directory: String,
    pub prefix: String,
    pub query: String,
}

pub fn directory_search(flavor: Flavor, query: &str, directory: &str, home: &str) -> DirectorySearch {
    if query == "~" {
        return DirectorySearch { directory: home.to_owned(), prefix: "~/".to_owned(), query: String::new() };
    }
    if let Some(rest) = query.strip_prefix("~/") {
        return search_in(flavor, rest, home, "~/");
    }
    // `/^(?:\.\.\/)*\.\.$/`.
    if query.split('/').all(|part| part == "..") {
        return DirectorySearch {
            directory: resolve(flavor, directory, query),
            prefix: format!("{query}/"),
            query: String::new(),
        };
    }
    if let Some(rest) = query.strip_prefix('/') {
        return search_in(flavor, rest, &flavor.root(directory), "/");
    }
    search_in(flavor, query, directory, "")
}

fn search_in(flavor: Flavor, query: &str, root: &str, prefix: &str) -> DirectorySearch {
    let Some(separator) = query.rfind('/') else {
        return DirectorySearch { directory: root.to_owned(), prefix: prefix.to_owned(), query: query.to_owned() };
    };
    let parent = &query[..separator + 1];
    DirectorySearch {
        directory: resolve(flavor, root, parent),
        prefix: format!("{prefix}{parent}"),
        query: query[separator + 1..].to_owned(),
    }
}

/// `directoryAutocompleteResultValue`.
pub fn directory_value(directory: &str, search: &DirectorySearch) -> String {
    format!("{}{}", search.prefix, directory.trim_start_matches(['/', '\\']))
}

/// `directoryAutocompleteExactValue`: the query itself, when it names a directory to list.
pub fn directory_exact(value: &str, search: &DirectorySearch) -> Option<String> {
    (!value.is_empty() && !search.prefix.is_empty() && search.query.is_empty()).then(|| value.to_owned())
}

/// `directoryAutocompleteMatches`: a case-insensitive prefix; hidden directories need a query.
pub fn directory_matches(directory: &str, query: &str) -> bool {
    let value = directory.trim_start_matches(['/', '\\']);
    if query.is_empty() && value.starts_with('.') {
        return false;
    }
    value.to_lowercase().starts_with(&query.to_lowercase())
}

/// `directoryRecentValue`: `~`-relative inside the home directory, else absolute.
pub fn directory_recent_value(flavor: Flavor, directory: &str, home: &str) -> String {
    let directory = resolve(flavor, directory, "");
    let relative = flavor.relative(home, &directory);
    if relative.is_empty() {
        return "~".to_owned();
    }
    if flavor.outside(&relative) {
        return directory;
    }
    format!("~/{}", slashes(flavor, &relative))
}

/// `path.resolve(base, path)`: absolute and lexically normalized.
pub fn resolve(flavor: Flavor, base: &str, path: &str) -> String {
    flavor.resolve(&[base, path])
}

/// `path.basename`.
pub fn basename(flavor: Flavor, path: &str) -> &str {
    flavor.basename(path)
}

/// `path.relative(base, path)` when `path` is inside `base`, else `path` resolved; with `/` separators
/// (`normalizeMentionPath`).
pub fn mention_path(flavor: Flavor, base: &str, path: &str) -> String {
    let absolute = resolve(flavor, base, path);
    let relative = flavor.relative(base, &absolute);
    if relative.is_empty() || flavor.outside(&relative) {
        return slashes(flavor, &absolute);
    }
    slashes(flavor, &relative)
}

// `path.split(path.sep).join("/")`.
fn slashes(flavor: Flavor, path: &str) -> String {
    path.replace(flavor.sep(), "/")
}

/// `pathToFileURL(path).href`: the URL path percent-encode set, plus `%` and `\`, as Node encodes it. On Windows
/// `\` separates segments, a drive path starts `file:///C:/`, and a UNC path names its server as the host.
pub fn file_url(flavor: Flavor, path: &str) -> String {
    let (mut url, path) = match flavor {
        Flavor::Posix => (String::from("file://"), path.to_owned()),
        Flavor::Windows => {
            let path = path.replace('\\', "/");
            match path.strip_prefix("//") {
                Some(unc) => (String::from("file://"), unc.to_owned()),
                None if path.starts_with('/') => (String::from("file://"), path),
                None => (String::from("file:///"), path),
            }
        }
    };
    for byte in path.bytes() {
        let encode = byte <= 0x20 || byte >= 0x7f || b"\"#%<>?`{}\\".contains(&byte);
        if !encode {
            url.push(byte as char);
        } else {
            url.push_str(&format!("%{byte:02X}"));
        }
    }
    url
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn triggers_open_at_word_starts() {
        assert_eq!(mention_trigger("@"), Some(0));
        assert_eq!(mention_trigger("fix @src/ma"), Some(4));
        assert_eq!(mention_trigger("a@b"), None);
        assert_eq!(mention_trigger("@src done"), None);
        assert_eq!(mention_trigger("日本 @x"), Some(5));
        assert_eq!(slash_trigger("/"), Some(0));
        assert_eq!(slash_trigger("/rev"), Some(0));
        assert_eq!(slash_trigger("/review x"), None);
        assert_eq!(slash_trigger("see /a/b"), None);
        assert_eq!(slash_trigger("a/b"), None);
        assert_eq!(slash_trigger("x\n/s"), Some(2));
    }

    #[test]
    fn line_ranges_and_slash_heads() {
        let range = |start, end| Some(LineRange { start, end });
        assert_eq!(file_line_range("src/a.ts#12"), ("src/a.ts", range(12, None)));
        assert_eq!(file_line_range("src/a.ts#12-20"), ("src/a.ts", range(12, Some(20))));
        assert_eq!(file_line_range("src/a.ts#12-"), ("src/a.ts", range(12, None)));
        assert_eq!(file_line_range("src/a.ts#20-12"), ("src/a.ts", range(20, None)));
        assert_eq!(file_line_range("#12"), ("#12", None));
        assert_eq!(file_line_range("a#x"), ("a#x", None));
        assert_eq!(slash_head("/cd ../x"), Some(("cd", "../x", 3)));
        assert_eq!(slash_head("/init"), Some(("init", "", 5)));
        assert_eq!(slash_head("hi"), None);
    }

    #[test]
    fn directory_searches_follow_typescript() {
        let search = |query| directory_search(Flavor::Posix, query, "/p/app", "/home/u");
        let dir = |directory: &str, prefix: &str, query: &str| DirectorySearch {
            directory: directory.into(),
            prefix: prefix.into(),
            query: query.into(),
        };
        assert_eq!(search("~"), dir("/home/u", "~/", ""));
        assert_eq!(search("~/src/o"), dir("/home/u/src", "~/src/", "o"));
        assert_eq!(search("../.."), dir("/", "../../", ""));
        assert_eq!(search("/usr/lo"), dir("/usr", "/usr/", "lo"));
        assert_eq!(search("pack"), dir("/p/app", "", "pack"));
        assert_eq!(search("packages/t"), dir("/p/app/packages", "packages/", "t"));
        let found = search("~/src/");
        assert_eq!(directory_exact("~/src/", &found).as_deref(), Some("~/src/"));
        assert_eq!(directory_exact("pack", &search("pack")), None);
        assert_eq!(directory_value("opencode/", &found), "~/src/opencode/");
        assert!(directory_matches("Packages", "pa"));
        assert!(!directory_matches(".git", ""));
        assert!(directory_matches(".git", ".g"));
        let recent = |directory| directory_recent_value(Flavor::Posix, directory, "/home/u");
        assert_eq!(recent("/home/u"), "~");
        assert_eq!(recent("/home/u/src/x"), "~/src/x");
        assert_eq!(recent("/srv/x"), "/srv/x");
        assert_eq!(recent("/home/user"), "/home/user");
    }

    #[test]
    fn windows_directory_searches_follow_path_win32() {
        let w = Flavor::Windows;
        let search = |query| directory_search(w, query, "C:\\p\\app", "C:\\Users\\u");
        let dir = |directory: &str, prefix: &str, query: &str| DirectorySearch {
            directory: directory.into(),
            prefix: prefix.into(),
            query: query.into(),
        };
        assert_eq!(search("~/src/o"), dir("C:\\Users\\u\\src", "~/src/", "o"));
        assert_eq!(search("../.."), dir("C:\\", "../../", ""));
        assert_eq!(search("/Windows/Sy"), dir("C:\\Windows", "/Windows/", "Sy"));
        assert_eq!(search("/"), dir("C:\\", "/", ""));
        assert_eq!(search("packages/t"), dir("C:\\p\\app\\packages", "packages/", "t"));
        assert_eq!(directory_search(w, "/x", "\\\\srv\\share\\p", "").directory, "\\\\srv\\share\\");
        let recent = |directory| directory_recent_value(w, directory, "C:\\Users\\u");
        assert_eq!(recent("c:\\users\\U"), "~");
        assert_eq!(recent("C:\\Users\\u\\src/x"), "~/src/x");
        assert_eq!(recent("D:\\x"), "D:\\x");
    }

    #[test]
    fn paths_and_urls() {
        let p = Flavor::Posix;
        assert_eq!(resolve(p, "/p", "a/../b/./c"), "/p/b/c");
        assert_eq!(mention_path(p, "/p", "/p/src/a.ts"), "src/a.ts");
        assert_eq!(mention_path(p, "/p", "/q/a.ts"), "/q/a.ts");
        assert_eq!(mention_path(p, "/p", "/p"), "/p");
        assert_eq!(basename(p, "/p/src/"), "src");
        assert_eq!(file_url(p, "/p/a b#1.ts"), "file:///p/a%20b%231.ts");
        assert_eq!(file_url(p, "/p/a\\b"), "file:///p/a%5Cb");
        let w = Flavor::Windows;
        assert_eq!(resolve(w, "C:\\p", "a/../b"), "C:\\p\\b");
        assert_eq!(mention_path(w, "C:\\p", "src\\a.ts"), "src/a.ts");
        assert_eq!(mention_path(w, "C:\\p", "D:\\q\\a.ts"), "D:/q/a.ts");
        assert_eq!(basename(w, "C:\\p\\src\\"), "src");
        assert_eq!(file_url(w, "C:\\p\\a b#1.ts"), "file:///C:/p/a%20b%231.ts");
        assert_eq!(file_url(w, "\\\\srv\\share\\a.ts"), "file://srv/share/a.ts");
        assert_eq!(index_at("日本x", 2), 3);
        assert_eq!(index_at("日本x", 3), 3);
    }

    #[test]
    fn index_at_matches_a_linear_scan_and_stays_fast() {
        let linear = |text: &str, offset| {
            text.char_indices()
                .map(|(index, _)| index)
                .chain([text.len()])
                .take_while(|&index| measure(&text[..index]) <= offset)
                .last()
                .unwrap_or(0)
        };
        let text = "a日\nb本\n\nxyz";
        for offset in 0..=measure(text) + 1 {
            assert_eq!(index_at(text, offset), linear(text, offset), "offset {offset}");
        }
        let long = "the quick brown fox jumps over the lazy dog 日本語\n".repeat(400);
        let started = std::time::Instant::now();
        assert_eq!(index_at(&long, measure(&long)), long.len());
        assert!(started.elapsed() < std::time::Duration::from_millis(200), "{:?}", started.elapsed());
    }
}
