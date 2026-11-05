//! Entry and exit splash (`splash.ts`): M.4. M.1 writes the one-row entry header that a replay starts with
//! (`entrySplash`); the exit banner and the startup animation are M.4's.

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

/// `exitSplash`: the banner written when mini closes. `None` until M.4, so mini prints a newline instead.
pub fn exit(_app: &App, _title: Option<&str>, _session_id: &str, _theme: &SplashTheme, _mono: bool) -> Option<View> {
    None
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
}
