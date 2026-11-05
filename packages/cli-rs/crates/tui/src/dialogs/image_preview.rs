//! Image preview dialog (E.4, row DLG09): `packages/tui/src/component/dialog-image-preview.tsx`.
//!
//! "Image N of M": one image at a time, fitted to the dialog (extra large, centered), with Left and Right
//! (or the footer's previous and next) moving through them. The footer names the image by its prompt
//! label, or `No preview` when it does not load. A `media:` ref reads its bytes from the server once
//! (`createMediaSource`).

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::rc::{Rc, Weak};

use opencode_api::client::RequestOptions;
use opencode_api::generated::{ExperimentalMediaGetInput, MediaHash};
use opencode_ui::bind;
use opencode_ui::dialog::{
    DialogCx, DialogOptions, DialogSize, FooterAction, FooterProps, HeaderProps, header, layout,
};
use opencode_ui::keymap::{KeymapLayer, TuiCommand};
use opentui::native::ImageFit;
use opentui::prelude::*;
use opentui::widget::ImageView;

use crate::app::Tui;
use crate::routes::session::messages::images::{data_uri, media_hash};

/// Opens the dialog on `images` (each a URI and its prompt label), at `initial`.
pub fn show(tui: &Tui, images: Vec<(String, Option<String>)>, initial: usize) {
    if images.is_empty() {
        return;
    }
    let viewer = Rc::new(Viewer {
        tui: tui.weak(),
        index: Cell::new(initial.min(images.len() - 1)),
        images,
        root: View::new(&tui.app),
        cx: RefCell::new(Weak::new()),
        media: RefCell::default(),
    });
    let built = viewer.clone();
    tui.dialogs.replace(
        move |cx| {
            let viewer = built;
            cx.dialogs.set_centered(true);
            *viewer.cx.borrow_mut() = Rc::downgrade(cx);
            let step = |direction: isize| {
                bind!(viewer, |viewer, _: Option<&str>, _: Option<&KeyEvent>| viewer.step(direction))
            };
            cx.layer(KeymapLayer::new(vec![
                TuiCommand::inline("left", step(-1)).title("Previous image").group("Dialog"),
                TuiCommand::inline("right", step(1)).title("Next image").group("Dialog"),
            ]));
            viewer.draw();
            let root = viewer.root.clone();
            // The dialog owns the viewer; its handlers hold weak references.
            cx.on_close(opentui::keymap::Disposer::new(move || drop(viewer)));
            root
        },
        None,
        DialogOptions::new(DialogSize::XLarge).key("prompt-image-viewer"),
    );
}

struct Viewer {
    tui: Weak<Tui>,
    images: Vec<(String, Option<String>)>,
    index: Cell<usize>,
    root: View,
    cx: RefCell<Weak<DialogCx>>,
    /// Bytes of `media:` refs by URI; `None` for a read that failed.
    media: RefCell<HashMap<String, Option<Vec<u8>>>>,
}

impl Viewer {
    fn step(self: &Rc<Self>, direction: isize) {
        let count = self.images.len();
        if count < 2 {
            return;
        }
        let next = (self.index.get() as isize + direction).rem_euclid(count as isize);
        self.index.set(next as usize);
        // A footer action runs inside the footer this replaces, so the redraw waits.
        if let Some(tui) = self.tui.upgrade() {
            tui.app.defer(bind!(self, |viewer, _| viewer.draw()));
        }
    }

    fn draw(self: &Rc<Self>) {
        let (Some(tui), Some(cx)) = (self.tui.upgrade(), self.cx.borrow().upgrade()) else {
            return;
        };
        let app = &cx.app;
        let theme = &cx.theme;
        let index = self.index.get();
        let (uri, label) = &self.images[index];
        let height = app.size().1.saturating_sub(8).max(3);
        let (image, failed) = match self.bytes(&tui, uri) {
            Load::Pending => (None, false),
            Load::Failed => (None, true),
            Load::Ready(bytes) => {
                let view = ImageView::new(app).fit(ImageFit::Contain).width(Length::Percent(100.0)).height(height);
                match view.load(&bytes) {
                    Ok(view) => (Some(view), false),
                    Err(_) => (None, true),
                }
            }
        };
        let body = View::new(app).height(height);
        if let Some(image) = &image {
            body.add(image);
        }
        let name = if failed {
            "No preview".to_owned()
        } else {
            label.clone().unwrap_or_else(|| format!("Image {}", index + 1))
        };
        let footer_text = Text::new(app, name)
            .fg(if failed { theme.text.feedback.error.base } else { theme.text.muted })
            .wrap(WrapMode::None)
            .truncate(true);
        let mut primary = Vec::new();
        if self.images.len() > 1 {
            let action = |title: &str, key: &str, direction: isize| {
                FooterAction::new(title).key(key).on_trigger(bind!(self, |viewer| viewer.step(direction)))
            };
            primary = vec![action("previous", "←", -1), action("next", "→", 1)];
        }
        let head = header(
            &cx,
            HeaderProps { title: format!("Image {} of {}", index + 1, self.images.len()), ..HeaderProps::default() },
        );
        self.root.clear();
        self.root.add(&layout(
            &cx,
            &head,
            &body,
            Some(FooterProps { primary, children: vec![footer_text.as_any()], ..FooterProps::default() }),
        ));
        app.request_redraw();
    }

    /// The image's bytes: a `data:` URI decodes in place, a `media:` ref is read once.
    fn bytes(self: &Rc<Self>, tui: &Tui, uri: &str) -> Load {
        let Some(hash) = media_hash(uri) else {
            return data_uri(uri).map_or(Load::Failed, Load::Ready);
        };
        if let Some(cached) = self.media.borrow().get(uri) {
            return cached.clone().map_or(Load::Failed, Load::Ready);
        }
        let client = tui.data.client().clone();
        let input = ExperimentalMediaGetInput { hash: MediaHash(hash.to_owned()) };
        let (weak, uri) = (Rc::downgrade(self), uri.to_owned());
        tui.app.spawn(
            async move { client.experimental_media_get(&input, &RequestOptions::default()).await },
            bind!(weak, |viewer, _, result| {
                viewer.media.borrow_mut().insert(uri, result.ok().map(|bytes| bytes.to_vec()));
                viewer.draw();
            }),
        );
        Load::Pending
    }
}

enum Load {
    Pending,
    Ready(Vec<u8>),
    Failed,
}
