//! How long a test waits for a condition, shared by the test binaries.

use std::time::Duration;

/// The ceiling for [`opentui::testing::TestApp::wait_until`]. A wait returns as soon as its condition
/// holds, so this only bounds a failing test; it is long because a loaded machine (other builds and test
/// runs on it) can take seconds to deliver a fixture response or a file write.
pub const WAIT: Duration = Duration::from_secs(30);
