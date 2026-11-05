//! The home footer plugin (E.14, row F01, `feature-plugins/home/footer.tsx`), appended to `home.footer`: the
//! MCP servers of the default location (`⊙ 2 MCP`, or `⊙ 1 MCP failed`, with `/mcps` from 64 columns; a click
//! opens the list), the failed plugins, the `home.footer.status` slot, and the version on the right from 64
//! columns. Hidden below 44x14.

use std::cell::RefCell;
use std::rc::Rc;

use opencode_plugin::{Definition, Placement, SlotMount, Slotted, slot};
use opencode_store::Changes;
use opentui::prelude::*;

use crate::app::Tui;

pub fn plugin() -> Definition<Tui> {
    Definition::new("opencode.home.footer", |cx| {
        // Append keeps the path open to additive plugin claims; an external replace still takes it over.
        cx.slot(Placement::append(slot::HOME_FOOTER), |tui, _| Box::new(Footer::new(tui)));
    })
}

struct Footer(Rc<Inner>);

struct Inner {
    root: View,
    shown: RefCell<Option<Model>>,
    status: RefCell<SlotMount<Tui>>,
}

#[derive(Clone, Debug, PartialEq)]
struct Model {
    size: (u16, u16),
    /// Servers, connected, failed.
    mcp: (usize, usize, usize),
}

impl Footer {
    fn new(tui: &Tui) -> Self {
        let inner = Rc::new(Inner {
            root: View::new(&tui.app).width(Length::percent(100.0)).shrink(0.0),
            shown: RefCell::default(),
            status: RefCell::default(),
        });
        inner.refresh(tui);
        // The visibility follows the terminal size (`useTerminalDimensions`).
        let weak = Rc::downgrade(&inner);
        let owner = tui.weak();
        inner.root.on_resize(move |_, _| {
            if let (Some(inner), Some(tui)) = (weak.upgrade(), owner.upgrade()) {
                inner.refresh(&tui);
            }
        });
        Self(inner)
    }
}

impl Inner {
    fn refresh(&self, tui: &Tui) {
        let mcp = tui.data.read(|state| {
            let list = state.location(None).and_then(|data| data.mcp_server.as_deref()).unwrap_or_default();
            let count = |tag: &str| list.iter().filter(|item| item.status.tag() == tag).count();
            (list.len(), count("connected"), count("failed"))
        });
        let model = Model { size: tui.app.size(), mcp };
        if self.shown.borrow().as_ref() == Some(&model) {
            return;
        }
        self.root.clear();
        *self.status.borrow_mut() = self.render(tui, &model);
        *self.shown.borrow_mut() = Some(model);
        tui.app.request_redraw();
    }

    fn render(&self, tui: &Tui, model: &Model) -> SlotMount<Tui> {
        let app = &tui.app;
        let theme = tui.page();
        let (width, height) = model.size;
        if height < 14 || width < 44 {
            return SlotMount::default();
        }
        let padding = if height < 16 { 0 } else { 1 };
        let row = View::new(app).row().width(Length::percent(100.0)).padding_y(padding).padding_x(2).gap(2).shrink(0.0);
        let (servers, connected, failed) = model.mcp;
        if servers > 0 {
            let spans = if failed > 0 {
                vec!["⊙ ".fg(theme.text.feedback.error.base), format!("{failed} MCP failed").fg(theme.text.base)]
            } else {
                vec![
                    "⊙ ".fg(if connected > 0 { theme.text.feedback.success.base } else { theme.text.muted }),
                    format!("{connected} MCP").fg(theme.text.base),
                ]
            };
            let mcp = View::new(app).row().gap(1).shrink(0.0).child(&Text::new(app, spans).fg(theme.text.base));
            if width >= 64 {
                mcp.add(&Text::new(app, "/mcps").fg(theme.text.muted));
            }
            let weak = tui.weak();
            mcp.mouse_pointer(MousePointer::POINTER).on_mouse(move |_, event| {
                if matches!(event.kind, MouseEventKind::Up(_))
                    && let Some(tui) = weak.upgrade()
                {
                    tui.keymap.dispatch("mcp.list", None);
                }
            });
            row.add(&mcp);
        }
        // Failed plugins: built-ins do not fail, and server plugins are read from P.4 on.
        let status = crate::plugins::host::slot(tui, &row, slot::HOME_FOOTER_STATUS, &Default::default(), |_| {});
        row.add(&View::new(app).grow(1.0));
        if width >= 64 {
            row.add(
                &View::new(app)
                    .shrink(0.0)
                    .child(&Text::new(app, tui.startup.args.version.clone()).fg(theme.text.muted)),
            );
        }
        self.root.add(&row);
        status
    }
}

impl Slotted<Tui> for Footer {
    fn root(&self) -> View {
        self.0.root.clone()
    }

    fn sync(&self, tui: &Tui, changes: &Changes) {
        if !changes.is_empty() {
            self.0.refresh(tui);
        }
        self.0.status.borrow().sync(tui, changes);
    }
}
