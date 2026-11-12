//! The request bodies' scroll box and its scrollbar (`verticalScrollbarOptions`): a thumb in the line color on the
//! surface. The permission body shows it always, which is a full-height thumb when nothing scrolls; the form body
//! only while its content overflows.

use crate::prelude::*;

#[derive(Clone)]
pub struct Scroller {
    pub scroll: ScrollBox,
}

impl Scroller {
    /// A row of the scroll box, whose scrollbar shows always with `always`, else on overflow. `shown` false leaves
    /// the scrollbar out (mono).
    pub fn new(app: &App, theme: &FooterTheme, shown: bool, always: bool) -> (View, Self) {
        let scroll = ScrollBox::new(app)
            .grow(1.0)
            .shrink(1.0)
            .basis(Length::Auto)
            .min_height(0)
            .min_width(0)
            .scrollbars(shown)
            .vertical_scrollbar_always(always)
            .scrollbar_colors(theme.line, theme.surface);
        let row = View::new(app).row().width(Length::percent(100.0)).min_height(0).child(&scroll);
        (row, Self { scroll })
    }

    /// Scrolls by a page (`scrollBy(±1, "viewport")`).
    pub fn page(&self, up: bool) {
        let page = f64::from(self.scroll.wrapper_view().rect().height.max(1.0));
        self.scroll.scroll_by(0.0, if up { -page } else { page });
    }

    pub fn top(&self) {
        self.scroll.scroll_to(0.0, 0.0);
    }
}

#[cfg(test)]
mod tests {
    use opentui::testing::TestApp;

    use super::*;

    #[test]
    fn the_permission_scrollbar_fills_its_track_until_the_content_scrolls() {
        let theme = crate::theme::resolve(&crate::theme::ThemeInput::default()).footer;
        let app = TestApp::new(12, 4);
        let (row, scroller) = Scroller::new(&app, &theme, true, true);
        row.height(4);
        scroller.scroll.add(&Text::new(&app, "fits"));
        app.root().add(&row);
        let thumb = |app: &TestApp| {
            let capture = app.render();
            (0..4).filter(|&y| capture.cell(11, y).unwrap().fg == theme.line).collect::<Vec<_>>()
        };
        assert_eq!(thumb(&app), [0, 1, 2, 3]);
        for line in 0..12 {
            scroller.scroll.add(&Text::new(&app, format!("line {line}")));
        }
        let top = thumb(&app);
        assert!(top.first() == Some(&0) && top.len() < 4, "{top:?}");
        scroller.page(false);
        let paged = thumb(&app);
        assert!(paged.first() > Some(&0), "{paged:?}");
    }
}
