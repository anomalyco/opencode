# N02: where attention sounds go outside the terminal TUI

TypeScript: `audio.ts` creates one Core `Audio` engine on the first sound and starts the default playback device
for every renderer the TUI runs on.

Rust: `features/attention/sound.rs` creates one opentui-rust `audio::Audio` engine on the first sound. Only
`opencode_tui::run` on the real terminal sets `Output::Device`, which opens the default playback device. Any other
app (the drive endpoint's headless app, tests) mixes without a device: the sound is decoded and handed to the
engine, the request reports `sound: true`, and nothing plays out loud. `Player::audio` reads that mix.

Reason: tests and harnesses run many TUIs at once on a machine with speakers. A sound from each would be noise, and
a missing device would make results depend on the machine. Event-to-sound selection, the volume, the override
fallback and the outcome are the same as in TypeScript.
