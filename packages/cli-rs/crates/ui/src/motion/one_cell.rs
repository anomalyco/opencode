//! One-cell spinners: `packages/tui/src/ui/one-cell-motion.ts` and the octant glyphs of `ui/subcell.ts`. Mini's
//! footer and the storybook use them; the work spinner is chosen by the `work_spinner` setting.

use std::f64::consts::PI;

/// A clip of frames at a fixed interval, with an optional brightness per frame.
#[derive(Clone, Debug, PartialEq)]
pub struct OneCellClip {
    pub frames: Vec<String>,
    /// Milliseconds per frame.
    pub interval: f64,
    pub levels: Option<Vec<f64>>,
}

/// How a sequenced motion slows down: from `initial` to `final` speed over `duration` ms, starting `after` ms.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Pace {
    pub initial: f64,
    pub r#final: f64,
    pub after: f64,
    pub duration: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct OneCellMotion {
    pub clip: OneCellClip,
    /// Played once before the loop.
    pub intro: Option<OneCellClip>,
    /// Stops on the last frame instead of looping.
    pub once: bool,
    pub pace: Option<Pace>,
}

impl OneCellMotion {
    fn new(frames: Vec<String>, interval: f64) -> Self {
        Self {
            clip: OneCellClip {
                frames,
                interval,
                levels: None,
            },
            intro: None,
            once: false,
            pace: None,
        }
    }

    /// Whether its frame depends on more than a looping frame index: an intro, a single play, or a pace.
    pub fn sequenced(&self) -> bool {
        self.intro.is_some() || self.once || self.pace.is_some()
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct OneCellFrame {
    pub glyph: String,
    /// Brightness, applied to the color's alpha.
    pub level: f64,
    /// A single-play motion reached its last frame.
    pub complete: bool,
}

/// The frame of `motion` after `elapsed` milliseconds (`oneCellFrame`).
pub fn one_cell_frame(motion: &OneCellMotion, elapsed: f64) -> OneCellFrame {
    let intro_duration = motion
        .intro
        .as_ref()
        .map_or(0.0, |intro| intro.frames.len() as f64 * intro.interval);
    let intro = elapsed < intro_duration;
    let clip = if intro {
        motion.intro.as_ref().unwrap_or(&motion.clip)
    } else {
        &motion.clip
    };
    // Integrate the changing rate so slowing down does not jump or restart the motion. JavaScript computes an
    // integer power by repeated squaring, as `powi` does; `powf` rounds differently.
    let time = match (intro, motion.pace) {
        (true, _) => elapsed,
        (false, None) => elapsed - intro_duration,
        (false, Some(pace)) => {
            let progress = ((elapsed - pace.after) / pace.duration).clamp(0.0, 1.0);
            (elapsed - intro_duration) * pace.initial
                + (pace.r#final - pace.initial)
                    * (pace.duration * (progress.powi(3) - progress.powi(4) / 2.0)
                        + 0.0f64.max(elapsed - pace.after - pace.duration))
        }
    };
    let count = clip.frames.len() as f64;
    // Keep cycle boundaries exact when individual frame intervals are fractional.
    let frame = ((time * count) / (clip.interval * count)).floor();
    let index = if !intro && motion.once {
        frame.min(count - 1.0)
    } else {
        frame.rem_euclid(count)
    } as usize;
    OneCellFrame {
        glyph: clip.frames[index].clone(),
        level: clip.levels.as_ref().map_or(1.0, |levels| levels[index]),
        complete: !intro && motion.once && frame >= count - 1.0,
    }
}

/// Masks are row-major bits in a 2x4 grid. Unicode reuses these older glyphs instead of duplicating them in the
/// otherwise mask-ordered octant block.
const OCTANTS: [(u32, char); 26] = [
    (0x00, ' '),
    (0x01, '\u{1cea8}'),
    (0x02, '\u{1ceab}'),
    (0x03, '\u{1fb82}'),
    (0x05, '\u{2598}'),
    (0x0a, '\u{259d}'),
    (0x0f, '\u{2580}'),
    (0x14, '\u{1fbe6}'),
    (0x28, '\u{1fbe7}'),
    (0x3f, '\u{1fb85}'),
    (0x40, '\u{1cea3}'),
    (0x50, '\u{2596}'),
    (0x55, '\u{258c}'),
    (0x5a, '\u{259e}'),
    (0x5f, '\u{259b}'),
    (0x80, '\u{1cea0}'),
    (0xa0, '\u{2597}'),
    (0xa5, '\u{259a}'),
    (0xaa, '\u{2590}'),
    (0xaf, '\u{259c}'),
    (0xc0, '\u{2582}'),
    (0xf0, '\u{2584}'),
    (0xf5, '\u{2599}'),
    (0xfa, '\u{259f}'),
    (0xfc, '\u{2586}'),
    (0xff, '\u{2588}'),
];

/// The octant glyph for a mask of the 2x4 cell grid (`octantGlyph`).
pub fn octant_glyph(mask: u8) -> char {
    let mask = u32::from(mask);
    if let Some(&(_, glyph)) = OCTANTS.iter().find(|(value, _)| *value == mask) {
        return glyph;
    }
    let before = OCTANTS.iter().filter(|(value, _)| *value < mask).count() as u32;
    char::from_u32(0x1cd00 + mask - before).unwrap_or(' ')
}

fn octants(masks: &[u8]) -> Vec<String> {
    masks
        .iter()
        .map(|&mask| octant_glyph(mask).to_string())
        .collect()
}

fn glyphs(text: &str) -> Vec<String> {
    text.chars().map(String::from).collect()
}

const WORK_PACE: Pace = Pace {
    initial: 1.2,
    r#final: 0.96,
    after: 30_000.0,
    duration: 30_000.0,
};
const LOWER: [u8; 6] = [2, 3, 5, 7, 6, 4];

/// The `work_spinner` setting's values (`Config.MiniWorkSpinner`), in the TypeScript table's order.
pub const WORK_SPINNER_NAMES: [&str; 14] = [
    "block-soft-slide",
    "block-soft-sweep",
    "block-low-comet",
    "block-low-duet",
    "block-shuttle",
    "block-bridge",
    "block-squeeze",
    "small-toggle",
    "square-toggle",
    "grow-shrink",
    "quadrant-orbit",
    "crosshatch",
    "density-wave",
    "seed",
];

/// A `WORK_SPINNERS` entry by name.
pub fn work_spinner(name: &str) -> Option<OneCellMotion> {
    let motion = match name {
        "block-soft-slide" => OneCellMotion {
            clip: OneCellClip {
                frames: octants(&[0x14, 0x14, 0x14, 0x14, 0x14, 0x28, 0x28, 0x28, 0x28, 0x28]),
                interval: 100.0,
                levels: Some(vec![
                    0.55, 0.85, 1.0, 0.85, 0.55, 0.55, 0.85, 1.0, 0.85, 0.55,
                ]),
            },
            ..OneCellMotion::new(Vec::new(), 0.0)
        },
        "block-soft-sweep" => OneCellMotion {
            pace: Some(WORK_PACE),
            ..OneCellMotion::new(
                octants(&[
                    0x14, 0x14, 0x14, 0x1c, 0x3c, 0x38, 0x28, 0x28, 0x28, 0x38, 0x3c, 0x1c,
                ]),
                100.0,
            )
        },
        "block-low-comet" => {
            let frames = (0..6)
                .flat_map(|index| {
                    let leading = (1u8 << LOWER[index]) | (1 << LOWER[(index + 5) % 6]);
                    let full = leading | (1 << LOWER[(index + 4) % 6]);
                    [full, full, full, leading, leading]
                })
                .collect::<Vec<_>>();
            OneCellMotion {
                pace: Some(WORK_PACE),
                ..OneCellMotion::new(octants(&frames), 40.0)
            }
        }
        "block-low-duet" => {
            let frames = (0..3)
                .flat_map(|index| {
                    let heads = (1u8 << LOWER[index]) | (1 << LOWER[(index + 3) % 6]);
                    let full =
                        heads | (1 << LOWER[(index + 2) % 6]) | (1 << LOWER[(index + 5) % 6]);
                    [full, full, full, heads]
                })
                .collect::<Vec<_>>();
            OneCellMotion::new(octants(&frames), 60.0)
        }
        "block-shuttle" => OneCellMotion::new(octants(&[0x14, 0x28]), 500.0),
        "block-bridge" => OneCellMotion::new(
            octants(&[0x14, 0x14, 0x14, 0x3c, 0x28, 0x28, 0x28, 0x3c]),
            120.0,
        ),
        "block-squeeze" => OneCellMotion::new(
            octants(&[0x14, 0x14, 0x14, 0x10, 0x20, 0x28, 0x28, 0x28, 0x20, 0x10]),
            100.0,
        ),
        "small-toggle" => OneCellMotion::new(glyphs("\u{25ab}\u{25aa}"), 320.0),
        "square-toggle" => OneCellMotion::new(glyphs("\u{25a1}\u{25a0}"), 500.0),
        "grow-shrink" => {
            OneCellMotion::new(glyphs("\u{25ab}\u{25ab}\u{25aa}\u{25a0}\u{25aa}"), 180.0)
        }
        "quadrant-orbit" => OneCellMotion::new(glyphs("\u{2598}\u{259d}\u{2597}\u{2596}"), 160.0),
        "crosshatch" => OneCellMotion::new(glyphs("\u{25a7}\u{25a9}\u{25a8}\u{25a9}"), 240.0),
        "density-wave" => OneCellMotion::new(
            glyphs("\u{2591}\u{2591}\u{2591}\u{2592}\u{2593}\u{2588}\u{2593}\u{2592}"),
            160.0,
        ),
        "seed" => seed_work(),
        _ => return None,
    };
    Some(motion)
}

fn seed_levels() -> Vec<f64> {
    (0..40)
        .map(|index| 0.3 + (0.7 * (1.0 - ((index as f64 / 40.0) * 2.0 * PI).cos())) / 2.0)
        .collect()
}

fn seed_work() -> OneCellMotion {
    let intro = (0..80)
        .map(|index| {
            let phase = index as f64 / 80.0;
            let shape = if phase < 0.125 {
                phase / 0.125
            } else if phase < 0.375 {
                1.0
            } else {
                ((1.0 - phase) / 0.625).powi(3)
            };
            0.3 + 0.7 * shape
        })
        .collect();
    OneCellMotion {
        clip: OneCellClip {
            frames: vec!["\u{25aa}".to_owned(); 40],
            interval: 40.0,
            levels: Some(seed_levels()),
        },
        intro: Some(OneCellClip {
            frames: vec!["\u{25aa}".to_owned(); 80],
            interval: 40.0,
            levels: Some(intro),
        }),
        once: false,
        pace: Some(Pace {
            initial: 1.25,
            r#final: 0.5,
            after: 30_000.0,
            duration: 30_000.0,
        }),
    }
}

/// The seed's one-time launch, `SEED_LAUNCH`.
pub fn seed_launch() -> OneCellMotion {
    let frames = (0..21)
        .map(|index| if index < 10 { "\u{25ab}" } else { "\u{25aa}" }.to_owned())
        .collect();
    OneCellMotion {
        clip: OneCellClip {
            frames,
            interval: 40.0,
            levels: Some(seed_levels()[..21].to_vec()),
        },
        intro: None,
        once: true,
        pace: None,
    }
}

/// The ASCII spinner for monochrome output, `SEED_MONO`.
pub fn seed_mono() -> OneCellMotion {
    OneCellMotion::new(glyphs("-\\|/"), 120.0)
}
