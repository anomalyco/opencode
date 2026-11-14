//! Proves the static native library links and runs: a headless app renders through OpenTUI.

use opentui::prelude::*;
use opentui::testing::TestApp;

#[test]
fn renders_through_the_native_library() {
    let app = TestApp::new(12, 1);
    app.root().add(&Text::new(&app, "opencode-rs"));
    assert_eq!(app.render().row(0).trim_end(), "opencode-rs");
}
