//! P-ORACLE for U.1: resolves the inputs of `parity/oracle/U.1-themes.ts` in Rust and compares every token with the
//! TypeScript resolver's, from `parity/fixtures/U.1/tokens.json`. Regenerate it with `bun run fixtures`.

use indexmap::IndexMap;
use opencode_ui::theme::{
    Catalog, TerminalColors, Theme, ThemeMode, generate_system, terminal_mode,
};
use opentui::style::Color;
use serde_json::Value;

const FIXTURE: &str = include_str!("../../../parity/fixtures/U.1/tokens.json");
const ASSETS: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../tui/src/theme/assets");

fn fixture() -> Value {
    serde_json::from_str(FIXTURE).unwrap()
}

fn pack(color: Color) -> String {
    format!(
        "{:02x}{:02x}{:02x}{:02x}",
        color.r, color.g, color.b, color.a
    )
}

fn unpack(packed: &str) -> Vec<&str> {
    (0..packed.len() / 8)
        .map(|index| &packed[index * 8..index * 8 + 8])
        .collect()
}

fn mode(name: &str) -> ThemeMode {
    if name == "light" {
        ThemeMode::Light
    } else {
        ThemeMode::Dark
    }
}

fn mode_name(mode: ThemeMode) -> &'static str {
    if mode == ThemeMode::Light {
        "light"
    } else {
        "dark"
    }
}

/// Every difference between a Rust view and its TypeScript entry, named by path.
fn compare(
    key: &str,
    modes: &[ThemeMode],
    theme: &Theme,
    expected: &Value,
    paths: &[String],
) -> Vec<String> {
    let mut failures = Vec::new();
    let modes: Vec<_> = modes.iter().map(|mode| mode_name(*mode)).collect();
    let expected_modes: Vec<_> = expected["modes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m.as_str().unwrap())
        .collect();
    if modes != expected_modes {
        failures.push(format!(
            "{key}: modes {modes:?}, expected {expected_modes:?}"
        ));
    }
    let hues: Vec<_> = theme.hues().iter().map(|(name, _)| name.as_str()).collect();
    let expected_hues: Vec<_> = expected["hues"]
        .as_array()
        .unwrap()
        .iter()
        .map(|h| h.as_str().unwrap())
        .collect();
    if hues != expected_hues {
        failures.push(format!("{key}: hues {hues:?}, expected {expected_hues:?}"));
    }
    let mut check = |what: &str, names: Vec<String>, actual: Vec<Color>| {
        let wanted = unpack(expected[what].as_str().unwrap());
        if wanted.len() != actual.len() {
            failures.push(format!(
                "{key}: {what} has {} colors, expected {}",
                actual.len(),
                wanted.len()
            ));
            return;
        }
        for ((name, actual), wanted) in names.iter().zip(actual).zip(wanted) {
            if pack(actual) != wanted {
                failures.push(format!(
                    "{key}: {what} {name} is {}, expected {wanted}",
                    pack(actual)
                ));
            }
        }
    };
    let steps = |name: &str| {
        (1..=9)
            .map(|step| format!("{name}.{}", step * 100))
            .collect::<Vec<_>>()
    };
    let hue_names = theme
        .hues()
        .iter()
        .flat_map(|(name, _)| steps(name))
        .collect();
    check(
        "hue",
        hue_names,
        theme.hues().iter().flat_map(|(_, scale)| scale.0).collect(),
    );
    let categorical = (0..theme.categorical().len())
        .flat_map(|index| steps(&index.to_string()))
        .collect();
    check(
        "categorical",
        categorical,
        theme
            .categorical()
            .iter()
            .flat_map(|scale| scale.0)
            .collect(),
    );
    let sorted = |view: &Theme| {
        let list: IndexMap<String, Color> = view.list().into_iter().collect();
        paths
            .iter()
            .map(|path| list.get(path).copied().unwrap_or(Color::rgba(1, 2, 3, 4)))
            .collect::<Vec<_>>()
    };
    check("base", paths.to_vec(), sorted(theme));
    check(
        "dialog",
        paths.to_vec(),
        sorted(&theme.surface(opencode_ui::theme::Surface::Dialog)),
    );
    check(
        "footer",
        paths.to_vec(),
        sorted(&theme.surface(opencode_ui::theme::Surface::DialogFooter)),
    );
    // Shifts take references into the theme, as TypeScript matches colors by identity.
    let token = |path: &String| theme.get(path).unwrap_or(&Color::TRANSPARENT);
    check(
        "decrease",
        paths.to_vec(),
        paths
            .iter()
            .map(|path| theme.decrease(token(path), 1))
            .collect(),
    );
    check(
        "increase",
        paths.to_vec(),
        paths
            .iter()
            .map(|path| theme.increase(token(path), 2))
            .collect(),
    );
    failures
}

fn paths(fixture: &Value) -> Vec<String> {
    fixture["paths"]
        .as_array()
        .unwrap()
        .iter()
        .map(|path| path.as_str().unwrap().to_owned())
        .collect()
}

fn report(failures: Vec<String>, checked: usize) {
    assert!(checked > 0, "nothing checked");
    let shown: Vec<_> = failures.iter().take(40).cloned().collect();
    assert!(
        failures.is_empty(),
        "{} mismatches over {checked} views:\n{}",
        failures.len(),
        shown.join("\n")
    );
}

#[test]
fn builtin_themes_match_the_typescript_resolver() {
    let fixture = fixture();
    let paths = paths(&fixture);
    let catalog = Catalog::default();
    let mut failures = Vec::new();
    let builtins = fixture["builtins"].as_object().unwrap();
    for (key, expected) in builtins {
        let [variant, name, requested] = key.splitn(3, '/').collect::<Vec<_>>()[..] else {
            panic!("{key}")
        };
        let loaded = catalog
            .load(name, mode(requested), variant == "newDesigns")
            .unwrap();
        assert_eq!(mode_name(loaded.mode), requested, "{key}");
        failures.extend(compare(key, &loaded.modes, &loaded.theme, expected, &paths));
    }
    report(failures, builtins.len());
}

/// The raw V1 assets, migrated in Rust as custom themes, give the same tokens as the TypeScript migration.
#[test]
fn v1_migration_matches_the_typescript_migration() {
    let fixture = fixture();
    let paths = paths(&fixture);
    let mut failures = Vec::new();
    let mut checked = 0;
    for (key, expected) in fixture["builtins"].as_object().unwrap() {
        let [variant, name, requested] = key.splitn(3, '/').collect::<Vec<_>>()[..] else {
            panic!("{key}")
        };
        // The built-in opencode theme is the V2 document; assets/opencode.json is an unused V1 copy.
        if name == "opencode" {
            continue;
        }
        let Ok(raw) = std::fs::read_to_string(format!("{ASSETS}/{name}.json")) else {
            continue;
        };
        let mut catalog = Catalog::default();
        catalog.set_custom(IndexMap::from([(
            name.to_owned(),
            serde_json::from_str(&raw).unwrap(),
        )]));
        let loaded = catalog
            .load(name, mode(requested), variant == "newDesigns")
            .unwrap();
        failures.extend(compare(
            &format!("migrated {key}"),
            &loaded.modes,
            &loaded.theme,
            expected,
            &paths,
        ));
        checked += 1;
    }
    report(failures, checked);
}

#[test]
fn system_theme_matches_the_typescript_generator() {
    let fixture = fixture();
    let paths = paths(&fixture);
    let mut failures = Vec::new();
    let system = fixture["system"].as_object().unwrap();
    for (key, expected) in system {
        let [variant, palette, requested] = key.splitn(3, '/').collect::<Vec<_>>()[..] else {
            panic!("{key}")
        };
        let colors: TerminalColors =
            serde_json::from_value(fixture["palettes"][palette].clone()).unwrap();
        let terminal = terminal_mode(&colors).map(mode_name);
        assert_eq!(
            terminal,
            expected["terminal"].as_str(),
            "{key}: terminal mode"
        );
        let mut catalog = Catalog::default();
        catalog.set_system(Some(generate_system(&colors, mode(requested))));
        let loaded = catalog
            .load("system", mode(requested), variant == "newDesigns")
            .unwrap();
        failures.extend(compare(key, &loaded.modes, &loaded.theme, expected, &paths));
    }
    report(failures, system.len());
}

#[test]
fn broken_custom_themes_fail_with_the_typescript_message() {
    let fixture = fixture();
    let errors = fixture["errors"].as_object().unwrap();
    let mut failures = Vec::new();
    for (name, case) in errors {
        let mut catalog = Catalog::default();
        catalog.set_custom(IndexMap::from([(name.clone(), case["source"].clone())]));
        let message = [ThemeMode::Dark, ThemeMode::Light]
            .iter()
            .find_map(|mode| catalog.load(name, *mode, false).err());
        if message.as_deref() != case["message"].as_str() {
            failures.push(format!(
                "{name}: {message:?}, expected {:?}",
                case["message"]
            ));
        }
    }
    report(failures, errors.len());
}
