//! The slot tree: the `SlotMap` paths (`packages/plugin/src/tui/context.ts:191-202`), their inputs, and
//! the pure resolution of claims into placements (`packages/tui/src/plugin/structure.ts`).

use std::collections::HashMap;

pub const APP: &str = "app";
pub const HOME_FOOTER: &str = "home.footer";
pub const HOME_FOOTER_STATUS: &str = "home.footer.status";
pub const PROMPT_FOOTER: &str = "prompt.footer";
pub const PROMPT_FOOTER_STATUS: &str = "prompt.footer.status";
pub const PROMPT_FOOTER_FILE: &str = "prompt.footer.file";
pub const SESSION_COMPOSER_TOP: &str = "session.composer.top";
pub const SESSION_PANEL: &str = "session.panel";
pub const SIDEBAR_CONTENT: &str = "sidebar.content";
pub const SIDEBAR_FOOTER: &str = "sidebar.footer";

/// Every path the host publishes. A path contains every path it prefixes.
pub const PATHS: [&str; 10] = [
    APP,
    HOME_FOOTER,
    HOME_FOOTER_STATUS,
    PROMPT_FOOTER,
    PROMPT_FOOTER_STATUS,
    PROMPT_FOOTER_FILE,
    SESSION_COMPOSER_TOP,
    SESSION_PANEL,
    SIDEBAR_CONTENT,
    SIDEBAR_FOOTER,
];

/// What a slot passes to every claim that renders in it: the union of the `SlotMap` inputs. A path fills
/// the fields its TS input has and leaves the rest empty.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SlotInput {
    /// `prompt.footer*`, `session.composer.top`, `session.panel`, `sidebar.*`.
    pub session_id: Option<String>,
    /// `prompt.footer*`.
    pub prompt: Option<PromptFooter>,
    /// `session.panel`.
    pub panel: Option<Panel>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PromptFooter {
    pub shell: bool,
    pub show_details: bool,
}

/// The selected session panel (`PanelInput`). The host owns its layout and actions.
#[derive(Clone, Debug, PartialEq)]
pub struct Panel {
    pub name: String,
    pub width: u16,
    pub fullscreen: bool,
    pub focused: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    /// First inside the target's boundary.
    Prepend,
    /// Last inside the target's boundary.
    Append,
    /// A sibling before the target, outside its boundary.
    Before,
    /// A sibling after the target, outside its boundary.
    After,
    /// Takes the target over; the original content and every claim inside it are suppressed.
    Replace,
}

/// Where a claim goes: one kind and one absolute target path.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Placement {
    pub kind: Kind,
    pub target: String,
}

impl Placement {
    pub fn new(kind: Kind, target: impl Into<String>) -> Self {
        Self { kind, target: target.into() }
    }

    pub fn prepend(target: impl Into<String>) -> Self {
        Self::new(Kind::Prepend, target)
    }

    pub fn append(target: impl Into<String>) -> Self {
        Self::new(Kind::Append, target)
    }

    pub fn before(target: impl Into<String>) -> Self {
        Self::new(Kind::Before, target)
    }

    pub fn after(target: impl Into<String>) -> Self {
        Self::new(Kind::After, target)
    }

    pub fn replace(target: impl Into<String>) -> Self {
        Self::new(Kind::Replace, target)
    }
}

/// The claims one path renders besides its own content, as indices into the claims passed to [`resolve`].
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Placed {
    pub before: Vec<usize>,
    pub prepend: Vec<usize>,
    pub append: Vec<usize>,
    pub after: Vec<usize>,
    pub replace: Option<usize>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Resolution {
    /// Each targeted path's placements; an untargeted path is absent and renders only its content.
    pub placed: HashMap<String, Placed>,
    /// A suppressed claim and the claim that won, if any; none when a replacement's target does not exist.
    pub suppressed: Vec<(usize, Option<usize>)>,
    /// A claim whose target does not exist, appended to this surviving ancestor instead.
    pub degraded: Vec<(usize, String)>,
}

/// Whether `path` is strictly inside `ancestor`.
pub fn contains(ancestor: &str, path: &str) -> bool {
    path.len() > ancestor.len() && path.starts_with(ancestor) && path.as_bytes()[ancestor.len()] == b'.'
}

/// Resolves `claims`, in plugin enable order, against the published `paths` (`resolveSlots`). Per target
/// the last replacement wins; an accepted replacement swallows every claim inside it, whatever the enable
/// order; an additive claim on a missing path appends to its nearest published ancestor.
pub fn resolve(paths: &[&str], claims: &[Placement]) -> Resolution {
    let mut resolution = Resolution::default();

    // Replacement boundaries: the last claim per target, then shallow boundaries first so a nested one
    // meets its container.
    let mut winners: Vec<(&str, usize)> = Vec::new();
    for (index, claim) in claims.iter().enumerate() {
        if claim.kind != Kind::Replace {
            continue;
        }
        if !paths.contains(&claim.target.as_str()) {
            resolution.suppressed.push((index, None));
            continue;
        }
        match winners.iter_mut().find(|(target, _)| *target == claim.target) {
            Some(winner) => {
                resolution.suppressed.push((winner.1, Some(index)));
                winner.1 = index;
            }
            None => winners.push((&claim.target, index)),
        }
    }
    winners.sort_by_key(|(path, _)| depth(path));
    let mut boundaries: Vec<(&str, usize)> = Vec::new();
    for (path, winner) in winners {
        match containing(&boundaries, path) {
            Some(outer) => resolution.suppressed.push((winner, Some(outer))),
            None => boundaries.push((path, winner)),
        }
    }

    for (index, claim) in claims.iter().enumerate() {
        if claim.kind == Kind::Replace {
            continue;
        }
        let target = claim.target.as_str();
        // Inside placements on a replaced boundary are its contents; siblings of the boundary stay outside.
        let inside = matches!(claim.kind, Kind::Prepend | Kind::Append)
            .then(|| boundaries.iter().find(|(path, _)| *path == target).map(|(_, winner)| *winner))
            .flatten();
        if let Some(outer) = inside.or_else(|| containing(&boundaries, target)) {
            resolution.suppressed.push((index, Some(outer)));
            continue;
        }
        if paths.contains(&target) {
            let placed = resolution.placed.entry(target.to_owned()).or_default();
            match claim.kind {
                Kind::Before => placed.before.push(index),
                Kind::Prepend => placed.prepend.push(index),
                Kind::Append => placed.append.push(index),
                Kind::After => placed.after.push(index),
                Kind::Replace => unreachable!(),
            }
            continue;
        }
        let Some(ancestor) = ancestor(target, paths) else {
            resolution.suppressed.push((index, None));
            continue;
        };
        resolution.degraded.push((index, ancestor.to_owned()));
        resolution.placed.entry(ancestor.to_owned()).or_default().append.push(index);
    }

    for (path, winner) in boundaries {
        resolution.placed.entry(path.to_owned()).or_default().replace = Some(winner);
    }
    resolution
}

fn containing(boundaries: &[(&str, usize)], path: &str) -> Option<usize> {
    boundaries.iter().find(|(boundary, _)| contains(boundary, path)).map(|(_, winner)| *winner)
}

fn depth(path: &str) -> usize {
    path.split('.').count()
}

/// The nearest published ancestor of `path`.
fn ancestor<'a>(path: &str, paths: &[&'a str]) -> Option<&'a str> {
    path.rmatch_indices('.')
        .find_map(|(index, _)| paths.iter().find(|candidate| **candidate == &path[..index]).copied())
}
