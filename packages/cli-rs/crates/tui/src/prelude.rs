//! The items most modules of the crate use. A module takes them with `use crate::prelude::*;`.

pub use std::cell::{Cell, RefCell};
pub use std::collections::HashMap;
pub use std::rc::{Rc, Weak};
pub use std::time::Duration;

pub use opencode_api::generated::{SessionID, SessionMessageInfo};
pub use opencode_store::Changes;
pub use opencode_ui::bind;
pub use opencode_ui::dialog::{DialogOptions, DialogSize, HeaderProps, header};
pub use opencode_ui::keymap::{Bind, KeymapLayer, TuiCommand};
pub use opencode_ui::select::{self, SelectOption, SelectProps};
pub use opencode_ui::theme::{Live, Paints, Theme};
pub use opencode_ui::toast::{ToastOptions, Variant};
pub use opentui::keymap::{Condition, Disposer};
pub use opentui::prelude::*;
pub use serde_json::{Value, json};

pub use crate::app::Tui;
pub use crate::routes::Route;
