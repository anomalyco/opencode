//! OpenCode widgets on iOS and Android: the one native library each app ships (`libwidget_mobile`), with UniFFI
//! bindings for psychoscript-mobile's API (Swift module `PsychoScript`, Kotlin package `com.anomalyco.psychoscript`)
//! and the widget parts (the same Swift module; Kotlin package `ai.opencode.widgets`):
//!
//! - [`widget_encoder`]: the [`ValueEncoder`](psychoscript_mobile::ValueEncoder) for OpenCode widgets' binary format
//!   (`widget-wire`), steps and live runs; a live widget run's GPU canvases replay on psychoscript-mobile's
//!   `gpu::LiveGpu` and present into the app's surfaces.
//! - [`ShaderCanvas`]: the `wgsl` shorthand (`widget_wire::shorthand`), drawn on psychoscript-mobile's device and
//!   presented into a surface.
//!
//! One library, so a frame's delivery and a batch's replay stay in one binary. `README.md` covers packaging.

mod encoder;
#[cfg(feature = "test-hooks")]
mod hooks;
mod shader;

pub use encoder::widget_encoder;
/// Rust only, for tests (feature `test-hooks`, never in a release build).
#[cfg(feature = "test-hooks")]
pub use hooks::gpu_record_batches;
pub use shader::ShaderCanvas;

uniffi::setup_scaffolding!("widget_mobile");
