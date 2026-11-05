//! Clickable links and opening URLs and paths (E.20, row T23): `ui/link.tsx`, `@opencode/util/open`, and the
//! root `onMouseUp` of `app.tsx:1419-1423`.
//!
//! A plain left click on a cell that carries a hyperlink opens it: a press and a release on the same cell, with
//! no modifier and no selected text. TS reads that from the selection (`isStart` with `cell` behavior); here the
//! press position stands in for it. Modified clicks are left to the terminal.
//!
//! [`open_url`] and [`open_path`] start the system opener. Tests call [`testing::capture`] first, so nothing
//! opens a browser or file manager.

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use opentui::prelude::*;

use crate::app::Tui;

/// Registers the link click handler. `app::mount` calls it once.
pub fn install(tui: &Rc<Tui>) {
    let weak = tui.weak();
    let pressed = Rc::new(Cell::new(None::<(u16, u16)>));
    tui.app.on_mouse(move |_, event| {
        let Some(tui) = weak.upgrade() else { return };
        let plain = [Modifiers::CTRL, Modifiers::ALT, Modifiers::SHIFT]
            .into_iter()
            .all(|modifier| !event.modifiers.contains(modifier));
        match event.kind {
            MouseEventKind::Down(MouseButton::Left) => {
                pressed.set(plain.then_some((event.x, event.y)));
            }
            MouseEventKind::Drag(_) => pressed.set(None),
            MouseEventKind::Up(MouseButton::Left) => {
                let click = pressed.take() == Some((event.x, event.y)) && plain;
                if !click || tui.app.selected_text().is_some() {
                    return;
                }
                if let Some(url) = link_at(&tui.app, event.x, event.y)
                    && let Err(error) = open_url(&url)
                {
                    tui.toasts.error(error);
                }
            }
            _ => {}
        }
    });
}

/// The hyperlink presented at a cell (`renderer.getLinkAt`).
pub fn link_at(app: &App, x: u16, y: u16) -> Option<String> {
    let session = app.session();
    let id = session.link_id(i32::from(x), i32::from(y)).ok()??;
    session.context().link_url(id).ok()
}

/// `openUrl`: http and https links only, in the system browser.
pub fn open_url(input: &str) -> Result<(), String> {
    let url = url::Url::parse(input)
        .ok()
        .filter(|url| matches!(url.scheme(), "http" | "https"))
        .ok_or_else(|| format!("Only http and https links can be opened in the browser: {input}"))?;
    open(url.as_str())
}

/// `openPath`: a file or folder in the system's default app.
pub fn open_path(path: &str) -> Result<(), String> {
    open(path)
}

fn open(target: &str) -> Result<(), String> {
    if testing::record(target) {
        return Ok(());
    }
    let mut command = if cfg!(target_os = "macos") {
        std::process::Command::new("open")
    } else if cfg!(windows) {
        let mut command = std::process::Command::new("cmd");
        command.args(["/c", "start", ""]);
        command
    } else {
        std::process::Command::new("xdg-open")
    };
    command
        .arg(target)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map(drop)
        .map_err(|error| error.to_string())
}

/// A sink for tests: while a [`Capture`] lives on the UI thread, opens and copies are recorded instead of
/// reaching the system, and clipboard reads take the queued `clipboard` outcomes (`Empty` once none are left).
#[doc(hidden)]
pub mod testing {
    use super::*;

    thread_local! {
        static SINK: RefCell<Option<Rc<Sink>>> = const { RefCell::new(None) };
    }

    #[derive(Default)]
    pub struct Sink {
        pub opened: RefCell<Vec<String>>,
        pub copied: RefCell<Vec<String>>,
        pub clipboard: RefCell<std::collections::VecDeque<opentui::native::ClipboardOutcome>>,
    }

    /// Records until dropped.
    pub struct Capture(pub Rc<Sink>);

    impl Drop for Capture {
        fn drop(&mut self) {
            SINK.with(|sink| sink.borrow_mut().take());
        }
    }

    pub fn capture() -> Capture {
        let sink = Rc::new(Sink::default());
        SINK.with(|slot| *slot.borrow_mut() = Some(sink.clone()));
        Capture(sink)
    }

    pub(crate) fn record(target: &str) -> bool {
        sink().is_some_and(|sink| {
            sink.opened.borrow_mut().push(target.to_owned());
            true
        })
    }

    pub(crate) fn sink() -> Option<Rc<Sink>> {
        SINK.with(|sink| sink.borrow().clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_web_links_open_in_the_browser() {
        let capture = testing::capture();
        assert_eq!(open_url("https://opencode.ai/v2/docs"), Ok(()));
        assert_eq!(
            open_url("file:///etc/passwd"),
            Err("Only http and https links can be opened in the browser: file:///etc/passwd".into())
        );
        assert!(open_url("not a url").is_err());
        assert_eq!(open_path("/tmp/project"), Ok(()));
        assert_eq!(*capture.0.opened.borrow(), ["https://opencode.ai/v2/docs", "/tmp/project"]);
    }
}
