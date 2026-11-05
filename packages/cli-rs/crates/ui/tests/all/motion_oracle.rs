//! U.6 P-ORACLE for the pure motion functions: `parity/oracle/U.6-motion.ts` evaluates the TypeScript
//! `oneCellFrame`, `octantGlyph`, and `createFrames`, and this test compares the Rust ports on the same inputs.

use opencode_parity::fixtures_dir;
use opencode_ui::motion::{
    OneCellMotion, ScannerOptions, ScannerStyle, WORK_SPINNER_NAMES, octant_glyph, one_cell_frame, scanner_frames,
    seed_launch, seed_mono, work_spinner,
};
use opentui::style::Color;
use serde::Deserialize;
use std::collections::BTreeMap;

#[derive(Deserialize)]
struct Functions {
    instants: Vec<f64>,
    motions: BTreeMap<String, Vec<(String, String, bool)>>,
    octants: Vec<String>,
    scanner: BTreeMap<String, Vec<String>>,
}

fn load() -> Functions {
    serde_json::from_str(&std::fs::read_to_string(fixtures_dir().join("U.6/functions.json")).unwrap()).unwrap()
}

#[test]
fn one_cell_frames_match_the_typescript_motions() {
    let functions = load();
    let motions: Vec<(String, OneCellMotion)> = WORK_SPINNER_NAMES
        .iter()
        .map(|name| (name.to_string(), work_spinner(name).unwrap()))
        .chain([("seed-launch".to_owned(), seed_launch()), ("seed-mono".to_owned(), seed_mono())])
        .collect();
    assert_eq!(
        motions.iter().map(|(name, _)| name).collect::<std::collections::BTreeSet<_>>(),
        functions.motions.keys().collect(),
        "the work spinner table"
    );
    for (name, motion) in &motions {
        for (instant, expected) in functions.instants.iter().zip(&functions.motions[name]) {
            let frame = one_cell_frame(motion, *instant);
            assert_eq!(
                (&frame.glyph, frame.level, frame.complete),
                (&expected.0, expected.1.parse::<f64>().unwrap(), expected.2),
                "{name} at {instant} ms"
            );
        }
    }
}

#[test]
fn octant_glyphs_match_for_every_mask() {
    let functions = load();
    for (mask, expected) in functions.octants.iter().enumerate() {
        assert_eq!(octant_glyph(mask as u8).to_string(), *expected, "mask {mask:#04x}");
    }
}

#[test]
fn scanner_frames_match_create_frames() {
    let functions = load();
    let accent = Color::hex(0xfab283);
    let blocks = ScannerOptions {
        style: ScannerStyle::Blocks,
        inactive_factor: 0.6,
        min_alpha: 0.3,
        ..ScannerOptions::new(accent)
    };
    assert_eq!(scanner_frames(&ScannerOptions::new(accent)), functions.scanner["diamonds"]);
    assert_eq!(scanner_frames(&blocks), functions.scanner["blocks"]);
}
