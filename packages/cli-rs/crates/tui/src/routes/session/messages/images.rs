//! Images in the transcript (E.6b): `SessionImages` (`routes/session/index.tsx:2651-2725`) on opentui-rust's
//! `ImageView`. With `session.image_preview` on, a user message or tool result shows up to three images side by side,
//! then `+N more`. A `data:` URI decodes in place; a `media:<hash>` ref reads its bytes from the server once.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use base64::Engine;
use opencode_api::generated::{
    ExperimentalMediaGetInput, MediaHash, PromptFileAttachment, PromptFileSource, SessionMessageAssistantTool,
    SessionMessageAssistantToolState, ToolContent,
};
use opencode_store::Data;
use opentui::native::ImageFit;
use opentui::prelude::*;
use opentui::widget::ImageView;

use super::list::Context;

/// The most images shown in a row.
const VISIBLE: usize = 3;

pub struct Images {
    app: App,
    data: Data,
    /// A click on an image opens the preview dialog (E.4).
    tui: std::rc::Weak<crate::app::Tui>,
    root: View,
    /// The URIs on screen and the height they were laid out for.
    rendered: RefCell<Option<(Vec<String>, u16)>>,
    /// Bytes read for `media:` refs, by URI, shared by the row's images.
    media: Rc<RefCell<HashMap<String, Vec<u8>>>>,
}

impl Images {
    /// `padding_left` is 2 inside a user message and 3 under a tool.
    pub fn new(cx: &Context<'_>, padding_left: u16) -> Self {
        let root = View::new(cx.app)
            .row()
            .shrink(0.0)
            .gap(1)
            .padding_edge(Edge::Top, 1)
            .padding_edge(Edge::Left, padding_left)
            .padding_edge(Edge::Right, 2)
            .padding_edge(Edge::Bottom, 1)
            .visible(false);
        Self {
            app: cx.app.clone(),
            data: cx.tui.data.clone(),
            tui: cx.tui.weak(),
            root,
            rendered: RefCell::default(),
            media: Rc::default(),
        }
    }

    pub fn root(&self) -> &View {
        &self.root
    }

    pub fn update(&self, cx: &Context<'_>, uris: Vec<String>) {
        let uris = if cx.image_preview { uris } else { Vec::new() };
        let (_, rows) = cx.app.size();
        let height = (rows / 4).clamp(4, 8);
        let next = (uris, height);
        if self.rendered.borrow().as_ref() == Some(&next) {
            return;
        }
        let (uris, height) = &next;
        self.root.clear();
        self.root.visible(!uris.is_empty());
        for (index, uri) in uris.iter().take(VISIBLE).enumerate() {
            let cell = View::new(&self.app)
                .width(height * 2)
                .height(*height)
                .basis(Length::Cells(f32::from(height * 2)))
                .shrink(1.0)
                .align_items(Align::Center)
                .justify(Justify::Center);
            self.show(&cell, uri);
            let (tui, images) = (self.tui.clone(), uris.iter().map(|uri| (uri.clone(), None)).collect::<Vec<_>>());
            cell.mouse_pointer(MousePointer::POINTER).on_mouse(move |cx, event| {
                if event.kind != MouseEventKind::Up(MouseButton::Left) {
                    return;
                }
                cx.stop_propagation();
                if let Some(tui) = tui.upgrade() {
                    crate::dialogs::image_preview::show(&tui, images.clone(), index);
                }
            });
            self.root.add(&cell);
        }
        if uris.len() > VISIBLE {
            self.root.add(
                &View::new(&self.app)
                    .width(8)
                    .height(*height)
                    .shrink(1.0)
                    .align_items(Align::Center)
                    .justify(Justify::Center)
                    .child(&Text::new(&self.app, format!("+{} more", uris.len() - VISIBLE)).wrap(WrapMode::None)),
            );
        }
        *self.rendered.borrow_mut() = Some(next);
    }

    /// Puts the image, or `No preview` when it cannot load, into `cell`.
    fn show(&self, cell: &View, uri: &str) {
        if let Some(hash) = media_hash(uri) {
            if let Some(bytes) = self.media.borrow().get(uri) {
                place(&self.app, cell, Some(bytes));
                return;
            }
            let client = self.data.client().clone();
            let input = ExperimentalMediaGetInput { hash: MediaHash(hash.to_owned()) };
            let (cell, media, uri, app) = (cell.clone(), self.media.clone(), uri.to_owned(), self.app.clone());
            self.app.spawn(async move { client.experimental_media_get(&input).await }, move |_, result| {
                let bytes = result.ok().map(|bytes| bytes.to_vec());
                place(&app, &cell, bytes.as_deref());
                if let Some(bytes) = bytes {
                    media.borrow_mut().insert(uri, bytes);
                }
            });
            return;
        }
        place(&self.app, cell, data_uri(uri).as_deref());
    }
}

fn place(app: &App, cell: &View, bytes: Option<&[u8]>) {
    cell.clear();
    let image = ImageView::new(app).fit(ImageFit::Cover).width(Length::Percent(100.0)).height(Length::Percent(100.0));
    match bytes.map(|bytes| image.load(bytes)) {
        Some(Ok(image)) => cell.add(&image),
        _ => cell.add(&Text::new(app, "No preview")),
    };
}

/// The images of a user message's attachments, each once (`deduplicateVisibleImages`).
pub fn user_images(files: &[PromptFileAttachment]) -> Vec<String> {
    let mut seen = Vec::new();
    files
        .iter()
        .filter(|file| file.mime.starts_with("image/"))
        .filter(|file| {
            let mention = file.mention.as_ref().map(|mention| mention.text.as_str());
            let inline = matches!(file.source, PromptFileSource::Inline(_));
            let Some(mention) = mention.filter(|_| inline) else {
                return true;
            };
            let key = (
                file.mime.clone(),
                file.name.clone(),
                file.description.clone(),
                mention.to_owned(),
                file.data.0.clone(),
            );
            if seen.contains(&key) {
                return false;
            }
            seen.push(key);
            true
        })
        .map(|file| format!("data:{};base64,{}", file.mime, file.data.0))
        .collect()
}

/// `inlineToolImages`: the image files a tool returned inline or by media ref.
pub fn tool_images(tool: &SessionMessageAssistantTool) -> Vec<String> {
    let content = match &tool.state {
        SessionMessageAssistantToolState::Completed(done) => done.content.as_slice(),
        SessionMessageAssistantToolState::Error(failed) => failed.content.as_deref().unwrap_or_default(),
        _ => &[],
    };
    content
        .iter()
        .filter_map(|item| match item {
            ToolContent::File(file)
                if file.mime.starts_with("image/")
                    && (file.uri.starts_with("data:image/") || media_hash(&file.uri).is_some()) =>
            {
                Some(file.uri.clone())
            }
            _ => None,
        })
        .collect()
}

/// `mediaHashFromUri`: the 64 hex digits of `media:<hash>`.
pub(crate) fn media_hash(uri: &str) -> Option<&str> {
    let hash = uri.strip_prefix("media:")?;
    (hash.len() == 64 && hash.bytes().all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))).then_some(hash)
}

/// The bytes of a base64 `data:` URI.
pub(crate) fn data_uri(uri: &str) -> Option<Vec<u8>> {
    let rest = uri.strip_prefix("data:")?;
    let (meta, payload) = rest.split_once(',')?;
    if !meta.ends_with(";base64") {
        return Some(payload.as_bytes().to_vec());
    }
    base64::engine::general_purpose::STANDARD.decode(payload.trim()).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uris_decode_or_name_a_media_hash() {
        assert_eq!(data_uri("data:image/png;base64,aGk="), Some(b"hi".to_vec()));
        assert_eq!(data_uri("https://example.com/a.png"), None);
        let hash = "a".repeat(64);
        assert_eq!(media_hash(&format!("media:{hash}")), Some(hash.as_str()));
        assert_eq!(media_hash("media:abc"), None);
    }
}
