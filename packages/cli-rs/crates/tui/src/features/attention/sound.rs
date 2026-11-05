//! Sounds (E.19b, row N02): `attention.ts:36-43,77-121` and `audio.ts`. A request's sound name picks the
//! `attention.sounds` override, then the bundled sound (`attention-sounds.bun.ts`); the first that loads and plays wins.
//! The volume is the request's, else `attention.volume`, clamped to 0..1.
//!
//! The engine (OpenTUI's native audio) starts on the first sound. Only the real terminal app opens a playback device
//! ([`Output::Device`]); every other app, tests included, mixes without one, so nothing plays out loud and
//! [`Player::audio`] can read what would have.

use std::cell::{Cell, OnceCell, RefCell};
use std::collections::HashMap;

use opencode_local::cli_config::{AttentionSoundName, AttentionSounds};
use opentui::audio::{Audio, Sound};
use opentui::native::Context;

/// The bundled sounds, from `packages/ui/src/assets/audio`.
const BUNDLED: [(&str, &[u8]); 5] = [
    ("bip-bop-01.mp3", include_bytes!("../../../../../../ui/src/assets/audio/bip-bop-01.mp3")),
    ("bip-bop-03.mp3", include_bytes!("../../../../../../ui/src/assets/audio/bip-bop-03.mp3")),
    ("staplebops-06.mp3", include_bytes!("../../../../../../ui/src/assets/audio/staplebops-06.mp3")),
    ("nope-03.mp3", include_bytes!("../../../../../../ui/src/assets/audio/nope-03.mp3")),
    ("yup-01.mp3", include_bytes!("../../../../../../ui/src/assets/audio/yup-01.mp3")),
];

/// `BUILTIN_SOUNDS`: the bundled file each sound name plays.
pub fn bundled(name: AttentionSoundName) -> &'static str {
    match name {
        AttentionSoundName::Default | AttentionSoundName::Done => "bip-bop-01.mp3",
        AttentionSoundName::Question => "bip-bop-03.mp3",
        AttentionSoundName::Permission => "staplebops-06.mp3",
        AttentionSoundName::Error => "nope-03.mp3",
        AttentionSoundName::SubagentDone => "yup-01.mp3",
    }
}

/// Where a sound's bytes come from.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum Source {
    /// A file from `attention.sounds`.
    File(String),
    /// A bundled sound, by file name.
    Bundled(&'static str),
}

/// `soundCandidates`: the override, then the bundled sound.
pub fn candidates(name: AttentionSoundName, overrides: &AttentionSounds) -> Vec<Source> {
    let file = match name {
        AttentionSoundName::Default => &overrides.default,
        AttentionSoundName::Question => &overrides.question,
        AttentionSoundName::Permission => &overrides.permission,
        AttentionSoundName::Error => &overrides.error,
        AttentionSoundName::Done => &overrides.done,
        AttentionSoundName::SubagentDone => &overrides.subagent_done,
    };
    file.iter().map(|file| Source::File(file.clone())).chain([Source::Bundled(bundled(name))]).collect()
}

/// `clampVolume`: 0 to 1, and 0 for a value that is not finite.
pub fn clamp_volume(volume: f64) -> f32 {
    if volume.is_finite() { volume.clamp(0.0, 1.0) as f32 } else { 0.0 }
}

/// Where the engine's mix goes.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Output {
    /// The default playback device.
    Device,
    /// Nowhere until [`Audio::mix`] reads it.
    #[default]
    Mix,
}

/// The TUI's audio engine and the sounds it loaded (`audio.ts`).
#[derive(Default)]
pub struct Player {
    output: Cell<Output>,
    /// `None` inside once the engine failed to start.
    audio: OnceCell<Option<Audio>>,
    /// Each source is read and decoded once; `None` when that failed.
    sounds: RefCell<HashMap<Source, Option<Sound>>>,
}

impl Player {
    /// Chooses where sounds go. Call it before the first sound.
    pub fn set_output(&self, output: Output) {
        self.output.set(output);
    }

    /// The engine, once a sound created it.
    pub fn audio(&self) -> Option<&Audio> {
        self.audio.get().and_then(Option::as_ref)
    }

    /// `playSound`: plays the first candidate that loads and starts. Returns whether one plays.
    pub fn play(&self, context: &Context, name: AttentionSoundName, overrides: &AttentionSounds, volume: f32) -> bool {
        let Some(audio) = self.engine(context) else { return false };
        candidates(name, overrides).into_iter().any(|source| {
            let Some(sound) = self.load(audio, source) else { return false };
            let started = match self.output.get() {
                Output::Device => audio.start(),
                Output::Mix => audio.start_without_device(),
            };
            started
                .and_then(|()| audio.play(sound, volume))
                .inspect_err(|error| log::debug!("failed to play attention sound: {error}"))
                .is_ok()
        })
    }

    fn engine(&self, context: &Context) -> Option<&Audio> {
        self.audio
            .get_or_init(|| {
                Audio::new(context).inspect_err(|error| log::debug!("failed to create tui audio: {error}")).ok()
            })
            .as_ref()
    }

    fn load(&self, audio: &Audio, source: Source) -> Option<Sound> {
        if let Some(sound) = self.sounds.borrow().get(&source) {
            return *sound;
        }
        let bytes = match &source {
            Source::File(path) => std::fs::read(path).map_err(|error| error.to_string()),
            Source::Bundled(file) => {
                Ok(BUNDLED.iter().find(|(name, _)| name == file).map_or_else(Vec::new, |(_, bytes)| bytes.to_vec()))
            }
        };
        let sound = bytes
            .and_then(|bytes| audio.load(&bytes).map_err(|error| error.to_string()))
            .inspect_err(|error| log::debug!("failed to load tui sound {source:?}: {error}"))
            .ok();
        self.sounds.borrow_mut().insert(source, sound);
        sound
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use opentui::native::ContextOptions;

    /// The loudest sample of the next `frames` stereo frames of the mix.
    fn peak(audio: &Audio, frames: usize) -> f32 {
        let mut samples = vec![0.0; frames * 2];
        audio.mix(&mut samples, 2).unwrap();
        samples.iter().fold(0.0, |peak: f32, sample| peak.max(sample.abs()))
    }

    #[test]
    fn each_name_plays_its_bundled_sound_unless_overridden() {
        let table = [
            (AttentionSoundName::Default, "bip-bop-01.mp3"),
            (AttentionSoundName::Question, "bip-bop-03.mp3"),
            (AttentionSoundName::Permission, "staplebops-06.mp3"),
            (AttentionSoundName::Error, "nope-03.mp3"),
            (AttentionSoundName::Done, "bip-bop-01.mp3"),
            (AttentionSoundName::SubagentDone, "yup-01.mp3"),
        ];
        let none = AttentionSounds::default();
        for (name, file) in table {
            assert_eq!(candidates(name, &none), [Source::Bundled(file)], "{name:?}");
        }
        let overrides = AttentionSounds { error: Some("/sounds/oops.wav".into()), ..Default::default() };
        assert_eq!(
            candidates(AttentionSoundName::Error, &overrides),
            [Source::File("/sounds/oops.wav".into()), Source::Bundled("nope-03.mp3")]
        );
        assert_eq!(candidates(AttentionSoundName::Done, &overrides), [Source::Bundled("bip-bop-01.mp3")]);
    }

    #[test]
    fn volumes_clamp_to_the_unit_range() {
        for (volume, expected) in [(0.4, 0.4), (-1.0, 0.0), (3.0, 1.0), (f64::NAN, 0.0), (f64::INFINITY, 0.0)] {
            assert_eq!(clamp_volume(volume), expected, "{volume}");
        }
    }

    #[test]
    fn every_bundled_sound_decodes_and_reaches_the_engine() {
        let context = Context::new(ContextOptions::default()).unwrap();
        let player = Player::default();
        let none = AttentionSounds::default();
        for (file, _) in BUNDLED {
            let name = [
                AttentionSoundName::Default,
                AttentionSoundName::Question,
                AttentionSoundName::Permission,
                AttentionSoundName::Error,
                AttentionSoundName::SubagentDone,
            ]
            .into_iter()
            .find(|name| bundled(*name) == file)
            .unwrap();
            assert!(player.play(&context, name, &none, 0.4), "{file}");
            assert!(peak(player.audio().unwrap(), 48_000) > 0.01, "{file} is audible in the mix");
            assert_eq!(peak(player.audio().unwrap(), 48_000), 0.0, "{file} has ended");
        }
        assert_eq!(player.sounds.borrow().len(), BUNDLED.len(), "each sound decoded once");
        assert!(player.play(&context, AttentionSoundName::Done, &none, 0.4));
        assert_eq!(player.sounds.borrow().len(), BUNDLED.len(), "done reuses the default sound");
    }

    #[test]
    fn a_broken_override_falls_back_and_silence_still_plays() {
        let context = Context::new(ContextOptions::default()).unwrap();
        let player = Player::default();
        let overrides = AttentionSounds { question: Some("/nonexistent/sound.mp3".into()), ..Default::default() };
        assert!(player.play(&context, AttentionSoundName::Question, &overrides, 0.4));
        assert!(peak(player.audio().unwrap(), 48_000) > 0.01);
        assert_eq!(player.sounds.borrow().get(&Source::File("/nonexistent/sound.mp3".into())), Some(&None));
        assert!(player.play(&context, AttentionSoundName::Question, &overrides, 0.0), "volume 0 still plays");
        assert_eq!(peak(player.audio().unwrap(), 48_000), 0.0);
    }
}
