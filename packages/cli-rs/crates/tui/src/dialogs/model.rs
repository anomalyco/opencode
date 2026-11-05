//! The model dialog (E.16: `component/dialog-model.tsx`, `component/model-options.tsx`) and the app commands
//! that reach [`Local`] (`app.tsx:903-1018`).

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use opencode_api::generated::{ModelInfo, ModelInfoStatus, ProviderInfo, SessionInfo, UsageLimitsInfo};
use opencode_api::js::locale_compare;
use opencode_local::model_pref::Model;
use opencode_ui::bind;
use opencode_ui::dialog::DialogOptions;
use opencode_ui::fuzzy;
use opencode_ui::keymap::{Bind, KeymapLayer, Slash, TuiCommand};
use opencode_ui::select::{self, ActionRun, SelectAction, SelectOption, SelectProps};
use opencode_ui::toast::{ToastOptions, Variant};
use opentui::keymap::Disposer;
use opentui::prelude::*;

use crate::app::Tui;
use crate::local::{Local, is};

/// `isFreeModel`.
pub fn is_free(model: &ModelInfo) -> bool {
    !model.cost.is_empty() && model.cost.iter().all(|cost| cost.input == 0.0)
}

/// An option of the model list before it becomes a select row.
#[derive(Clone)]
struct Row {
    value: Model,
    provider_id: String,
    provider_name: String,
    title: String,
    category: Option<String>,
    favorite: bool,
    free: bool,
    model: ModelInfo,
}

/// `sortModelOptions`: OpenCode Go, then OpenCode, then by provider name, free models first; stable otherwise.
fn sort_rows(rows: &mut [Row], grouped: bool) {
    rows.sort_by(|a, b| {
        let provider = if grouped {
            (b.provider_id == "opencode-go")
                .cmp(&(a.provider_id == "opencode-go"))
                .then((b.provider_id == "opencode").cmp(&(a.provider_id == "opencode")))
        } else {
            std::cmp::Ordering::Equal
        };
        let name = if grouped { locale_compare(&a.provider_name, &b.provider_name) } else { std::cmp::Ordering::Equal };
        provider.then(name).then(b.free.cmp(&a.free))
    });
}

/// `prioritizeFavorites`: favorites first, stable otherwise.
fn prioritize<T>(items: &mut [T], value: impl Fn(&T) -> &Model, favorites: &[String]) {
    items.sort_by_key(|item| !favorites.contains(&value(item).key()));
}

/// Opens the model dialog (`DialogModel`): the free models picker with nothing connected, else the connected
/// models, of one provider when `provider` is set.
pub fn show(local: &Rc<Local>, provider: Option<String>) {
    if !local.connected() && provider.is_none() {
        crate::dialogs::free_models::show(local);
        return;
    }
    local.load_usage(true);
    open(local, provider, String::new());
}

// Opens the connected models with `filter` typed, as a reopen keeps it.
fn open(local: &Rc<Local>, provider: Option<String>, filter: String) {
    local.dialogs.replace(
        bind!(local, |local, cx| {
            build(cx, &local, provider, &filter)
        }, else View::new(&cx.app)),
        None,
        DialogOptions::default(),
    );
}

// The select of `DialogConnectedModels`.
fn build(cx: &Rc<opencode_ui::dialog::DialogCx>, local: &Rc<Local>, provider: Option<String>, filter: &str) -> View {
    // Favoriting does not reorder the list until the dialog is reopened.
    let favorites_at_open = local.favorite();
    let marker = cx.theme.text.formfield.selected;
    let options: select::Options<Model> = {
        let weak = Rc::downgrade(local);
        let provider = provider.clone();
        Rc::new(move |query: &str| {
            weak.upgrade()
                .map_or_else(Vec::new, |local| options(&local, provider.as_deref(), query, &favorites_at_open, marker))
        })
    };
    let title = provider
        .as_deref()
        .and_then(|id| local.provider(id))
        .map_or("Select model".to_owned(), |provider| provider.name);
    let connected = local.connected();
    let mut props = SelectProps::dynamic(title, options.clone());
    props.flat = true;
    props.skip_filter = true;
    props.current = local.current();
    props.search_in_title = true;
    props.title_placeholder = Some("Search models".to_owned());
    let on_select = { Rc::new(bind!(local, |local, option: &SelectOption<Model>| choose(&local, &option.value))) };
    props.on_select = Some(on_select);
    let connect = { Rc::new(bind!(local, |local| connect(&local))) };
    let usage = { Rc::new(bind!(local, |local| crate::dialogs::usage::show(&local))) };
    let provider_title = if connected { "connect integration" } else { "view all integrations" };
    let favorite_title = {
        let weak = Rc::downgrade(local);
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
            ..SelectAction::new("model.dialog.provider", provider_title, |_| {})
        },
        SelectAction {
            run: ActionRun::Dialog(usage),
            hidden: !matches!(local.usage(), Some(Some(_))),
            ..SelectAction::new("model.dialog.usage", "usage", |_| {})
        },
        SelectAction {
            title: Rc::new(favorite_title),
            hidden: !connected,
            ..SelectAction::new("model.dialog.favorite", "Favorite", {
                bind!(local, |local, option| local.toggle_favorite(&option.value))
            })
        },
    ];
    let (view, handle) = select::select(cx, props);
    if !filter.is_empty() {
        handle.set_filter(filter);
    }
    // Refresh the rows as the catalog, the favorites, or the connections change. When the usage action or the
    // connected state would change the footer, the dialog opens again with the same filter.
    let usage_shown = matches!(local.usage(), Some(Some(_)));
    let reopened = Rc::new(Cell::new(false));
    cx.on_close(local.subscribe(bind!(local, |local| {
        if reopened.get() {
            return;
        }
        if matches!(local.usage(), Some(Some(_))) != usage_shown || local.connected() != connected {
            reopened.set(true);
            let provider = provider.clone();
            let again = local.clone();
            let filter = handle.filter();
            local.app.defer(move |_| open(&again, provider, filter));
            return;
        }
        handle.set_options(options(&handle.filter()));
    })));
    view
}

// The rows of `DialogConnectedModels` for `query`.
fn options(
    local: &Local,
    provider: Option<&str>,
    query: &str,
    favorites_at_open: &[Model],
    marker: Color,
) -> Vec<SelectOption<Model>> {
    local.models(|models| {
        local.providers(|providers| {
            catalog_options(local, models, providers, provider, query, favorites_at_open, marker)
        })
    })
}

fn catalog_options(
    local: &Local,
    models: &[ModelInfo],
    providers: &[ProviderInfo],
    provider: Option<&str>,
    query: &str,
    favorites_at_open: &[Model],
    marker: Color,
) -> Vec<SelectOption<Model>> {
    let needle = query.trim();
    let connected = local.connected();
    let show_sections = connected && provider.is_none() && needle.is_empty();
    let favorites: Vec<Model> = if connected { favorites_at_open.to_vec() } else { Vec::new() };
    let favorite_now = local.favorite();
    let favorite_priority: Vec<String> = favorites_at_open.iter().map(Model::key).collect();
    let recents = local.recent();
    let provider_name = |id: &str| {
        providers.iter().find(|item| item.id.0 == id).map_or(id.to_owned(), |provider| provider.name.clone())
    };
    let usage = local.usage().flatten();
    // The detail row shows the price, so the trailing slot only marks favorites.
    let marked = |option: &mut SelectOption<Model>, model: &ModelInfo, favorite: bool| {
        if favorite {
            option.footer = Some("*".to_owned());
            option.footer_fg = Some(marker);
        }
        let provider = providers.iter().find(|item| item.id == model.provider_id);
        option.detail = Some(detail(model, true, usage_label(usage.as_ref(), model, provider)));
    };
    let section = |items: &[Model], category: &str| -> Vec<SelectOption<Model>> {
        if !show_sections {
            return Vec::new();
        }
        items
            .iter()
            .filter_map(|item| {
                let model = models.iter().find(|model| is(model, item))?;
                let mut option = SelectOption::new(model.name.clone(), Model::new(&model.provider_id.0, &model.id))
                    .description(provider_name(&model.provider_id.0))
                    .category(category);
                marked(&mut option, model, favorite_now.contains(item));
                Some(option)
            })
            .collect()
    };
    let favorite_options = section(&favorites, "Favorites");
    let recent_items: Vec<Model> = recents.iter().filter(|item| !favorites.contains(item)).cloned().collect();
    let recent_options = section(&recent_items, "Recent");

    // OpenCode's own free models get their own group at the end of the list instead of joining "OpenCode".
    let free_group = |model: &ModelInfo| provider.is_none() && model.provider_id.0 == "opencode" && is_free(model);
    let mut rows: Vec<Row> = models
        .iter()
        .filter(|model| !matches!(model.status, ModelInfoStatus::Deprecated))
        .filter(|model| provider.is_none_or(|id| model.provider_id.0 == id))
        .map(|model| {
            let value = Model::new(&model.provider_id.0, &model.id);
            let name = provider_name(&model.provider_id.0);
            let favorite = connected && favorite_now.contains(&value);
            Row {
                provider_id: model.provider_id.0.clone(),
                provider_name: name.clone(),
                title: model.name.clone(),
                category: connected.then(|| if free_group(model) { "Free".to_owned() } else { name }),
                favorite,
                free: is_free(model),
                model: model.clone(),
                value,
            }
        })
        .filter(|row| !show_sections || (!favorites.contains(&row.value) && !recents.contains(&row.value)))
        .collect();
    sort_rows(&mut rows, connected);

    let to_option = |row: Row| {
        let mut option = SelectOption::new(row.title, row.value);
        option.category = row.category;
        marked(&mut option, &row.model, row.favorite);
        option
    };
    if !needle.is_empty() {
        let matches =
            fuzzy::go(needle, &rows, |row| [Some(row.title.as_str()), row.category.as_deref()], fuzzy::best_key, 0.0);
        let mut results: Vec<Row> = matches.into_iter().map(|index| rows[index].clone()).collect();
        sort_rows(&mut results, false);
        prioritize(&mut results, |row| &row.value, &favorite_priority);
        return results
            .into_iter()
            .map(|row| {
                // Search results name the provider inline. Without a category, the trailing slot keeps the
                // favorite marker instead of falling back to the provider name.
                let name = row.provider_name.clone();
                let mut option = to_option(row);
                option.description = Some(name);
                option.category = None;
                option
            })
            .collect();
    }
    let (free, paid): (Vec<Row>, Vec<Row>) = rows.into_iter().partition(|row| row.category.as_deref() == Some("Free"));
    favorite_options
        .into_iter()
        .chain(recent_options)
        .chain(paid.into_iter().map(to_option))
        .chain(free.into_iter().map(to_option))
        .collect()
}

/// What the model picker says the usage limits leave a model: `$x left`, in the error color when it cannot take
/// another request, or `No limit` for a paid model OpenCode Console serves without one.
fn usage_label(
    info: Option<&UsageLimitsInfo>,
    model: &ModelInfo,
    provider: Option<&ProviderInfo>,
) -> Option<(String, bool)> {
    let info = info?;
    let usage = crate::dialogs::usage::model_usage(info, model, provider);
    if let Some(usage) = usage {
        let level = crate::dialogs::usage::level(&usage, model);
        return Some((
            format!("{} left", crate::dialogs::usage::format_dollars(usage.left)),
            matches!(level, crate::dialogs::usage::Level::Out | crate::dialogs::usage::Level::Reached),
        ));
    }
    let paid = !model.cost.iter().all(|cost| cost.input == 0.0);
    (crate::dialogs::usage::served_by_console(provider) && paid).then(|| ("No limit".to_owned(), false))
}

/// `ModelDetail`: the selected model's price (unless `price` is false), input modalities, context window, and
/// reasoning support, below the list; after what its usage limits leave when `usage` says so.
pub fn detail(model: &ModelInfo, price: bool, usage: Option<(String, bool)>) -> select::Detail {
    let model = model.clone();
    select::Detail::View(Rc::new(move |cx| {
        let (app, theme) = (&cx.app, &cx.theme);
        let cost = if is_free(&model) {
            "Free".to_owned()
        } else {
            model
                .cost
                .first()
                .map_or(String::new(), |cost| format!("${}/${}", dollars(cost.input), dollars(cost.output)))
        };
        let mut facts: Vec<String> = vec![
            model.capabilities.input.iter().map(|value| modality(value)).collect::<Vec<_>>().join(", "),
            tokens(model.limit.context),
        ];
        if !model.variants.is_empty() {
            facts.push("Reasoning".to_owned());
        }
        let list = |items: Vec<String>| {
            let spans: Vec<Span> = items
                .into_iter()
                .filter(|item| !item.is_empty())
                .enumerate()
                .flat_map(|(index, item)| {
                    let separator = (index > 0).then(|| " · ".fg(theme.neutral().step(400)));
                    separator.into_iter().chain([item.fg(theme.text.muted)])
                })
                .collect();
            Text::new(app, spans).wrap(WrapMode::None).shrink(0.0)
        };
        let row = View::new(app).row().gap(2).justify(Justify::SpaceBetween);
        match &usage {
            Some((text, danger)) => {
                row.add(
                    &Text::new(app, text.as_str())
                        .fg(if *danger { theme.text.feedback.error.base } else { theme.text.muted })
                        .wrap(WrapMode::None),
                );
                let price = if !cost.is_empty() && cost != "Free" { format!("{cost} per 1M") } else { cost.clone() };
                row.add(&list([vec![price], facts.clone()].concat()));
            }
            None => {
                if price {
                    row.add(&Text::new(app, cost.as_str()).fg(theme.text.muted).wrap(WrapMode::None));
                } else {
                    row.justify(Justify::Start);
                }
                row.add(&list(facts.clone()));
            }
        }
        row.as_any()
    }))
}

// `String(Number(value.toFixed(2)))`.
fn dollars(value: f64) -> String {
    format!("{}", (value * 100.0).round() / 100.0)
}

fn modality(value: &str) -> String {
    if value == "pdf" {
        return "PDF".to_owned();
    }
    let mut chars = value.chars();
    chars.next().map_or(String::new(), |first| first.to_uppercase().chain(chars).collect())
}

fn tokens(value: i64) -> String {
    if value >= 1_000_000 {
        return format!("{}M", (value as f64 / 100_000.0).round() / 10.0);
    }
    if value >= 1_000 {
        return format!("{}K", (value as f64 / 1_000.0).round());
    }
    value.to_string()
}

/// `DialogModel`'s `select`: selects the model, then offers its variants unless the current one still applies.
pub fn choose(local: &Rc<Local>, model: &Model) {
    local.set(model, true);
    let variants = local.variants();
    let current = local.variant();
    if current.is_some_and(|current| variants.contains(&current)) {
        local.dialogs.clear();
        return;
    }
    if !variants.is_empty() {
        crate::dialogs::variant::show(local);
        return;
    }
    local.dialogs.clear();
}

/// `DialogModel`'s `connect`: the integration dialog, which reopens this dialog on the connected provider.
pub fn connect(local: &Rc<Local>) {
    crate::dialogs::integration::show(local, Some(crate::dialogs::integration::show_models()));
}

/// Registers the model, agent, variant, and usage commands and their keys (`app.tsx:903-1018`).
pub fn install(tui: &Rc<Tui>) {
    let local = tui.local.clone();
    let command = |id: &str, run: fn(&Rc<Local>)| {
        TuiCommand::new(id, bind!(local, |local, _, _| run(&local))).bind(Bind::Off).group("Agent")
    };
    let slash = |name: &str, aliases: &[&str]| Slash::new(name).aliases(aliases.iter().copied());
    let commands = vec![
        command("model.list", |local| show(local, None))
            .title("Switch model")
            .palette()
            .suggested(opentui::keymap::Condition::Always)
            .slash(slash("models", &[])),
        command("model.cycle_recent", |local| local.cycle(1)).title("Model cycle"),
        command("model.cycle_recent_reverse", |local| local.cycle(-1)).title("Model cycle reverse"),
        command("model.cycle_favorite", |local| local.cycle_favorite(1)).title("Favorite cycle"),
        command("model.cycle_favorite_reverse", |local| local.cycle_favorite(-1)).title("Favorite cycle reverse"),
        command("agent.list", crate::dialogs::agent::show).title("Switch agent").palette().slash(slash("agents", &[])),
        command("usage.show", crate::dialogs::usage::show).title("View usage").palette().slash(slash("usage", &[])),
        command("agent.cycle", |local| local.move_agent(1)).title("Agent cycle"),
        command("variant.cycle", |local| local.cycle_variant()).title("Variant cycle").palette(),
        command("variant.list", |local| {
            if local.variants().is_empty() {
                local.toasts.show(
                    ToastOptions::new(Variant::Info, "The current model does not support any variants.")
                        .title("No variants available"),
                );
                return;
            }
            crate::dialogs::variant::show(local);
        })
        .title("Switch model variant")
        .palette()
        .slash(slash("variants", &["thinking", "effort"])),
        command("agent.cycle.reverse", |local| local.move_agent(-1)).title("Agent cycle reverse"),
    ];
    let names: Vec<String> = commands.iter().filter_map(|command| command.id.clone()).collect();
    let layers = [KeymapLayer::global(commands), KeymapLayer::default().bindings(names)];
    for layer in layers {
        match tui.keymap.layer(layer) {
            Ok(disposer) => local.layers.borrow_mut().push(disposer),
            Err(error) => log::error!("model keymap layer: {error}"),
        }
    }
    let listener = local.subscribe(bind!(local, |local| {
        local.load_served_usage();
        usage_alerts(&local);
    }));
    local.layers.borrow_mut().push(listener);
    local.load();
}

/// Applies `--agent` and `--model` once the agents, the models, and `model.json` have loaded (`app.tsx:666-678`).
/// `model` is already parsed; an invalid one only got its toast.
pub fn startup(local: &Rc<Local>, agent: Option<String>, model: Option<Model>) {
    if agent.is_none() && model.is_none() {
        return;
    }
    local.startup_agent.replace(agent.clone());
    let pending = Rc::new(RefCell::new(Some((agent, model))));
    let listener: Rc<RefCell<Option<Disposer>>> = Rc::default();
    let apply = {
        let pending = pending.clone();
        let listener = listener.clone();
        bind!(local, |local| {
            if !local.ready() || !local.catalog_ready() || local.agents().is_empty() {
                return;
            }
            let Some((agent, model)) = pending.borrow_mut().take() else {
                return;
            };
            drop(listener.borrow_mut().take());
            if let Some(agent) = agent {
                local.set_agent(&agent);
            }
            if let Some(model) = model {
                local.set(&model, true);
            }
        })
    };
    *listener.borrow_mut() = Some(local.subscribe(apply.clone()));
    apply();
}

/// `useUsageAlerts` (`usage.tsx:224-251`): on a session, warns once per model as the selected model runs low and once
/// as it reaches its limit.
pub fn usage_alerts(local: &Local) {
    use crate::dialogs::usage::{Level, format_dollars, format_reset, level};
    if local.route().is_none() {
        return;
    }
    let Some((model, usage)) = local.current_usage() else {
        return;
    };
    let level = level(&usage, &model);
    if level == Level::Plenty {
        return;
    }
    let reached = level == Level::Reached;
    let key = format!("{}/{}:{}", model.provider_id.0, model.id, if reached { "reached" } else { "low" });
    if !local.warned.borrow_mut().insert(key) {
        return;
    }
    let weak = local.this.clone();
    let toast = if reached {
        ToastOptions::new(Variant::Error, format!("Resets {}", format_reset(usage.resets_at)))
            .title(format!("{} limit reached", model.name))
            .action("Switch model", bind!(weak, |local| show(&local, None)))
    } else {
        ToastOptions::new(
            Variant::Warning,
            format!("{} left · resets {}", format_dollars(usage.left), format_reset(usage.resets_at)),
        )
        .title(format!("Running low on {}", model.name))
        .action("View usage", bind!(weak, |local| crate::dialogs::usage::show(&local)))
    };
    local.toasts.show(toast);
}

/// The agent and model the prompt shows and submits: what the user chose here (`useLocal`) once this
/// state has its catalog, else the prompt's own reading of the catalog.
pub fn prompt_selection(
    tui: &Tui,
    catalog: &crate::prompt::metadata::Catalog,
    session: Option<&SessionInfo>,
) -> Option<crate::prompt::metadata::Selection> {
    let base = catalog.selection(session);
    let local = &tui.local;
    let Some(agent) = local.agent().filter(|_| local.catalog_ready()) else {
        return base;
    };
    let model = local
        .selection()
        .map(|selection| crate::prompt::metadata::Choice {
            provider_id: selection.model.provider_id,
            model_id: selection.model.model_id,
            variant: selection.variant,
        })
        .or_else(|| base.and_then(|base| base.model));
    Some(crate::prompt::metadata::Selection { agent, model })
}
