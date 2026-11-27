//! The wheel's rows per step (`scroll.speed`), as TS's `getScrollAcceleration`.

use std::cell::Cell;
use std::rc::Rc;
use std::time::Instant;

use opentui::widget::{MacOsScroll, ScrollAcceleration, ScrollBox};

/// TS `ScrollConfig`: `scroll.speed` in rows a wheel step moves, and `scroll.acceleration`, which overrides it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Config {
    pub speed: f64,
    pub acceleration: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self { speed: 3.0, acceleration: false }
    }
}

/// Configures `scroll` from `config`, for a box that reads it once.
pub fn apply(scroll: &ScrollBox, config: Config) {
    if config.acceleration {
        scroll.scroll_acceleration(MacOsScroll::default());
    } else {
        scroll.scroll_acceleration(Speed(config.speed));
    }
}

/// One config shared by a host's scroll areas: a change reaches the wheel steps of boxes already made, as TS's
/// reactive `scrollAcceleration` does.
#[derive(Clone)]
pub struct Live {
    config: Rc<Cell<Config>>,
    macos: MacOsScroll,
}

impl Live {
    pub fn new(config: Config) -> Self {
        Self { config: Rc::new(Cell::new(config)), macos: MacOsScroll::default() }
    }

    pub fn set(&self, config: Config) {
        self.config.set(config);
    }

    /// Makes `scroll` follow this config.
    pub fn apply(&self, scroll: &ScrollBox) {
        scroll.scroll_acceleration(self.clone());
    }
}

impl ScrollAcceleration for Live {
    fn tick(&mut self, now: Instant) -> f64 {
        let config = self.config.get();
        if config.acceleration { self.macos.tick(now) } else { config.speed }
    }

    fn reset(&mut self) {
        self.macos.reset();
    }
}

/// TS `CustomSpeedScroll`.
struct Speed(f64);

impl ScrollAcceleration for Speed {
    fn tick(&mut self, _now: Instant) -> f64 {
        self.0
    }

    fn reset(&mut self) {}
}
