//! V1 themes (`{ defs, theme }` with flat color keys) and their migration to V2 documents (`v1-migrate.ts` in
//! `packages/theme/src/tui`). Custom V1 themes and the generated `system` theme take this path at runtime.

use std::collections::HashMap;

use opentui::style::Color;
use opentui::theme::ThemeMode;
use serde_json::{Map, Value, json};

use super::color::{ansi, from_hex, hex, hex_ints, luminance, oklch_to_hex, to_oklch};
use super::document::{STEPS, truthy};

pub(crate) const CHROMATIC: [&str; 7] =
    ["red", "orange", "yellow", "green", "cyan", "blue", "purple"];
pub(crate) const CATEGORICAL: [&str; 7] = [
    "secondary",
    "accent",
    "success",
    "warning",
    "primary",
    "error",
    "info",
];

/// Every V1 color the migrations read. `selectedListItemText` and `backgroundMenu` have defaults, and nothing
/// reads `borderSubtle`.
const REQUIRED: [&str; 49] = [
    "primary",
    "secondary",
    "accent",
    "error",
    "warning",
    "success",
    "info",
    "text",
    "textMuted",
    "background",
    "backgroundPanel",
    "backgroundElement",
    "border",
    "borderActive",
    "diffAdded",
    "diffRemoved",
    "diffContext",
    "diffHunkHeader",
    "diffHighlightAdded",
    "diffHighlightRemoved",
    "diffAddedBg",
    "diffRemovedBg",
    "diffContextBg",
    "diffLineNumber",
    "diffAddedLineNumberBg",
    "diffRemovedLineNumberBg",
    "markdownText",
    "markdownHeading",
    "markdownLink",
    "markdownLinkText",
    "markdownCode",
    "markdownBlockQuote",
    "markdownEmph",
    "markdownStrong",
    "markdownHorizontalRule",
    "markdownListItem",
    "markdownListEnumeration",
    "markdownImage",
    "markdownImageText",
    "markdownCodeBlock",
    "syntaxComment",
    "syntaxKeyword",
    "syntaxFunction",
    "syntaxVariable",
    "syntaxString",
    "syntaxNumber",
    "syntaxType",
    "syntaxOperator",
    "syntaxPunctuation",
];

/// A V1 theme resolved for one mode: `resolveV1`.
pub(crate) struct V1 {
    colors: HashMap<String, Color>,
    pub has_selected_list_item_text: bool,
}

impl V1 {
    pub fn get(&self, key: &str) -> Color {
        self.colors.get(key).copied().unwrap_or(Color::TRANSPARENT)
    }

    pub fn resolve(theme: &Value, mode: ThemeMode) -> Result<Self, String> {
        let empty = Map::new();
        let defs = theme
            .get("defs")
            .and_then(Value::as_object)
            .unwrap_or(&empty);
        let colors = theme
            .get("theme")
            .and_then(Value::as_object)
            .ok_or("Invalid V1 theme color")?;
        let resolve = |value: &Value| resolve_v1_color(value, defs, colors, mode, &mut Vec::new());
        let mut resolved = HashMap::new();
        for (key, value) in colors {
            if matches!(
                key.as_str(),
                "selectedListItemText" | "backgroundMenu" | "thinkingOpacity"
            ) {
                continue;
            }
            resolved.insert(key.clone(), resolve(value)?);
        }
        // TypeScript fails later, with a type error, on a missing color.
        if let Some(key) = REQUIRED.iter().find(|key| !resolved.contains_key(**key)) {
            return Err(format!("Color \"{key}\" is missing from the theme"));
        }
        let has_selected_list_item_text = colors.contains_key("selectedListItemText");
        let selected = match colors.get("selectedListItemText") {
            Some(value) => resolve(value)?,
            None => resolved["background"],
        };
        let menu = match colors.get("backgroundMenu").filter(|value| truthy(value)) {
            Some(value) => resolve(value)?,
            None => resolved["backgroundElement"],
        };
        resolved.insert("selectedListItemText".to_owned(), selected);
        resolved.insert("backgroundMenu".to_owned(), menu);
        Ok(Self {
            colors: resolved,
            has_selected_list_item_text,
        })
    }
}

fn resolve_v1_color(
    value: &Value,
    defs: &Map<String, Value>,
    theme: &Map<String, Value>,
    mode: ThemeMode,
    chain: &mut Vec<String>,
) -> Result<Color, String> {
    match value {
        Value::String(text) if text == "transparent" || text == "none" => Ok(Color::TRANSPARENT),
        Value::String(text) if text.starts_with('#') => Ok(from_hex(text)),
        Value::String(text) => {
            if chain.contains(text) {
                return Err(format!(
                    "Circular color reference: {} -> {text}",
                    chain.join(" -> ")
                ));
            }
            let next = defs
                .get(text)
                .filter(|value| !value.is_null())
                .or_else(|| theme.get(text));
            let Some(next) = next else {
                return Err(format!(
                    "Color reference \"{text}\" not found in defs or theme"
                ));
            };
            chain.push(text.clone());
            let color = resolve_v1_color(next, defs, theme, mode, chain);
            chain.pop();
            color
        }
        Value::Number(number) => Ok(ansi(number.as_f64().unwrap_or(0.0))),
        Value::Object(variant) => match variant.get(mode_name(mode)) {
            Some(value) => resolve_v1_color(value, defs, theme, mode, chain),
            None => Err("Invalid V1 theme color".to_owned()),
        },
        _ => Err("Invalid V1 theme color".to_owned()),
    }
}

pub(crate) fn mode_name(mode: ThemeMode) -> &'static str {
    match mode {
        ThemeMode::Dark => "dark",
        ThemeMode::Light => "light",
    }
}

/// How a migration lays one mode of a V1 theme out as a V2 definition.
pub(crate) type MigrateMode = fn(&V1, ThemeMode) -> Map<String, Value>;

/// `migrateV1`.
pub(crate) fn migrate(theme: &Value) -> Result<Value, String> {
    migrate_with(
        theme,
        migrate_mode,
        |definition, _| json!({ "hue": definition["hue"] }),
    )
}

/// The shape both migrations share: one mode when light and dark resolve to the same opaque background with the
/// same brightness, else a light base with a full dark definition. `light` builds the light mode's overrides.
pub(crate) fn migrate_with(
    theme: &Value,
    migrate: MigrateMode,
    light: fn(&Map<String, Value>, &V1) -> Value,
) -> Result<Value, String> {
    let light_theme = V1::resolve(theme, ThemeMode::Light)?;
    let dark_theme = V1::resolve(theme, ThemeMode::Dark)?;
    let (light_background, dark_background) =
        (light_theme.get("background"), dark_theme.get("background"));
    if light_background.a > 0 && dark_background.a > 0 && light_background == dark_background {
        let light_mode = detect_mode(&light_theme);
        if light_mode == detect_mode(&dark_theme) {
            let source = if light_mode == ThemeMode::Light {
                &light_theme
            } else {
                &dark_theme
            };
            let definition = migrate(source, light_mode);
            if light_mode == ThemeMode::Light {
                return Ok(
                    json!({ "base": base(&definition), "light": light(&definition, &light_theme) }),
                );
            }
            return Ok(json!({ "base": base(&definition), "dark": { "hue": definition["hue"] } }));
        }
    }
    let light_definition = migrate(&light_theme, ThemeMode::Light);
    let dark_definition = migrate(&dark_theme, ThemeMode::Dark);
    Ok(json!({
        "base": base(&light_definition),
        "light": light(&light_definition, &light_theme),
        "dark": dark_definition,
    }))
}

pub(crate) fn base(definition: &Map<String, Value>) -> Value {
    Value::Object(
        definition
            .iter()
            .filter(|(key, _)| *key != "hue")
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect(),
    )
}

pub(crate) fn detect_mode(theme: &V1) -> ThemeMode {
    if luminance(theme.get("text")) > luminance(theme.get("background")) {
        ThemeMode::Dark
    } else {
        ThemeMode::Light
    }
}

fn migrate_mode(theme: &V1, mode: ThemeMode) -> Map<String, Value> {
    let color = |key: &str| hex(theme.get(key));
    let selected = hex(selected_foreground(theme, theme.get("primary")));
    let destructive = hex(selected_foreground(theme, theme.get("error")));
    let hues = infer_hues(theme);
    let (text, text_muted, primary) = (
        "$hue.neutral.200",
        "$hue.neutral.400",
        "$hue.interactive.200",
    );
    let (background, panel, menu, max) = (
        "$hue.neutral.800",
        "$hue.neutral.700",
        "$hue.neutral.600",
        "$hue.neutral.500",
    );
    let mut hue = Map::new();
    hue.insert("gray".to_owned(), scale_value(&neutral_scale(theme)));
    for (name, matched) in hues.chromatic() {
        hue.insert(name.to_owned(), scale_value(&hue_scale(matched, mode)));
    }
    hue.insert("accent".to_owned(), json!(hues.alias("accent")));
    hue.insert("interactive".to_owned(), json!(hues.alias("primary")));
    hue.insert("neutral".to_owned(), json!("$hue.gray"));
    let definition = json!({
        "hue": hue,
        "categorical": hues.categorical(),
        "text": {
            "base": text,
            "muted": text_muted,
            "action": {
                "primary": { "base": "$text.base", "$disabled": text_muted, "$focused": selected, "$selected": primary },
                "secondary": { "base": "$text.muted", "$hovered": "$text.base" },
                "destructive": { "base": destructive, "$disabled": text_muted },
            },
            "formfield": {
                "base": text,
                "$hovered": primary,
                "$focused": primary,
                "$pressed": primary,
                "$disabled": text_muted,
                "$selected": primary,
            },
            "feedback": feedback_text(theme),
        },
        "background": {
            "base": background,
            "raised": { "base": panel, "high": menu, "max": max },
            "action": {
                "primary": { "base": "transparent", "$hovered": panel, "$focused": primary, "$selected": "transparent" },
                "secondary": { "base": "transparent" },
                "destructive": { "base": color("error") },
            },
            "formfield": { "base": "$background.base" },
            "feedback": feedback_background(),
        },
        "@palette": palette_tokens(theme),
        "@dialog": {
            "background": {
                "base": dialog_background(theme),
                "action": { "primary": { "$hovered": "$background.raised.high" } },
            },
        },
    });
    reference_hues(splice_palette(definition))
}

pub(crate) fn feedback_text(theme: &V1) -> Value {
    let color = |key: &str| hex(theme.get(key));
    json!({
        "error": { "base": color("error") },
        "warning": { "base": color("warning") },
        "success": { "base": color("success") },
        "info": { "base": color("info") },
    })
}

pub(crate) fn feedback_background() -> Value {
    json!({
        "error": { "base": "$background.base" },
        "warning": { "base": "$background.base" },
        "success": { "base": "$background.base" },
        "info": { "base": "$background.base" },
    })
}

/// The tokens both migrations copy straight from V1 colors, in definition order.
pub(crate) fn palette_tokens(theme: &V1) -> Value {
    let color = |key: &str| hex(theme.get(key));
    json!({
        "border": { "base": color("border") },
        "scrollbar": { "base": color("borderActive") },
        "diff": {
            "text": {
                "added": color("diffAdded"),
                "removed": color("diffRemoved"),
                "context": color("diffContext"),
                "hunkHeader": color("diffHunkHeader"),
            },
            "background": {
                "added": color("diffAddedBg"),
                "removed": color("diffRemovedBg"),
                "context": color("diffContextBg"),
            },
            "highlight": { "added": color("diffHighlightAdded"), "removed": color("diffHighlightRemoved") },
            "lineNumber": {
                "text": color("diffLineNumber"),
                "background": { "added": color("diffAddedLineNumberBg"), "removed": color("diffRemovedLineNumberBg") },
            },
        },
        "syntax": {
            "comment": color("syntaxComment"),
            "keyword": color("syntaxKeyword"),
            "function": color("syntaxFunction"),
            "variable": color("syntaxVariable"),
            "string": color("syntaxString"),
            "number": color("syntaxNumber"),
            "type": color("syntaxType"),
            "operator": color("syntaxOperator"),
            "punctuation": color("syntaxPunctuation"),
        },
        "markdown": {
            "text": color("markdownText"),
            "heading": color("markdownHeading"),
            "link": color("markdownLink"),
            "linkText": color("markdownLinkText"),
            "code": color("markdownCode"),
            "blockQuote": color("markdownBlockQuote"),
            "emphasis": color("markdownEmph"),
            "strong": color("markdownStrong"),
            "horizontalRule": color("markdownHorizontalRule"),
            "listItem": color("markdownListItem"),
            "listEnumeration": color("markdownListEnumeration"),
            "image": color("markdownImage"),
            "imageText": color("markdownImageText"),
            "codeBlock": color("markdownCodeBlock"),
        },
    })
}

/// Replaces the `@palette` placeholder with its sections, keeping the key order of the TypeScript literal.
pub(crate) fn splice_palette(definition: Value) -> Map<String, Value> {
    let Value::Object(definition) = definition else {
        return Map::new();
    };
    definition
        .into_iter()
        .flat_map(|(key, value)| match (key.as_str(), value) {
            ("@palette", Value::Object(sections)) => sections.into_iter().collect::<Vec<_>>(),
            (_, value) => vec![(key, value)],
        })
        .collect()
}

/// Dialogs float over the session, so a see-through panel would show the content underneath. Falls back to the
/// first visible surface color, made opaque.
pub(crate) fn dialog_background(theme: &V1) -> String {
    if theme.get("backgroundPanel").a == 255 {
        return "$background.raised.base".to_owned();
    }
    let visible = [
        "backgroundPanel",
        "backgroundMenu",
        "backgroundElement",
        "background",
    ]
    .iter()
    .map(|key| theme.get(key))
    .find(|color| color.a > 0);
    match visible {
        Some(color) => hex_ints(color.r, color.g, color.b, 255),
        None if luminance(theme.get("text")) > 0.5 => "#000000".to_owned(),
        None => "#ffffff".to_owned(),
    }
}

/// Rewrites colors that equal a hue step as references to that step, preferring the semantic hues.
pub(crate) fn reference_hues(theme: Map<String, Value>) -> Map<String, Value> {
    let Some(Value::Object(definitions)) = theme.get("hue") else {
        return theme;
    };
    let mut references: HashMap<String, String> = HashMap::new();
    let mut index = |name: &str, overwrite: bool| {
        let Some(scale) = alias_scale(definitions, name, &mut Vec::new()) else {
            return;
        };
        for step in STEPS {
            let Some(color) = scale.get(&step.to_string()).and_then(Value::as_str) else {
                continue;
            };
            let key = color.to_lowercase();
            if !overwrite && references.contains_key(&key) {
                continue;
            }
            references.insert(key, format!("$hue.{name}.{step}"));
        }
    };
    for name in CHROMATIC {
        index(name, false);
    }
    index("gray", false);
    for name in ["accent", "interactive", "neutral"] {
        index(name, true);
    }
    theme
        .iter()
        .map(|(key, value)| {
            let value = if key == "hue" || key == "categorical" {
                value.clone()
            } else {
                replace(value, &references)
            };
            (key.clone(), value)
        })
        .collect()
}

fn alias_scale<'a>(
    definitions: &'a Map<String, Value>,
    name: &str,
    chain: &mut Vec<String>,
) -> Option<&'a Map<String, Value>> {
    if chain.iter().any(|item| item == name) {
        return None;
    }
    match definitions.get(name).filter(|value| truthy(value))? {
        Value::String(alias) => {
            let target = alias
                .strip_prefix("$hue.")
                .filter(|target| !target.is_empty() && !target.contains('.'))?;
            chain.push(name.to_owned());
            alias_scale(definitions, target, chain)
        }
        Value::Object(scale) => Some(scale),
        _ => None,
    }
}

fn replace(value: &Value, references: &HashMap<String, String>) -> Value {
    match value {
        Value::String(text) => references
            .get(&text.to_lowercase())
            .map_or_else(|| value.clone(), |r| json!(r)),
        Value::Object(object) => Value::Object(
            object
                .iter()
                .map(|(key, item)| (key.clone(), replace(item, references)))
                .collect(),
        ),
        _ => value.clone(),
    }
}

/// The chromatic hues a V1 theme's accent colors fall into.
pub(crate) struct Hues {
    by_hue: Vec<(&'static str, Color, f64)>,
    by_token: Vec<(&'static str, &'static str)>,
}

impl Hues {
    fn token(&self, token: &str) -> Option<&'static str> {
        self.by_token
            .iter()
            .find(|(name, _)| *name == token)
            .map(|(_, hue)| *hue)
    }

    /// The matched hues in chromatic order, each with the color nearest to its reference angle.
    pub fn chromatic(&self) -> Vec<(&'static str, Color)> {
        CHROMATIC
            .iter()
            .filter_map(|name| {
                self.by_hue
                    .iter()
                    .find(|(hue, _, _)| hue == name)
                    .map(|(hue, color, _)| (*hue, *color))
            })
            .collect()
    }

    pub fn alias(&self, token: &str) -> String {
        self.token(token)
            .map_or_else(|| "$hue.gray".to_owned(), |hue| format!("$hue.{hue}"))
    }

    pub fn categorical(&self) -> Vec<&'static str> {
        let mut unique: Vec<&'static str> = Vec::new();
        for hue in CATEGORICAL.iter().filter_map(|token| self.token(token)) {
            if !unique.contains(&hue) {
                unique.push(hue);
            }
        }
        if unique.is_empty() {
            vec!["neutral"]
        } else {
            unique
        }
    }

    fn set_token(&mut self, token: &'static str, hue: &'static str) {
        match self.by_token.iter_mut().find(|(name, _)| *name == token) {
            Some(entry) => entry.1 = hue,
            None => self.by_token.push((token, hue)),
        }
    }

    fn set_hue(&mut self, hue: &'static str, color: Color, distance: f64) {
        match self.by_hue.iter_mut().find(|(name, _, _)| *name == hue) {
            Some(entry) => *entry = (hue, color, distance),
            None => self.by_hue.push((hue, color, distance)),
        }
    }
}

pub(crate) fn infer_hues(theme: &V1) -> Hues {
    let mut hues = Hues {
        by_hue: Vec::new(),
        by_token: Vec::new(),
    };
    for token in [
        "accent",
        "success",
        "warning",
        "primary",
        "error",
        "info",
        "secondary",
    ] {
        let color = theme.get(token);
        let Some((name, distance)) = infer_hue(color) else {
            continue;
        };
        let current = hues.by_hue.iter().find(|(hue, _, _)| *hue == name);
        if !current.is_some_and(|(_, _, current)| *current <= distance) {
            hues.set_hue(name, color, distance);
        }
        hues.set_token(token, name);
    }
    // Accent and primary always own the hue they fall into.
    for token in ["accent", "primary"] {
        let color = theme.get(token);
        let Some((name, distance)) = infer_hue(color) else {
            continue;
        };
        hues.set_hue(name, color, distance);
        hues.set_token(token, name);
    }
    hues
}

fn infer_hue(color: Color) -> Option<(&'static str, f64)> {
    let value = to_oklch(color);
    if color.a == 0 || value.c < 0.03 {
        return None;
    }
    let references: [&str; 7] = if value.l >= 0.6 {
        [
            "#fca5a5", "#fdba74", "#fde047", "#86efac", "#67e8f9", "#93c5fd", "#d8b4fe",
        ]
    } else {
        [
            "#b91c1c", "#c2410c", "#a16207", "#15803d", "#0e7490", "#1d4ed8", "#7e22ce",
        ]
    };
    let mut best: Option<(&'static str, f64)> = None;
    for (name, reference) in CHROMATIC.iter().zip(references) {
        let difference = (value.h - to_oklch(from_hex(reference)).h).abs();
        let distance = difference.min(360.0 - difference);
        if best.is_none_or(|(_, current)| distance < current) {
            best = Some((name, distance));
        }
    }
    best
}

pub(crate) fn selected_foreground(theme: &V1, background: Color) -> Color {
    if theme.has_selected_list_item_text {
        return theme.get("selectedListItemText");
    }
    if theme.get("background").a != 0 {
        return theme.get("background");
    }
    if luminance(background) > 0.5 {
        Color::rgb(0, 0, 0)
    } else {
        Color::rgb(255, 255, 255)
    }
}

fn hue_scale(color: Color, mode: ThemeMode) -> Vec<String> {
    let value = to_oklch(color);
    let endpoint = if mode == ThemeMode::Light {
        value.l.max(0.97)
    } else {
        value.l.min(0.18)
    };
    STEPS
        .iter()
        .map(|step| {
            if *step == 200 {
                return hex(color);
            }
            let progress = (f64::from(*step) - 200.0) / 700.0;
            let generated = oklch_to_hex(super::color::Oklch {
                l: value.l + (endpoint - value.l) * progress,
                c: value.c * (1.0 - progress * 0.5),
                h: value.h,
            });
            with_alpha(generated, color.a)
        })
        .collect()
}

fn neutral_scale(theme: &V1) -> Vec<String> {
    let anchors: [(u16, Color); 5] = [
        (200, theme.get("text")),
        (400, theme.get("textMuted")),
        (600, theme.get("backgroundElement")),
        (700, theme.get("backgroundPanel")),
        (800, theme.get("background")),
    ];
    STEPS
        .iter()
        .map(|step| {
            if let Some((_, color)) = anchors.iter().find(|(anchor, _)| anchor == step) {
                return hex(*color);
            }
            let (lower, upper) = if *step < anchors[0].0 {
                (anchors[0], anchors[1])
            } else if *step > anchors[4].0 {
                (anchors[3], anchors[4])
            } else {
                let lower = anchors
                    .iter()
                    .rev()
                    .find(|(anchor, _)| anchor < step)
                    .copied()
                    .unwrap_or(anchors[0]);
                let upper = anchors
                    .iter()
                    .find(|(anchor, _)| anchor > step)
                    .copied()
                    .unwrap_or(anchors[4]);
                (lower, upper)
            };
            let amount =
                (f64::from(*step) - f64::from(lower.0)) / (f64::from(upper.0) - f64::from(lower.0));
            interpolate(lower.1, upper.1, amount)
        })
        .collect()
}

fn interpolate(first: Color, second: Color, amount: f64) -> String {
    let (start, end) = (to_oklch(first), to_oklch(second));
    let hue = (((end.h - start.h) % 360.0 + 540.0) % 360.0) - 180.0;
    let generated = oklch_to_hex(super::color::Oklch {
        l: start.l + (end.l - start.l) * amount,
        c: start.c + (end.c - start.c) * amount,
        h: start.h + hue * amount,
    });
    let alpha = (f64::from(first.a) + (f64::from(second.a) - f64::from(first.a)) * amount + 0.5)
        .floor()
        .clamp(0.0, 255.0);
    with_alpha(generated, alpha as u8)
}

pub(crate) fn with_alpha(generated: String, alpha: u8) -> String {
    if alpha == 255 {
        generated
    } else {
        format!("{generated}{alpha:02x}")
    }
}

pub(crate) fn scale_value(scale: &[String]) -> Value {
    Value::Object(
        STEPS
            .iter()
            .zip(scale)
            .map(|(step, color)| (step.to_string(), json!(color)))
            .collect(),
    )
}
