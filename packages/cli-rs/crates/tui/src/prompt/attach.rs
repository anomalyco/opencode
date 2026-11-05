//! Attachments in the TUI prompt (E.4, rows P06 and P10): the image previews above the textarea and
//! `prompt.images.view`. The pasted-path rules are shared with mini in [`opencode_ui::prompt_input::attach`].

use opentui::native::ImageFit;
use opentui::prelude::*;
use opentui::widget::ImageView;
use serde_json::Value;

pub use opencode_ui::prompt_input::attach::*;

use super::editor::Inner;
use crate::app::Tui;

/// The most previews shown above the prompt.
const VISIBLE: usize = 3;

/// The image previews above the textarea (`prompt.image_preview`): up to three, cropped to their boxes,
/// then `+N more`. A click opens the image preview dialog.
pub struct Previews {
    root: View,
    rendered: std::cell::RefCell<Option<Shown>>,
}

/// The files, height, and option the previews were last built for.
type Shown = (Vec<(Option<String>, Option<String>, usize)>, u16, bool);

impl Previews {
    pub fn new(app: &App) -> Self {
        Self {
            root: View::new(app)
                .row()
                .shrink(0.0)
                .gap(1)
                .padding_edge(Edge::Bottom, 1)
                .justify(Justify::Start)
                .visible(false),
            rendered: std::cell::RefCell::default(),
        }
    }

    pub fn root(&self) -> &View {
        &self.root
    }

    /// Shows the prompt's images when the option is on.
    pub fn update(&self, tui: &Tui, prompt: &Inner) {
        let enabled = tui.settings.info().prompt.and_then(|prompt| prompt.image_preview).unwrap_or(false);
        let height = (tui.app.size().1 / 4).clamp(4, 8);
        let next = (fingerprint(&prompt.prompt.borrow()), height, enabled);
        if self.rendered.borrow().as_ref() == Some(&next) {
            return;
        }
        *self.rendered.borrow_mut() = Some(next);
        let images = if enabled { images(&prompt.prompt.borrow()) } else { Vec::new() };
        let uris: Vec<String> = images.iter().map(|(uri, _)| uri.clone()).collect();
        let app = &tui.app;
        let theme = tui.page();
        self.root.clear();
        self.root.visible(!uris.is_empty());
        self.root.height(height + 1);
        let open = |index: usize| {
            let weak = tui.weak();
            let images = images.clone();
            move |_: &mut Cx<'_>, event: &MouseEvent| {
                if event.kind != MouseEventKind::Up(MouseButton::Left) {
                    return;
                }
                if let Some(tui) = weak.upgrade() {
                    crate::dialogs::image_preview::show(&tui, images.clone(), index);
                }
            }
        };
        for (index, uri) in uris.iter().take(VISIBLE).enumerate() {
            let cell = View::new(app)
                .width(height * 2)
                .height(height)
                .basis(Length::Cells(f32::from(height * 2)))
                .shrink(1.0)
                .align_items(Align::Center)
                .justify(Justify::Center);
            let image =
                ImageView::new(app).fit(ImageFit::Cover).width(Length::Percent(100.0)).height(Length::Percent(100.0));
            match crate::routes::session::messages::images::data_uri(uri).map(|bytes| image.load(&bytes)) {
                Some(Ok(image)) => cell.add(&image),
                _ => cell.add(&Text::new(app, "No preview").fg(theme.text.muted)),
            };
            cell.on_mouse(open(index));
            self.root.add(&cell);
        }
        if uris.len() > VISIBLE {
            let more = View::new(app)
                .width(8)
                .height(height)
                .basis(Length::Cells(8.0))
                .shrink(1.0)
                .align_items(Align::Center)
                .justify(Justify::Center)
                .child(
                    &Text::new(app, format!("+{} more", uris.len() - VISIBLE))
                        .fg(theme.text.muted)
                        .wrap(WrapMode::None)
                        .truncate(true),
                );
            more.on_mouse(open(VISIBLE));
            self.root.add(&more);
        }
    }
}

/// `prompt.images.view`: the preview dialog from the first image.
pub fn view(tui: &Tui, prompt: &Inner) {
    let images = images(&prompt.prompt.borrow());
    if !images.is_empty() {
        crate::dialogs::image_preview::show(tui, images, 0);
    }
}

pub fn has_images(prompt: &Inner) -> bool {
    prompt.prompt.borrow()["files"].as_array().is_some_and(|files| {
        files.iter().any(|file| file["uri"].as_str().is_some_and(|uri| uri.starts_with("data:image/")))
    })
}

/// What the previews depend on, without copying the URIs, which hold whole images: each file's label,
/// name, and URI length.
fn fingerprint(prompt: &Value) -> Vec<(Option<String>, Option<String>, usize)> {
    prompt["files"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .map(|file| {
            (
                file["mention"]["text"].as_str().map(str::to_owned),
                file["name"].as_str().map(str::to_owned),
                file["uri"].as_str().map_or(0, str::len),
            )
        })
        .collect()
}
