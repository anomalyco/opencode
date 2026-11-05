//! Free models dialog (E.16): `component/dialog-model-free.tsx`, the model picker while no provider is
//! connected.

use std::rc::Rc;

use opencode_api::generated::ModelInfoStatus;
use opencode_local::model_pref::Model;
use opencode_ui::bind;
use opencode_ui::dialog::DialogOptions;
use opencode_ui::select::{self, ActionRun, SelectAction, SelectOption, SelectProps, fuzzy};
use opentui::prelude::*;

use crate::dialogs::model::{self, Local, is_free};

pub fn show(local: &Rc<Local>) {
    let weak = Rc::downgrade(local);
    local.dialogs.replace(
        bind!(weak, |local, cx| {
            // Favoriting does not reorder the list until the dialog is reopened.
            let favorites: Vec<String> = local.favorite().iter().map(Model::key).collect();
            let recent: Vec<String> = local.recent().iter().map(Model::key).collect();
            let marker = cx.theme.text.formfield.selected;
            let options: select::Options<Model> = {
                let weak = Rc::downgrade(&local);
                Rc::new(move |query: &str| {
                    weak.upgrade().map_or_else(Vec::new, |local| options(&local, query, &favorites, &recent, marker))
                })
            };
            let mut props = SelectProps::dynamic("Free models", options.clone());
            props.description = Some("Connect a provider for access to more models".to_owned());
            props.flat = true;
            props.skip_filter = true;
            props.current = local.current();
            let weak = Rc::downgrade(&local);
            props.on_select = Some(Rc::new(bind!(weak, |local, option: &SelectOption<Model>| model::choose(&local, &option.value))));
            let connect = {
                Rc::new(bind!(local, |local| model::connect(&local)))
            };
            let favorite_title = {
                let weak = Rc::downgrade(&local);
                move |option: Option<&SelectOption<Model>>| -> String {
                    let favorite = weak
                        .upgrade()
                        .is_some_and(|local| option.is_some_and(|option| local.favorite().contains(&option.value)));
                    if favorite { "unfavorite" } else { "favorite" }.into()
                }
            };
            props.actions = vec![
                SelectAction {
                    run: ActionRun::Dialog(connect),
                    ..SelectAction::new("model.dialog.provider", "connect provider", |_| {})
                },
                SelectAction {
                    title: Rc::new(favorite_title),
                    ..SelectAction::new("model.dialog.favorite", "favorite", {
                        bind!(local, |local, option| local.toggle_favorite(&option.value))
                    })
                },
            ];
            let (view, handle) = select::select(cx, props);
            cx.on_close(local.subscribe(move || handle.set_options(options(&handle.filter()))));
            view
        }, else View::new(&cx.app)),
        None,
        DialogOptions::default(),
    );
}

fn options(
    local: &Local,
    query: &str,
    favorites: &[String],
    recent: &[String],
    marker: Color,
) -> Vec<SelectOption<Model>> {
    let favorite_now = local.favorite();
    let all: Vec<SelectOption<Model>> = local
        .models()
        .into_iter()
        .filter(|model| !matches!(model.status, ModelInfoStatus::Deprecated) && is_free(model))
        .map(|model| {
            let value = Model::new(&model.provider_id.0, &model.id);
            let mut option = SelectOption::new(model.name.clone(), value.clone());
            if favorite_now.contains(&value) {
                option.footer = Some("*".to_owned());
                option.footer_fg = Some(marker);
            }
            option.detail = Some(model::detail(&model, false, None));
            option
        })
        .collect();
    let favored = |option: &SelectOption<Model>| !favorites.contains(&option.value.key());
    let needle = query.trim();
    if !needle.is_empty() {
        let mut found: Vec<SelectOption<Model>> =
            fuzzy::go(needle, &all, |option| [Some(option.title.as_str())], |s| s[0], 0.0)
                .into_iter()
                .map(|index| all[index].clone())
                .collect();
        found.sort_by_key(favored);
        return found;
    }
    // Favorites first, then most recently used, then the server's order.
    let rank =
        |option: &SelectOption<Model>| recent.iter().position(|key| *key == option.value.key()).unwrap_or(usize::MAX);
    let mut sorted = all;
    sorted.sort_by_key(rank);
    sorted.sort_by_key(favored);
    sorted
}
