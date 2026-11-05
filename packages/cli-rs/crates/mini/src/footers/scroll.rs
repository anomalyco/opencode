//! The request bodies' scroll box and its scrollbar (`verticalScrollbarOptions`): a thumb in the line color on the
//! surface. The permission body shows it always, which is a full-height thumb when nothing scrolls; the form body
//! only while its content overflows, which the scroll box's own scrollbar does.

use opentui::prelude::*;

use crate::theme::FooterTheme;

#[derive(Clone)]
pub struct Scroller {
    pub scroll: ScrollBox,
}

impl Scroller {
    /// A row of the scroll box and, with `always`, the thumb column beside it. `shown` false leaves the scrollbar
    /// out (mono).
    pub fn new(app: &App, theme: &FooterTheme, shown: bool, always: bool) -> (View, Self) {
        let scroll = ScrollBox::new(app)
            .grow(1.0)
            .shrink(1.0)
            .basis(Length::Auto)
            .min_height(0)
            .min_width(0)
            .scrollbars(shown && !always)
            .scrollbar_colors(theme.line, theme.surface);
        let row = View::new(app).row().width(Length::percent(100.0)).min_height(0).child(&scroll);
        if shown && always {
            // A full-height thumb: the content of a permission fits its footer.
            row.add(
                &View::new(app)
                    .width(1)
                    .shrink(0.0)
                    .bg(theme.surface)
                    .border_sides(Sides::LEFT)
                    .border_chars(Some(['█'; 11]))
                    .border_color(theme.line),
            );
        }
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
