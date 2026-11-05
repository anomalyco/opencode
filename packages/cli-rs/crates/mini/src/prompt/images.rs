//! The image previews above the composer (`footer.prompt.tsx:277-310`), shown with `prompt.image_preview`.

use std::cell::RefCell;

use base64::Engine;
use opentui::native::ImageFit;
use opentui::prelude::*;
use opentui::widget::ImageView;

use super::parts::Part;

/// The previews shown before `+N more`.
const VISIBLE: usize = 3;

/// `images`: the pasted images, without repeats of the same named attachment (`deduplicatePromptImages`).
pub fn images(parts: &[Part]) -> Vec<String> {
    let mut seen = Vec::new();
    parts
        .iter()
        .filter_map(|part| match part {
            Part::File(file) if file.url.starts_with("data:image/") => Some(file),
            _ => None,
        })
        .filter(|file| {
            let Some(mention) = &file.mention else {
                return true;
            };
            let key = (&file.filename, &file.description, &mention.text, &file.url);
            if seen.contains(&key) {
                return false;
            }
            seen.push(key);
            true
        })
        .map(|file| file.url.clone())
        .collect()
}

pub struct Previews {
    app: App,
    root: View,
    /// What the row shows, so a remeasure does not decode again.
    shown: RefCell<(Vec<String>, u16)>,
}

impl Previews {
    pub fn new(app: &App) -> Self {
        let root = View::new(app).row().width(Length::percent(100.0)).gap(1).visible(false);
        Self { app: app.clone(), root, shown: RefCell::default() }
    }

    pub fn root(&self) -> &View {
        &self.root
    }

    /// Shows the first three images `height` rows tall, each twice as wide, then `+N more`; an image that does
    /// not decode reads `No preview`. A height of zero hides the row.
    pub fn show(&self, uris: &[String], height: u16, muted: Color) {
        if height == 0 {
            self.root.visible(false);
            self.shown.borrow_mut().0.clear();
            return;
        }
        let next = (uris.to_vec(), height);
        if *self.shown.borrow() == next {
            return;
        }
        let app = &self.app;
        self.root.clear();
        self.root.visible(true).height(u32::from(height));
        for uri in uris.iter().take(VISIBLE) {
            let cell = View::new(app).width(u32::from(height * 2)).height(Length::percent(100.0)).shrink(1.0);
            let image =
                ImageView::new(app).fit(ImageFit::Contain).width(Length::percent(100.0)).height(Length::percent(100.0));
            match data_uri(uri).map(|bytes| image.load(&bytes)) {
                Some(Ok(image)) => cell.add(&image),
                _ => cell.add(&Text::new(app, "No preview").fg(muted)),
            };
            self.root.add(&cell);
        }
        if uris.len() > VISIBLE {
            self.root.add(
                &Text::new(app, format!("+{} more", uris.len() - VISIBLE))
                    .fg(muted)
                    .wrap(WrapMode::None)
                    .truncate(true),
            );
        }
        *self.shown.borrow_mut() = next;
    }
}

/// The bytes of a `data:` URI.
fn data_uri(uri: &str) -> Option<Vec<u8>> {
    let (meta, payload) = uri.strip_prefix("data:")?.split_once(',')?;
    if !meta.ends_with(";base64") {
        return Some(payload.as_bytes().to_vec());
    }
    base64::engine::general_purpose::STANDARD.decode(payload.trim()).ok()
}

#[cfg(test)]
mod tests {
    use opencode_ui::prompt_input::editor::Mention;

    use super::super::parts::File;
    use super::*;

    #[test]
    fn images_skip_repeats_and_other_files() {
        let image = |url: &str, label: Option<&str>| {
            Part::File(File {
                url: url.into(),
                mime: Some("image/png".into()),
                filename: Some("clipboard".into()),
                description: None,
                mention: label.map(|text| Mention { start: 0, end: 9, text: text.into() }),
            })
        };
        let parts = [
            image("data:image/png;base64,AA==", Some("[Image 1]")),
            image("data:image/png;base64,AA==", Some("[Image 1]")),
            image("data:image/png;base64,AA==", Some("[Image 2]")),
            image("file:///w/a.png", Some("@a.png")),
            image("data:image/png;base64,BB==", None),
            image("data:image/png;base64,BB==", None),
        ];
        assert_eq!(
            images(&parts),
            [
                "data:image/png;base64,AA==",
                "data:image/png;base64,AA==",
                "data:image/png;base64,BB==",
                "data:image/png;base64,BB=="
            ]
        );
        assert_eq!(data_uri("data:image/png;base64,AAE="), Some(vec![0, 1]));
        assert_eq!(data_uri("data:text/plain,hi"), Some(b"hi".to_vec()));
        assert_eq!(data_uri("file:///a.png"), None);
    }
}
