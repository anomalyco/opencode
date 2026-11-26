//! OpenCode widgets' binary wire format, version 1 (opencode `specs/v2/widgets-binary.md`): what a mobile host
//! writes instead of JSON for step outputs and live posts, and reads back.
//!
//! - [`encode_output`] and [`encode_post`] write a message straight from the VM's value (the [`HostValue`] a host
//!   function receives), applying the client rules the format bakes in (draw commands validated and colors resolved,
//!   children flattened, props of the wrong shape left out). An [`EncodeError`] is an invalid output or post: a
//!   program error, its kind naming the phase (`InvalidView`, `InvalidDraw`, `InvalidGpu`).
//! - [`decode_output`] and [`decode_post`] read it back into Rune's types ([`Node`], [`Command`], [`StepOutput`]),
//!   every read bounds-checked. The same types read the JSON form ([`StepOutput::from_value`],
//!   [`DrawOutput::from_value`], [`Node::from_value`]), so both paths can be compared.
//!
//! - [`shorthand`] is the `wgsl` canvas (`widgets.md`, GPU canvases) on psychoscript-gpu, as every native host draws
//!   it.
//!
//! widget-mobile links it as its widget encoder; the crate itself knows nothing of psychoscript-mobile. GPU batches
//! are psychoscript-gpu's format ([`Arg`], [`Batch`]).

mod decode;
pub mod draw;
mod encode;
mod gpu;
mod json;
mod native;
pub mod node;
mod schema;
pub mod shorthand;
pub mod step;

pub use decode::{DecodeError, Output, Post, decode_output, decode_post};
pub use draw::{Command, DrawOutput};
pub use encode::{
    BURST, CallError, DRAW_KEY, EncodeError, GpuHost, INVALID_DATA, INVALID_DRAW, INVALID_GPU,
    INVALID_VIEW, LivePosts, NativeStep, POSTS_PER_SECOND, encode_output, encode_post,
};
pub use gpu::{Arg, Batch};
pub use native::{Canvas, DEEP, Found, KEY, LEVELS};
pub use node::Node;
pub use psychoscript::HostValue;
pub use schema::{MAX_ARG_DEPTH, MAX_DEPTH, MAX_GPU_BYTES, MAX_GPU_OPS};
pub use step::StepOutput;

/// The format's version: every message's first byte.
pub const VERSION: u8 = 1;

/// The host global a step hands its view to: a native host runs `<program>` + [`STEP`] with `__input` and it.
pub const EMIT: &str = "__widget_emit";
/// What a native host appends to a program to run a step (`init`, `event`, `draw`), and a live run.
pub const STEP: &str = "\nreturn __widget_native_step(__input())";
pub const LIVE: &str = "\nreturn await __widget_live(__input(), true)";

/// The boundary value depth a native host runs with (`widgets.md`, Native hosts): the deepest value of a view of
/// [`LEVELS`] levels, 1 + 2 × 99 + 3.
pub const MAX_VALUE_DEPTH: usize = 202;

/// The prelude<->host contract this host implements (`widgets.md`, Protocol).
pub const PROTOCOL: u32 = 2;
/// A program built for an older protocol: a program error in the phase of the step or run refused.
pub const OLDER: &str =
    "This widget was built with an older widget runtime; ask the agent to post it again";
/// A program built for a newer protocol: a client error, not reported.
pub const NEWER: &str = "This widget needs a newer version of this app";

/// The protocol a program was built for: its first line's `const __widget_protocol = <n>`, else 1.
pub fn protocol(program: &str) -> u32 {
    let line = program.split('\n').next().unwrap_or("");
    line.strip_prefix("const __widget_protocol = ")
        .filter(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
        .map_or(1, |n| n.parse().unwrap_or(u32::MAX))
}
