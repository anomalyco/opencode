//! Themes (U.1): the built-in, custom, and `system` themes, resolved into semantic tokens the way
//! `packages/theme/src/tui` and `packages/tui/src/theme` do, plus the TUI's theme state (`context/theme.tsx`).
//!
//! Built-in themes come from `generated/themes.json`, which `script/gen/themes.ts` writes from the TypeScript
//! sources: V1 themes arrive already migrated, so their documents match by construction. Custom V1 themes and the
//! `system` theme are migrated here at runtime. `parity/fixtures/U.1/tokens.json` holds the TypeScript resolver's
//! tokens for every theme and mode; `tests/theme_oracle.rs` compares them with this resolver.

mod catalog;
mod color;
mod discovery;
mod document;
mod resolve;
mod state;
mod system;
mod tokens;
mod v1;
mod v1_new;

use std::ops::Deref;
use std::rc::Rc;

use opentui::style::Color;
pub use opentui::theme::ThemeMode;

pub use catalog::{Catalog, Loaded, ThemeSource};
pub use color::tint;
pub use discovery::{config_directories, discover};
pub use state::{Effect, ModeSetting, ThemeError, ThemeState, ThemeStateOptions};
pub use system::{TerminalColors, generate_system, terminal_mode};
pub use tokens::{
    ActionStates, Actions, Background, Base, Diff, DiffBackground, DiffLineNumber, DiffPair,
    DiffText, Feedback, Markdown, Raised, Stateful, Syntax, Text, TextFeedback, Tokens,
};

/// The hue steps, lightest role first: index 0 is step 100.
pub const STEPS: [u16; 9] = document::STEPS;

/// A raised surface whose tokens differ from the page's.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Surface {
    Dialog,
    DialogFooter,
}

/// One hue's nine steps.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Scale(pub [Color; 9]);

impl Scale {
    /// The color at `step` (100 to 900); other values clamp to the nearest step.
    pub fn step(&self, step: u16) -> Color {
        self.0[usize::from(step.clamp(100, 900) / 100 - 1)]
    }
}

/// Where a color sits on a hue scale.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HueSource<'a> {
    pub hue: &'a str,
    pub step: u16,
}

pub(crate) struct Views {
    pub hue: Vec<(String, Scale)>,
    pub categorical: Vec<Scale>,
    /// The index into `hue` of each categorical scale.
    pub categorical_hues: Vec<usize>,
    /// The page, dialog, and dialog-footer tokens.
    pub surfaces: [Tokens; 3],
    /// Each surface's tokens with the hue step each was read from.
    pub tones: [Vec<resolve::Tone>; 3],
}

/// A resolved theme seen from one surface (`ResolvedTheme`). Dereferences to that surface's [`Tokens`]; cloning is
/// cheap.
#[derive(Clone)]
pub struct Theme {
    views: Rc<Views>,
    surface: usize,
}

impl Deref for Theme {
    type Target = Tokens;

    fn deref(&self) -> &Tokens {
        &self.views.surfaces[self.surface]
    }
}

/// Equal when the surface and every color it can reach are, so a rebuild that resolves the same colors is not a
/// change.
impl PartialEq for Theme {
    fn eq(&self, other: &Self) -> bool {
        self.surface == other.surface
            && (Rc::ptr_eq(&self.views, &other.views)
                || (self.views.surfaces == other.views.surfaces
                    && self.views.hue == other.views.hue
                    && self.views.categorical == other.views.categorical))
    }
}

impl std::fmt::Debug for Theme {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Theme")
            .field("surface", &self.surface)
            .field("tokens", &**self)
            .finish_non_exhaustive()
    }
}

impl Theme {
    fn new(views: Views) -> Self {
        Self {
            views: Rc::new(views),
            surface: 0,
        }
    }

    /// The same theme on a raised surface. Absolute: every view's surfaces are the page theme's.
    pub fn surface(&self, surface: Surface) -> Theme {
        let surface = match surface {
            Surface::Dialog => 1,
            Surface::DialogFooter => 2,
        };
        Theme {
            views: self.views.clone(),
            surface,
        }
    }

    /// The page view.
    pub fn page(&self) -> Theme {
        Theme {
            views: self.views.clone(),
            surface: 0,
        }
    }

    /// Every named hue in definition order, the semantic `accent`, `interactive`, and `neutral` among them.
    pub fn hues(&self) -> &[(String, Scale)] {
        &self.views.hue
    }

    pub fn hue(&self, name: &str) -> Option<&Scale> {
        self.views
            .hue
            .iter()
            .find(|(hue, _)| hue == name)
            .map(|(_, scale)| scale)
    }

    pub fn accent(&self) -> &Scale {
        self.semantic("accent")
    }

    pub fn interactive(&self) -> &Scale {
        self.semantic("interactive")
    }

    pub fn neutral(&self) -> &Scale {
        self.semantic("neutral")
    }

    fn semantic(&self, name: &str) -> &Scale {
        // Every resolved theme defines the semantic hues; the schema and the migrations require them.
        self.hue(name).unwrap_or(&self.views.hue[0].1)
    }

    pub fn categorical(&self) -> &[Scale] {
        &self.views.categorical
    }

    /// The hue step `color` was read from. Like TypeScript, which matches by object identity, this takes a
    /// reference into the theme: a token field (on any surface) or a step of [`Theme::hues`] or
    /// [`Theme::categorical`]. A copy, a literal token, or a foreign color has no source.
    pub fn source(&self, color: &Color) -> Option<HueSource<'_>> {
        self.identity(color)
            .flatten()
            .map(|(hue, position)| HueSource {
                hue: &self.views.hue[hue].0,
                step: STEPS[position],
            })
    }

    /// `color` moved `amount` steps toward 900 on its hue, clamped. See [`Theme::decrease`].
    pub fn increase(&self, color: &Color, amount: i32) -> Color {
        self.shift(color, amount)
    }

    /// `color` moved `amount` steps toward 100 on its hue, clamped. A reference into the theme shifts by its
    /// [`Theme::source`]. A copy shifts by value: by the tokens of that value on this surface, else on the
    /// others, else by the hue steps of that value, when they all move it alike. Otherwise it is unchanged.
    pub fn decrease(&self, color: &Color, amount: i32) -> Color {
        self.shift(color, -amount)
    }

    fn shift(&self, color: &Color, amount: i32) -> Color {
        let shifted = |tone: Option<(usize, usize)>| {
            tone.map_or(*color, |(hue, position)| {
                let position = (position as i32 + amount).clamp(0, STEPS.len() as i32 - 1) as usize;
                self.views.hue[hue].1.0[position]
            })
        };
        if let Some(tone) = self.identity(color) {
            return shifted(tone);
        }
        // `Color` is `Copy`, so callers copy tokens without noticing; TypeScript keeps the token object.
        let tiers = self.tones(color);
        let Some(tier) = tiers.iter().find(|tier| !tier.is_empty()) else {
            return *color;
        };
        let first = shifted(tier[0]);
        if tier.iter().all(|tone| shifted(*tone) == first) {
            return first;
        }
        *color
    }

    /// The tones of the tokens with this value on this surface and on the others, then the hue steps with it.
    fn tones(&self, color: &Color) -> [Vec<Option<(usize, usize)>>; 3] {
        let mut tiers: [Vec<_>; 3] = Default::default();
        for (surface, tokens) in self.views.surfaces.iter().enumerate() {
            let tier = &mut tiers[usize::from(surface != self.surface)];
            let mut count = 0;
            tokens.visit_ref(&mut |_, token| {
                if token == color {
                    tier.push(self.views.tones[surface][count].1);
                }
                count += 1;
            });
        }
        let named = self.views.hue.iter().map(|(_, scale)| scale).enumerate();
        let categorical = self
            .views
            .categorical
            .iter()
            .zip(&self.views.categorical_hues)
            .map(|(scale, hue)| (*hue, scale));
        tiers[2] = named
            .chain(categorical)
            .flat_map(|(hue, scale)| {
                (0..STEPS.len())
                    .filter(|step| scale.0[*step] == *color)
                    .map(move |step| Some((hue, step)))
            })
            .collect();
        tiers
    }

    /// The tone of the token or step `color` points at: `Some(None)` for a token not read from a hue, `None` for a
    /// color outside the theme.
    fn identity(&self, color: &Color) -> Option<Option<(usize, usize)>> {
        for (surface, tokens) in self.views.surfaces.iter().enumerate() {
            let mut index = None;
            let mut count = 0;
            tokens.visit_ref(&mut |_, token| {
                if std::ptr::eq(token, color) {
                    index = Some(count);
                }
                count += 1;
            });
            if let Some(index) = index {
                return Some(self.views.tones[surface][index].1);
            }
        }
        let step = |scale: &Scale| scale.0.iter().position(|step| std::ptr::eq(step, color));
        let hue = self
            .views
            .hue
            .iter()
            .enumerate()
            .find_map(|(hue, (_, scale))| Some((hue, step(scale)?)));
        hue.or_else(|| {
            let categorical = self
                .views
                .categorical
                .iter()
                .zip(&self.views.categorical_hues);
            categorical
                .into_iter()
                .find_map(|(scale, hue)| Some((*hue, step(scale)?)))
        })
        .map(Some)
    }
}

pub(crate) fn mode_name(mode: ThemeMode) -> &'static str {
    v1::mode_name(mode)
}

/// A built-in or custom theme document resolved in `mode`, or in its first mode when it lacks `mode`.
pub(crate) fn resolve(
    document: &serde_json::Value,
    mode: ThemeMode,
) -> Result<(Theme, ThemeMode), String> {
    let (views, mode) = resolve::resolve_document(document, mode)?;
    Ok((Theme::new(views), mode))
}
