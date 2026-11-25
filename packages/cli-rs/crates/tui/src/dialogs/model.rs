//! Model selection, favorites, and usage alerts.

use std::collections::{HashMap, HashSet};

use opencode_api::generated::{ModelInfo, ModelInfoStatus, ProviderInfo};
use opencode_api::js::locale_compare;
use opencode_local::model_pref::Model;
use opencode_ui::fuzzy;
use opencode_ui::keymap::Slash;
use opencode_ui::select::{ActionRun, SelectAction};

use crate::local::{Local, ModelIndex};
use crate::prelude::*;

pub fn is_free(model: &ModelInfo) -> bool {
    !model.cost.is_empty() && model.cost.iter().all(|cost| cost.input == 0.0)
}

/// An option of the model list before it becomes a select row.
struct Row {
    value: Model,
    provider_name: String,
    title: String,
    category: Option<String>,
    favorite: bool,
    free: bool,
    /// Shown in the Favorites or Recent section, so left out of the provider groups below them.
    pinned: bool,
    /// A favorite when the dialog opened: first among search results (`prioritizeFavorites`).
    priority: bool,
}

impl Row {
    fn provider_id(&self) -> &str {
        &self.value.provider_id
    }

    fn provider_name(&self) -> &str {
        &self.provider_name
    }
}

/// The model list of one catalog: built when the dialog opens and again when the catalog, the favorites or the
/// recents change, and searched on each keystroke.
struct Catalog {
    connected: bool,
    /// Whether the list shows the Favorites and Recent sections while the filter is empty.
    sections: bool,
    favorites: Vec<SelectOption<Model>>,
    recents: Vec<SelectOption<Model>>,
    /// Every row, in list order.
    rows: Vec<Row>,
    /// The rows' titles and categories, prepared for search.
    targets: fuzzy::Targets<2>,
    marker: Color,
}

/// `sortModelOptions`: OpenCode Go, then OpenCode, then by provider name, free models first; stable otherwise.
fn sort_rows<R: std::borrow::Borrow<Row>>(rows: &mut [R], grouped: bool) {
    rows.sort_by(|a, b| {
        let (a, b) = (a.borrow(), b.borrow());
        let provider = if grouped {
            (b.provider_id() == "opencode-go")
                .cmp(&(a.provider_id() == "opencode-go"))
                .then((b.provider_id() == "opencode").cmp(&(a.provider_id() == "opencode")))
        } else {
            std::cmp::Ordering::Equal
        };
        let name =
            if grouped { locale_compare(a.provider_name(), b.provider_name()) } else { std::cmp::Ordering::Equal };
        provider.then(name).then(b.free.cmp(&a.free))
    });
}

pub fn show(local: &Rc<Local>, integration: Option<String>) {
    if !local.connected() && integration.is_none() {
        crate::dialogs::free_models::show(local);
        return;
    }
    open(local, integration, String::new());
}

fn open(local: &Rc<Local>, integration: Option<String>, filter: String) {
    local.dialogs.replace(
        bind!(local, |local, cx| {
            build(cx, &local, integration.clone(), &filter)
        }, else View::new(&cx.app)),
        None,
        DialogOptions::default(),
    );
}

fn build(cx: &Rc<opencode_ui::dialog::DialogCx>, local: &Rc<Local>, integration: Option<String>, filter: &str) -> View {
    // Favoriting does not reorder the list until the dialog is reopened, which a build in a new theme is not.
    let favorites = Rc::new(local.favorite());
    let saved = favorites.clone();
    let favorites_at_open = cx.keep(move || saved.clone()).unwrap_or(favorites);
    let marker = cx.theme.text.formfield.selected;
    let catalog: Rc<RefCell<Option<Catalog>>> = Rc::default();
    let options: select::Options<Model> = {
        let (integration, catalog) = (integration.clone(), catalog.clone());
        Rc::new(bind!(local, |local, query: &str| {
            let mut catalog = catalog.borrow_mut();
            let catalog =
                catalog.get_or_insert_with(|| Catalog::new(&local, integration.as_deref(), &favorites_at_open, marker));
            catalog.options(query)
        }))
    };
    let title = integration
        .as_deref()
        .and_then(|id| local.integration(id))
        .filter(|item| !item.name.is_empty())
        .map_or("Select model".to_owned(), |item| item.name);
    let connected = local.connected();
    let mut props = SelectProps::dynamic(title, options.clone());
    props.flat = true;
    props.skip_filter = true;
    props.current = local.standard();
    props.search_in_title = true;
    props.title_placeholder = Some("Search models".to_owned());
    props.on_select = Some(Rc::new(bind!(local, |local, option: &SelectOption<Model>| choose(&local, &option.value))));
    let connect = Rc::new(bind!(local, |local| connect(&local)));
    let provider_title = if connected { "connect integration" } else { "view all integrations" };
    let favorite_title = bind!(local, |local, option: Option<&SelectOption<Model>>| {
        let favorite = option.is_some_and(|option| local.is_favorite(&option.value));
        String::from(if favorite { "unfavorite" } else { "favorite" })
    }, else String::from("favorite"));
    props.actions = vec![
        SelectAction {
            run: ActionRun::Dialog(connect),
            ..SelectAction::new("model.dialog.provider", provider_title, |_| {})
        },
        SelectAction {
            title: Rc::new(favorite_title),
            ..SelectAction::new("model.dialog.favorite", "Favorite", {
                bind!(local, |local, option| local.toggle_favorite(&option.value))
            })
        },
    ];
    let (view, handle) = select::select(cx, props);
    if !filter.is_empty() && !cx.rebuilt() {
        handle.set_filter(filter);
    }

    // Refresh the rows as the catalog, the favorites, or the connections change. When the connected state would
    // change the footer, the dialog opens again with the same filter.
    let reopened = Rc::new(Cell::new(false));
    cx.on_close(local.subscribe(bind!(local, |local| {
        if reopened.get() {
            return;
        }
        if local.connected() != connected {
            reopened.set(true);
            let integration = integration.clone();
            let again = local.clone();
            let filter = handle.filter();
            local.app.defer(move |_| open(&again, integration, filter));
            return;
        }
        catalog.take();
        handle.set_options(options(&handle.filter()));
    })));
    view
}

impl Catalog {
    fn new(local: &Local, integration: Option<&str>, favorites_at_open: &[Model], marker: Color) -> Self {
        let index = local.model_index();
        local
            .providers(|providers| Self::of(local, index.as_deref(), providers, integration, favorites_at_open, marker))
    }

    fn of(
        local: &Local,
        index: Option<&ModelIndex>,
        providers: &[ProviderInfo],
        integration: Option<&str>,
        favorites_at_open: &[Model],
        marker: Color,
    ) -> Self {
        let connected = local.connected();
        let sections = connected && integration.is_none();
        let favorites: Vec<Model> = if connected { favorites_at_open.to_vec() } else { Vec::new() };
        let favorite_now = local.favorite();
        let recents = local.recent();
        fn key(item: &Model) -> (&str, &str) {
            (item.provider_id.as_str(), item.model_id.as_str())
        }
        let favorites_set: HashSet<(&str, &str)> = favorites.iter().map(key).collect();
        let favorite_now_set: HashSet<(&str, &str)> = favorite_now.iter().map(key).collect();
        let priority_set: HashSet<(&str, &str)> = favorites_at_open.iter().map(key).collect();
        let recents_set: HashSet<(&str, &str)> = recents.iter().map(key).collect();
        let providers_by_id: HashMap<&str, &ProviderInfo> =
            providers.iter().map(|provider| (provider.id.0.as_str(), provider)).collect();
        let provider_of = |id: &str| providers_by_id.get(id).copied();
        let provider_name = |id: &str| provider_of(id).map_or_else(|| id.to_owned(), |provider| provider.name.clone());
        let section = |items: &[Model], category: &str| -> Vec<SelectOption<Model>> {
            if !sections {
                return Vec::new();
            }
            let Some(index) = index else { return Vec::new() };
            items
                .iter()
                .filter_map(|item| {
                    let model = index.get(&item.provider_id, &item.model_id)?;
                    let mut option = SelectOption::new(model.name.clone(), Model::new(&model.provider_id.0, &model.id))
                        .description(provider_name(&model.provider_id.0))
                        .category(category);
                    marked(&mut option, favorite_now_set.contains(&key(item)), marker);
                    Some(option)
                })
                .collect()
        };
        let favorite_options = section(&favorites, "Favorites");
        let recent_items: Vec<Model> =
            recents.iter().filter(|item| !favorites_set.contains(&key(item))).cloned().collect();
        let recent_options = section(&recent_items, "Recent");

        // OpenCode's own free models get their own group at the end of the list instead of joining "OpenCode".
        let free_group =
            |model: &ModelInfo| integration.is_none() && model.provider_id.0 == "opencode" && is_free(model);
        let mut rows: Vec<Row> = index
            .map(ModelIndex::models)
            .unwrap_or_default()
            .iter()
            .filter(|model| !matches!(model.status, ModelInfoStatus::Deprecated))
            .filter(|model| {
                integration.is_none_or(|id| {
                    model.provider_id.0 == id
                        || provider_of(&model.provider_id.0)
                            .and_then(|provider| provider.integration_id.as_ref())
                            .is_some_and(|item| item.0 == id)
                })
            })
            // A model's faster and slower speeds are chosen with the speed selector.
            .filter(|model| index.is_none_or(|index| !index.is_speed(model)))
            .map(|model| {
                let model_key = (model.provider_id.0.as_str(), model.id.as_str());
                let name = provider_name(&model.provider_id.0);
                Row {
                    value: Model::new(&model.provider_id.0, &model.id),
                    provider_name: name.clone(),
                    title: model.name.clone(),
                    category: connected.then(|| if free_group(model) { "Free".to_owned() } else { name }),
                    favorite: favorite_now_set.contains(&model_key),
                    free: is_free(model),
                    pinned: favorites_set.contains(&model_key) || recents_set.contains(&model_key),
                    priority: priority_set.contains(&model_key),
                }
            })
            .collect();
        sort_rows(&mut rows, connected);
        let targets = fuzzy::Targets::new(&rows, |row| [Some(row.title.as_str()), row.category.as_deref()]);
        Self { connected, sections, favorites: favorite_options, recents: recent_options, rows, targets, marker }
    }

    fn options(&self, query: &str) -> Vec<SelectOption<Model>> {
        let needle = query.trim();
        if !needle.is_empty() {
            let matches = fuzzy::go_prepared(needle, &self.targets, |_, score, _| score, 0.0, usize::MAX);
            let mut results: Vec<&Row> = matches.into_iter().map(|index| &self.rows[index]).collect();
            sort_rows(&mut results, false);
            results.sort_by_key(|row| !row.priority);
            return results
                .into_iter()
                .map(|row| {
                    // Search results name the provider inline. Without a category, the trailing slot keeps the
                    // favorite marker instead of falling back to the provider name.
                    let mut option = SelectOption::new(row.title.clone(), row.value.clone());
                    option.description = Some(row.provider_name.clone());
                    marked(&mut option, row.favorite, self.marker);
                    option
                })
                .collect();
        }
        let whitespace = !query.is_empty();
        let option = |row: &Row| {
            let mut option = SelectOption::new(row.title.clone(), row.value.clone());
            option.category = row.category.clone();
            if whitespace {
                option.search_description = Some(row.provider_name.clone());
                option.search_footer = Some(if row.favorite { "*".to_owned() } else { String::new() });
            }
            marked(&mut option, row.favorite, self.marker);
            option
        };
        if !self.connected {
            let mut rows: Vec<&Row> = self.rows.iter().collect();
            rows.sort_by_key(|row| !row.priority);
            return rows.into_iter().map(option).collect();
        }
        let listed = self.rows.iter().filter(|row| !self.sections || !row.pinned);
        let (free, paid): (Vec<&Row>, Vec<&Row>) = listed.partition(|row| row.category.as_deref() == Some("Free"));
        self.favorites
            .iter()
            .chain(&self.recents)
            .cloned()
            .chain(paid.into_iter().map(option))
            .chain(free.into_iter().map(option))
            .collect()
    }
}

/// Marks a favorite in the trailing slot, which only marks favorites.
fn marked(option: &mut SelectOption<Model>, favorite: bool, marker: Color) {
    if favorite {
        option.footer = Some("*".to_owned());
        option.footer_fg = Some(marker);
    }
}

/// `ModelDetail`: the selected model's price (unless `price` is false), input modalities, context window, and
/// reasoning support, below the list. Only the free models picker shows it.
pub fn detail(model: &ModelInfo, price: bool) -> select::Detail {
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
        if price {
            row.add(&Text::new(app, cost.as_str()).fg(theme.text.muted).wrap(WrapMode::None));
        } else {
            row.justify(Justify::Start);
        }
        row.add(&list(facts));
        row.as_any()
    }))
}

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

pub fn connect(local: &Rc<Local>) {
    crate::dialogs::integration::show(local, Some(crate::dialogs::integration::show_models()));
}

pub fn install(tui: &Rc<Tui>) {
    let local = tui.local.clone();
    let command = |id: &str, run: fn(&Rc<Local>)| {
        TuiCommand::new(id, bind!(local, |local, _, _| run(&local))).bind(Bind::Off).group("Agent")
    };
    let slash = |name: &str, aliases: &[&str]| Slash::new(name).aliases(aliases.iter().copied());
    let has_speeds = opentui::keymap::Condition::when(bind!(local, |local| !local.speeds().is_empty()));
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
        .palette_when(opentui::keymap::Condition::when(bind!(local, |local| !local.variants().is_empty())))
        .slash(slash("variants", &["thinking", "effort"])),
        // Only for a model that has other speeds, so nothing about speeds shows for the rest.
        command("speed.cycle", |local| local.cycle_speed()).title("Speed cycle").palette().enabled(has_speeds.clone()),
        command("speed.list", crate::dialogs::speed::show)
            .title("Switch model speed")
            .palette()
            .enabled(has_speeds)
            .slash(slash("speed", &["fast"])),
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

/// Apply startup agent and model choices when their catalogs and saved preferences are available.
pub fn startup(local: &Rc<Local>, agent: Option<String>, model: Option<Model>) {
    if agent.is_none() && model.is_none() {
        return;
    }
    local.startup_agent.replace(agent.clone());
    local.startup_model.replace(model.clone());
    let pending = Rc::new(RefCell::new(Some((agent, model))));
    let listener: Rc<RefCell<Option<Disposer>>> = Rc::default();
    let apply = {
        let pending = pending.clone();
        let listener = listener.clone();
        bind!(local, |local| {
            if !local.ready() || !local.catalog_ready() || local.agents().is_empty() {
                return;
            }
            let Some((agent, model)) = pending.borrow_mut().take() else { return };
            drop(listener.borrow_mut().take());
            if let Some(agent) = agent {
                local.set_agent(&agent);
            }
            // A session opened at startup keeps its own model; the flag still updates recents.
            match model {
                Some(model) if local.route().is_some() => local.add_recent_valid(&model),
                Some(model) => local.set(&model, true),
                None => {}
            }
        })
    };
    *listener.borrow_mut() = Some(local.subscribe(apply.clone()));
    apply();
}

/// Warn once per model as it approaches and reaches a limit.
pub fn usage_alerts(local: &Local) {
    use crate::dialogs::usage::{Level, format_dollars, format_reset, level};
    if local.route().is_none() {
        return;
    }
    let Some((model, usage)) = local.current_usage() else { return };
    let level = level(&usage, &model);
    if level == Level::Plenty {
        return;
    }
    let reached = level == Level::Reached;
    let key = format!("{}/{}:{}", model.provider_id.0, model.id, if reached { "reached" } else { "low" });
    if !local.warned.borrow_mut().insert(key) {
        return;
    }
    let toast = if reached {
        ToastOptions::new(Variant::Error, format!("Resets {}", format_reset(usage.resets_at)))
            .title(format!("{} limit reached", model.name))
            .action("Switch model", bind!(local.this, |local| show(&local, None)))
    } else {
        ToastOptions::new(
            Variant::Warning,
            format!("{} left · resets {}", format_dollars(usage.left), format_reset(usage.resets_at)),
        )
        .title(format!("Running low on {}", model.name))
        .action("View usage", bind!(local.this, |local| crate::dialogs::usage::show(&local)))
    };
    local.toasts.show(toast);
}

/// The agent and model the prompt shows and submits: what the user chose here (`useLocal`), once this
/// state has its catalog.
pub fn prompt_selection(tui: &Tui) -> Option<crate::prompt::metadata::Selection> {
    let local = &tui.local;
    let agent = local.agent().filter(|_| local.catalog_ready())?;
    let model = local.selection().map(|selection| crate::prompt::metadata::Choice {
        provider_id: selection.model.provider_id,
        model_id: selection.model.model_id,
        variant: selection.variant,
    });
    Some(crate::prompt::metadata::Selection { agent, model })
}
