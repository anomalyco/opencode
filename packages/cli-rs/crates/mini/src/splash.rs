//! Entry and exit splash (`splash.ts`): the one-row entry header a transcript starts under (`entrySplash`), and
//! the exit banner with the logo and the command that resumes the session (`exitSplash`).

use opentui::prelude::*;
use unicode_width::UnicodeWidthStr;

use crate::theme::SplashTheme;

/// `entrySplashLayout`: the label and as much metadata as fits, in priority order.
pub fn entry_layout(width: usize, version: &str, detail: &str, mono: bool) -> (String, String) {
    let segments: Vec<&str> = detail.split(['/', '\\']).filter(|part| !part.is_empty()).collect();
    let leaf = segments.last().copied().unwrap_or(detail);
    let separator = if mono { " - " } else { " · " };
    let ellipsis = if mono { "..." } else { "…" };
    let slash = if detail.contains('\\') { "\\" } else { "/" };
    let mut paths: Vec<String> = (1..segments.len())
        .map(|start| format!("{ellipsis}{slash}{}", segments[start..].join(slash)))
        .filter(|path| path.width() < detail.width())
        .collect();
    paths.reverse();
    if !detail.is_empty() {
        paths.push(detail.to_owned());
    }
    let mut label = take_width("oc mini", width);
    let (mut current_version, mut path) = (String::new(), String::new());
    let mut metadata = String::new();
    let mut stages: Vec<(Option<String>, Option<String>, Option<String>)> =
        vec![(Some(format!("{} oc mini", if mono { "[O]" } else { "▪" })), None, None)];
    if !leaf.is_empty() {
        stages.push((None, None, Some(leaf.to_owned())));
    }
    if !version.is_empty() {
        stages.push((None, Some(version.to_owned()), None));
    }
    stages.extend(paths.into_iter().map(|path| (None, None, Some(path))));
    // Stop at the first stage that does not fit instead of backfilling lower-priority metadata.
    for (next_label, next_version, next_path) in stages {
        let next_label = next_label.unwrap_or_else(|| label.clone());
        let next_version = next_version.unwrap_or_else(|| current_version.clone());
        let next_path = next_path.unwrap_or_else(|| path.clone());
        let next_metadata = format!(
            "{}{}",
            if next_version.is_empty() { String::new() } else { format!(" v{next_version}") },
            if next_path.is_empty() { String::new() } else { format!("{separator}{next_path}") }
        );
        if (next_label.clone() + &next_metadata).width() > width {
            break;
        }
        (label, current_version, path, metadata) = (next_label, next_version, next_path, next_metadata);
    }
    (label, metadata)
}

fn take_width(text: &str, width: usize) -> String {
    let mut taken = String::new();
    for c in text.chars() {
        if (taken.clone() + &c.to_string()).width() > width {
            break;
        }
        taken.push(c);
    }
    taken
}

/// `entrySplash`: a blank row, then the header, as a two-row block that starts on a new line.
pub fn entry(app: &App, width: u32, version: &str, detail: &str, theme: &SplashTheme, mono: bool) -> View {
    let (label, metadata) = entry_layout(width as usize, version, detail, mono);
    View::new(app)
        .height(2)
        .padding_edge(Edge::Top, 1)
        .child(&Text::new(app, vec![label.fg(theme.right), metadata.fg(theme.left)]).wrap(WrapMode::None))
}

/// `SPLASH_TITLE_LIMIT`.
const TITLE_LIMIT: usize = 50;

/// `title`: whitespace runs as one space, truncated, else `Untitled session`.
pub fn title(text: Option<&str>, mono: bool) -> String {
    let value = text.unwrap_or_default().split_whitespace().collect::<Vec<_>>().join(" ");
    if value.is_empty() {
        return "Untitled session".to_owned();
    }
    if mono {
        return crate::theme::mono_truncate(&value, TITLE_LIMIT, true);
    }
    opencode_ui::select::truncate(&value, TITLE_LIMIT)
}

/// The `go.right` logo without its blank first row; `_` is a full cell, `^` a half block over the shadow, `~` a
/// half block in the shadow.
const MARK: [&str; 3] = ["█▀▀█", "█__█", "▀▀▀▀"];

/// `exitSplash`: the banner written when mini closes: the logo, the session's title, and `Continue opencode mini
/// -s <id>`. A terminal too narrow for the row writes the command alone, wrapped.
pub fn exit(app: &App, width: u32, title: &str, session_id: &str, theme: &SplashTheme, mono: bool) -> View {
    let width = width.max(1);
    let mark: &[&str] = if mono { &["[O]"] } else { &MARK };
    let top = 1;
    let body = mark[0].chars().count() as u32 + 2;
    let (session, label) = ("Session  ", "Continue ");
    let command = format!("opencode mini -s {session_id}");
    let wide = body as usize + (label.to_owned() + &command).width() <= width as usize;
    let command_height = if wide { 1 } else { (command.width() as u32).div_ceil(width) };
    let height = top + if wide { (mark.len() as u32).max(2) } else { command_height };
    let root = View::new(app).width(width).height(height);
    let place = |widget: &Text, left: u32, row: u32, cells: u32| {
        widget.absolute().position(Edge::Left, left).position(Edge::Top, row).width(cells.max(1)).height(1);
        root.add(widget);
    };
    if wide {
        for (index, row) in mark.iter().enumerate() {
            let spans: Vec<Span> = row
                .chars()
                .map(|char| match char {
                    '_' => " ".fg(theme.left).bg(theme.left_shadow),
                    '^' => "▀".fg(theme.left).bg(theme.left_shadow),
                    '~' => "▀".fg(theme.left_shadow),
                    char => char.to_string().fg(theme.left),
                })
                .collect();
            place(&Text::new(app, spans).wrap(WrapMode::None), 0, top + index as u32, width);
        }
        let row = vec![session.fg(theme.left), title.to_owned().fg(theme.right).attributes(Attributes::BOLD)];
        place(&Text::new(app, row).wrap(WrapMode::None), body, top, width.saturating_sub(body));
        place(&Text::new(app, label.fg(theme.left)).wrap(WrapMode::None), body, top + 1, width.saturating_sub(body));
    }
    let left = if wide { body + label.len() as u32 } else { 0 };
    let text = Text::new(app, command.fg(theme.right).attributes(Attributes::BOLD)).wrap(WrapMode::Char);
    text.absolute()
        .position(Edge::Left, left)
        .position(Edge::Top, if wide { top + 1 } else { top })
        .width(width.saturating_sub(left).max(1))
        .height(command_height);
    root.add(&text);
    root
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_entry_header_drops_metadata_that_does_not_fit() {
        let layout = |width| entry_layout(width, "1.2.3", "/home/me/src/app", false);
        assert_eq!(layout(80), ("▪ oc mini".into(), " v1.2.3 · /home/me/src/app".into()));
        assert_eq!(layout(28), ("▪ oc mini".into(), " v1.2.3 · …/src/app".into()));
        assert_eq!(layout(20), ("▪ oc mini".into(), " · app".into()));
        assert_eq!(layout(14), ("▪ oc mini".into(), "".into()));
        assert_eq!(layout(5), ("oc mi".into(), "".into()));
        assert_eq!(entry_layout(80, "local", "/tmp/mini", true), ("[O] oc mini".into(), " vlocal - /tmp/mini".into()));
    }

    #[test]
    fn titles_collapse_whitespace_and_truncate() {
        assert_eq!(title(None, false), "Untitled session");
        assert_eq!(title(Some("  fix \n the   bug "), false), "fix the bug");
        assert_eq!(title(Some(&"x".repeat(60)), false).chars().count(), 50);
        assert!(title(Some(&"x".repeat(60)), true).ends_with("..."));
    }
}
