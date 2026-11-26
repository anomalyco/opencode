//! Rust-only hooks for tests (feature `test-hooks`, never in a release build).

use std::sync::atomic::{AtomicBool, Ordering};

/// Has widget runs started from now on keep the GPU batches their programs post (for the conformance fixtures'
/// `batches`: psychoscript-mobile's `LiveRun::gpu_posted`).
pub fn gpu_record_batches() {
    RECORD.store(true, Ordering::SeqCst);
}

pub(crate) static RECORD: AtomicBool = AtomicBool::new(false);
