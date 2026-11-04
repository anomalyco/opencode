//! Port of the project, location, catalog, VCS, credential, and websearch cases of
//! `packages/client/test/solid-data.test.ts`, plus forms, shells, and the optimistic session's
//! project. The typed client decodes every response, so fixtures add required fields the TS
//! fixtures leave out (`project` on locations, `time.active` on projects).

mod common;

use std::sync::{Arc, Mutex};

use common::*;
use opencode_api::generated::*;
use opencode_store::{Catalog, CreateSession, Location, Options};
use serde_json::{Value, json};

fn at(directory: &str) -> Location {
    Location::new(directory)
}

fn public(directory: &str) -> Value {
    json!({ "directory": directory, "project": { "id": directory, "directory": directory, "canonical": directory } })
}

fn model(name: &str) -> Value {
    json!({
        "id": "chat", "modelID": "chat", "providerID": "company", "name": name,
        "capabilities": { "tools": true, "input": ["text"], "output": ["text"] },
        "variants": [], "time": { "released": 0 }, "cost": [], "status": "active", "enabled": true,
        "limit": { "context": 8192, "output": 1024 },
    })
}

fn provider(name: &str) -> Value {
    json!({ "id": "company", "name": name, "activation": "enabled", "package": "aisdk:@ai-sdk/openai" })
}

fn located(kind: &str, directory: &str) -> Value {
    json!({ "id": format!("evt_{kind}_{directory}"), "created": 1, "type": kind, "location": { "directory": directory }, "data": {} })
}

fn session(id: &str, project: &str, directory: &str) -> SessionInfo {
    serde_json::from_value(json!({
        "id": id, "projectID": project, "cost": 0,
        "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
        "time": { "created": 0, "updated": 0 }, "location": { "directory": directory },
    }))
    .unwrap()
}

/// Requests as (path, `location[directory]`).
type Requests = Log<(String, Option<String>)>;

fn recorded(requests: &Requests, req: &Req) {
    requests.push((
        req.path.clone(),
        req.param("location[directory]").map(str::to_owned),
    ));
}

fn sorted(mut values: Vec<(String, Option<String>)>) -> Vec<(String, Option<String>)> {
    values.sort();
    values
}

fn pair(path: &str, directory: &str) -> (String, Option<String>) {
    (path.to_owned(), Some(directory.to_owned()))
}

fn name<T: serde::Serialize>(items: Option<&Vec<T>>) -> Option<String> {
    let value = serde_json::to_value(items?.first()?).ok()?;
    value["name"].as_str().map(str::to_owned)
}

#[tokio::test]
async fn updates_authoritative_cached_project_metadata_from_live_events() {
    let project = |id: &str, canonical: &str, name: Option<&str>, updated: u64| {
        let mut value = json!({
            "id": id, "canonical": canonical, "time": { "created": 1, "updated": updated, "active": 1 },
            "sandboxes": [],
        });
        if let Some(name) = name {
            value["name"] = json!(name);
        }
        value
    };
    let original = project(
        "project_renamed",
        "/projects/original",
        Some("Original custom name"),
        1,
    );
    let unrelated = project(
        "project_unrelated",
        "/projects/unrelated",
        Some("Unrelated project"),
        1,
    );
    let requests = Log::<String>::default();
    let (log, list) = (requests.clone(), json!([original, unrelated]));
    let data = data(
        handler(move |req: Req| {
            log.push(req.path.clone());
            let list = list.clone();
            async move { ok(list) }
        }),
        Options::default(),
    );
    let get = |id: &str| data.read(|state| state.project(&ProjectID(id.into())).cloned());
    let decoded = |value: &Value| serde_json::from_value::<Project>(value.clone()).unwrap();

    data.project_sync().await.unwrap();
    assert_eq!(get("project_renamed"), Some(decoded(&original)));

    emit(
        &data,
        json!({
            "id": "evt_project_renamed", "created": 2, "type": "project.updated",
            "data": project("project_renamed", "/projects/renamed", Some("Updated custom name"), 2),
        }),
    );
    let renamed = get("project_renamed").unwrap();
    assert_eq!(renamed.canonical.0, "/projects/renamed");
    assert_eq!(renamed.name.as_deref(), Some("Updated custom name"));
    assert_eq!(get("project_unrelated"), Some(decoded(&unrelated)));

    emit(
        &data,
        json!({
            "id": "evt_project_name_reset", "created": 3, "type": "project.updated",
            "data": project("project_renamed", "/projects/renamed-again", None, 3),
        }),
    );
    let reset = get("project_renamed").unwrap();
    assert_eq!(reset.canonical.0, "/projects/renamed-again");
    assert_eq!(reset.name, None);
    assert_eq!(get("project_unrelated"), Some(decoded(&unrelated)));
    assert_eq!(requests.get(), ["/api/project"]);
}

#[tokio::test]
async fn adopts_cached_directory_project_sessions_when_their_repository_is_resolved() {
    let data = data(
        handler(|req: Req| async move {
            assert_eq!(req.path, "/api/session/ses_uncached");
            let mut refreshed =
                serde_json::to_value(session("ses_uncached", "repository", "/unknown-alias"))
                    .unwrap();
            refreshed["subpath"] = json!("app");
            ok(json!({ "data": refreshed }))
        }),
        Options {
            directory: "/repo".into(),
            ..Default::default()
        },
    );
    for (id, project, directory) in [
        ("ses_root", "directory-root", "/repo"),
        ("ses_nested", "directory-nested", "/repo/app"),
        ("ses_alias", "directory-nested", "/repo/alias/../app"),
        ("ses_symlink", "directory-nested", "/shortcut"),
        ("ses_uncached", "directory-uncached", "/unknown-alias"),
        ("ses_global", "global", "/repo/legacy"),
        ("ses_escaped", "global", "/repo/../other"),
        ("ses_other", "other-repository", "/repo/vendor"),
        ("ses_sibling", "global", "/repo-other"),
        ("ses_remote", "directory-root", "/repo"),
    ] {
        data.remember(session(id, project, directory));
    }
    for (id, canonical) in [
        ("directory-root", "/repo"),
        ("directory-nested", "/repo/app"),
    ] {
        emit(
            &data,
            json!({
                "id": format!("evt_{id}"), "created": 0, "type": "project.updated",
                "data": { "id": id, "canonical": canonical, "time": { "created": 0, "updated": 0, "active": 0 }, "sandboxes": [] },
            }),
        );
    }
    emit(
        &data,
        json!({
            "id": "evt_repository_resolved", "created": 1, "type": "worktree.resolved",
            "durable": { "aggregateID": "repository", "seq": 0, "version": 1 },
            "data": {
                "projectID": "repository", "directory": "/repo", "previous": "global",
                "adopted": ["directory-root", "directory-nested", "directory-uncached"],
            },
        }),
    );
    let get = |id: &str| {
        data.read(|state| {
            let info = state.session(&SessionID(id.into())).unwrap();
            (
                info.project_id.0.clone(),
                info.subpath.as_ref().map(|path| path.0.clone()),
            )
        })
    };
    let adopted = |subpath: Option<&str>| ("repository".to_owned(), subpath.map(str::to_owned));
    assert_eq!(get("ses_root"), adopted(None));
    assert_eq!(get("ses_nested"), adopted(Some("app")));
    assert_eq!(get("ses_alias"), adopted(Some("app")));
    assert_eq!(get("ses_symlink"), adopted(Some("app")));
    assert_eq!(get("ses_global"), adopted(Some("legacy")));
    assert_eq!(get("ses_escaped").0, "global");
    assert_eq!(get("ses_other").0, "other-repository");
    assert_eq!(get("ses_sibling").0, "global");
    assert_eq!(get("ses_remote").0, "repository");
    wait(|| get("ses_uncached").0 == "repository").await;
    assert_eq!(get("ses_uncached"), adopted(Some("app")));
}

#[tokio::test]
async fn refreshes_global_credential_events_across_every_loaded_location() {
    let requests = Requests::default();
    let log = requests.clone();
    let data = data(
        handler(move |req: Req| {
            recorded(&log, &req);
            let directory = req
                .param("location[directory]")
                .unwrap_or("/project")
                .to_owned();
            async move { ok(json!({ "location": public(&directory), "data": [] })) }
        }),
        Options::default(),
    );
    let locations = [at("/project"), at("/other")];
    for location in &locations {
        for catalog in [
            Catalog::Integration,
            Catalog::Model,
            Catalog::Provider,
            Catalog::Reference,
        ] {
            data.catalog_sync(catalog, Some(location)).await.unwrap();
        }
    }
    let references = |location: &Location| {
        data.read(|state| state.location(Some(location)).unwrap().reference.clone())
    };
    let before: Vec<_> = locations.iter().map(references).collect();
    requests.0.lock().unwrap().clear();

    emit(
        &data,
        json!({ "id": "evt_credential.updated", "created": 1, "type": "credential.updated", "data": {} }),
    );
    wait(|| requests.len() == 2).await;
    assert_eq!(
        sorted(requests.get()),
        [
            pair("/api/integration", "/other"),
            pair("/api/integration", "/project")
        ]
    );
    requests.0.lock().unwrap().clear();

    for credential in [json!("credential"), Value::Null] {
        emit(
            &data,
            json!({
                "id": format!("evt_credential.switched.{credential}"), "created": 2, "type": "credential.switched",
                "data": { "credentialID": credential, "integrationID": "integration" },
            }),
        );
        wait(|| requests.len() == 4).await;
        assert_eq!(
            sorted(requests.get()),
            [
                pair("/api/model", "/other"),
                pair("/api/model", "/project"),
                pair("/api/provider", "/other"),
                pair("/api/provider", "/project"),
            ]
        );
        let after: Vec<_> = locations.iter().map(references).collect();
        assert_eq!(after, before);
        requests.0.lock().unwrap().clear();
    }
}

async fn refreshes_only_the_named_location(resource: &str) {
    let requests = Requests::default();
    let current = Arc::new(Mutex::new("Before".to_owned()));
    let (log, name_now) = (requests.clone(), current.clone());
    let data = data(
        handler(move |req: Req| {
            recorded(&log, &req);
            let directory = req
                .param("location[directory]")
                .unwrap_or("/project")
                .to_owned();
            let name = name_now.lock().unwrap().clone();
            async move {
                let item = match req.path.as_str() {
                    "/api/provider" => provider(&name),
                    "/api/model" => model(&name),
                    path => panic!("unexpected request: {path}"),
                };
                ok(json!({ "location": public(&directory), "data": [item] }))
            }
        }),
        Options::default(),
    );
    let (project, other) = (at("/project"), at("/other"));
    for location in [&project, &other] {
        data.catalog_sync(Catalog::Provider, Some(location))
            .await
            .unwrap();
        data.catalog_sync(Catalog::Model, Some(location))
            .await
            .unwrap();
    }
    let names = |location: &Location| {
        data.read(|state| {
            let data = state.location(Some(location)).unwrap();
            (name(data.provider.as_ref()), name(data.model.as_ref()))
        })
    };
    requests.0.lock().unwrap().clear();
    *current.lock().unwrap() = "After".into();
    emit(&data, located(&format!("{resource}.updated"), "/project"));

    let after = Some("After".to_owned());
    let before = Some("Before".to_owned());
    let expected = match resource {
        "provider" => (after, before.clone()),
        _ => (before.clone(), after),
    };
    wait(|| names(&project) == expected).await;
    assert_eq!(
        requests.get(),
        [pair(&format!("/api/{resource}"), "/project")]
    );
    assert_eq!(names(&other), (before.clone(), before));
}

#[tokio::test]
async fn refreshes_provider_values_only_at_the_location_named_by_provider_updated() {
    refreshes_only_the_named_location("provider").await;
}

#[tokio::test]
async fn refreshes_model_values_only_at_the_location_named_by_model_updated() {
    refreshes_only_the_named_location("model").await;
}

#[tokio::test]
async fn ignores_catalog_updates_for_unloaded_locations_while_refreshing_loaded_locations() {
    let requests = Requests::default();
    let version = Arc::new(Mutex::new("v1".to_owned()));
    let (log, current) = (requests.clone(), version.clone());
    let data = data(
        handler(move |req: Req| {
            recorded(&log, &req);
            let directory = req
                .param("location[directory]")
                .unwrap_or("/project")
                .to_owned();
            let version = current.lock().unwrap().clone();
            async move {
                let body = match req.path.as_str() {
                    "/api/vcs" => json!({ "branch": { "current": "main", "default": "main" } }),
                    "/api/provider" => json!([provider(&version)]),
                    "/api/model" => json!([model(&version)]),
                    "/api/command" => {
                        json!([{ "name": version, "source": "command", "template": "run", "hints": [] }])
                    }
                    "/api/agent" => json!([{
                        "id": version, "name": version, "mode": "primary", "hidden": false,
                        "request": { "settings": {}, "headers": {}, "body": {} }, "permissions": [],
                    }]),
                    path => panic!("unexpected request: {path}"),
                };
                ok(json!({ "location": public(&directory), "data": body }))
            }
        }),
        Options::default(),
    );
    let (loaded, vcs_only) = (at("/project"), at("/vcs-only"));
    for catalog in [
        Catalog::Provider,
        Catalog::Model,
        Catalog::Command,
        Catalog::Agent,
    ] {
        data.catalog_sync(catalog, Some(&loaded)).await.unwrap();
    }
    data.catalog_sync(Catalog::Vcs, Some(&vcs_only))
        .await
        .unwrap();
    requests.0.lock().unwrap().clear();
    *version.lock().unwrap() = "v2".into();

    let kinds = [
        "provider.updated",
        "model.updated",
        "command.updated",
        "agent.updated",
    ];
    for directory in ["/vcs-only", "/unloaded"] {
        for kind in kinds {
            emit(&data, located(kind, directory));
        }
    }
    settle().await;
    assert!(requests.get().is_empty());

    for kind in kinds {
        emit(&data, located(kind, "/project"));
    }
    wait(|| {
        data.read(|state| {
            let data = state.location(Some(&loaded)).unwrap();
            let v2 = Some("v2".to_owned());
            name(data.provider.as_ref()) == v2
                && name(data.model.as_ref()) == v2
                && name(data.command.as_ref()) == v2
                && name(data.agent.as_ref()) == v2
        })
    })
    .await;
    assert_eq!(
        requests.get(),
        [
            pair("/api/provider", "/project"),
            pair("/api/model", "/project"),
            pair("/api/command", "/project"),
            pair("/api/agent", "/project"),
        ]
    );
}

#[tokio::test]
async fn revalidates_model_discovery_when_an_update_overtakes_an_in_flight_model_list() {
    let started = Slot::<()>::default();
    let release = Slot::<()>::default();
    let requests = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let (signal, wait_for, count) = (started.clone(), release.clone(), requests.clone());
    let data = data(
        handler(move |req: Req| {
            assert_eq!(req.path, "/api/model");
            let initial = count.fetch_add(1, std::sync::atomic::Ordering::SeqCst) == 0;
            let (signal, release) = (signal.clone(), wait_for.wait());
            async move {
                if initial {
                    signal.resolve(());
                    release.await;
                }
                let name = if initial {
                    "Before discovery"
                } else {
                    "Discovered model"
                };
                ok(json!({ "location": { "directory": "/project" }, "data": [model(name)] }))
            }
        }),
        Options::default(),
    );
    let initial = data.catalog_sync(Catalog::Model, None);
    started.wait().await;
    emit(&data, located("model.updated", "/project"));
    release.resolve(());
    initial.await.unwrap();
    wait(|| {
        data.read(|state| {
            state
                .location(None)
                .and_then(|data| name(data.model.as_ref()))
        }) == Some("Discovered model".into())
    })
    .await;
    assert_eq!(requests.load(std::sync::atomic::Ordering::SeqCst), 2);
}

#[tokio::test]
async fn refreshes_references_for_the_location_an_update_names() {
    let requests = Requests::default();
    let log = requests.clone();
    let data = data(
        handler(move |req: Req| {
            recorded(&log, &req);
            let directory = req
                .param("location[directory]")
                .unwrap_or("/project")
                .to_owned();
            async move { ok(json!({ "location": public(&directory), "data": [] })) }
        }),
        Options::default(),
    );
    data.catalog_sync(Catalog::Reference, None).await.unwrap();
    data.catalog_sync(Catalog::Reference, Some(&at("/other")))
        .await
        .unwrap();
    requests.0.lock().unwrap().clear();
    emit(&data, located("reference.updated", "/other"));
    wait(|| requests.len() == 1).await;
    assert_eq!(requests.get(), [pair("/api/reference", "/other")]);
}

#[tokio::test]
async fn reloads_vcs_info_when_the_branch_changes() {
    // A location's first read can land before its VCS provider loads, and so has no branches.
    let responses = Arc::new(Mutex::new(vec![
        json!({ "branch": {} }),
        json!({ "provider": "git", "branch": { "current": "feature", "default": "dev" } }),
    ]));
    let data = data(
        handler(move |_req: Req| {
            let next = responses.lock().unwrap().remove(0);
            async move { ok(json!({ "location": { "directory": "/worktree" }, "data": next })) }
        }),
        Options {
            directory: "/worktree".into(),
            ..Default::default()
        },
    );
    let vcs = || {
        data.read(|state| {
            state
                .location(None)
                .and_then(|data| data.vcs.clone())
                .map(|vcs| serde_json::to_value(vcs).unwrap())
        })
    };
    data.catalog_sync(Catalog::Vcs, None).await.unwrap();
    assert_eq!(vcs(), Some(json!({ "branch": {} })));
    emit(
        &data,
        json!({
            "id": "evt_vcs.branch.updated", "created": 1, "type": "vcs.branch.updated",
            "location": { "directory": "/worktree" }, "data": { "branch": "feature" },
        }),
    );
    wait(|| vcs().is_some_and(|vcs| vcs["provider"] == "git")).await;
    assert_eq!(
        vcs(),
        Some(json!({ "provider": "git", "branch": { "current": "feature", "default": "dev" } }))
    );
}

#[tokio::test]
async fn preserves_sibling_catalogs_through_location_preload_branch_shell_and_websearch_updates() {
    let requests = Log::<String>::default();
    let branch = Arc::new(Mutex::new("main".to_owned()));
    let (log, current) = (requests.clone(), branch.clone());
    let data = data(
        handler(move |req: Req| {
            log.push(req.path.clone());
            let branch = current.lock().unwrap().clone();
            async move {
                let location = public("/project");
                match req.path.as_str() {
                    "/api/session/active" => ok(json!({})),
                    "/api/project" => ok(json!([])),
                    "/api/location" => ok(location),
                    "/api/vcs" => ok(json!({
                        "location": location, "data": { "branch": { "current": branch, "default": "main" } },
                    })),
                    "/api/reference" => ok(json!({
                        "location": location,
                        "data": [{ "name": "docs", "path": "/docs", "source": { "type": "local", "path": "/docs" } }],
                    })),
                    "/api/websearch/provider" => ok(json!({
                        "location": location, "data": [{ "id": "search", "name": "Search" }],
                    })),
                    path => panic!("unexpected request: {path}"),
                }
            }
        }),
        Options::default(),
    );
    let shell = |id: &str| {
        json!({
            "id": id, "status": "running", "command": "echo hello", "cwd": "/project", "shell": "/bin/sh",
            "file": "/shell-output", "metadata": {}, "time": { "started": 1 },
        })
    };
    let shell_event = |kind: &str, data: Value| json!({ "id": format!("evt_{kind}"), "created": 1, "type": kind, "location": public("/project"), "data": data });
    let first = ShellID("sh_first".into());
    let references =
        || data.read(|state| state.location(None).and_then(|data| data.reference.clone()));
    let shells = || {
        data.read(|state| {
            state
                .shells(None)
                .iter()
                .map(|shell| shell.info.id.0.clone())
                .collect::<Vec<_>>()
        })
    };

    // A live event may arrive before any location read populated the location.
    emit(
        &data,
        shell_event("shell.created", json!({ "info": shell("sh_first") })),
    );
    let created = data.read(|state| state.shell(&first).cloned()).unwrap();
    assert_eq!(created.info.command, "echo hello");
    data.catalog_sync(Catalog::Reference, None).await.unwrap();
    data.catalog_sync(Catalog::Vcs, None).await.unwrap();
    let loaded = references();
    assert_eq!(
        loaded
            .iter()
            .flatten()
            .map(|reference| (reference.name.clone(), reference.path.0.clone()))
            .collect::<Vec<_>>(),
        [("docs".to_owned(), "/docs".to_owned())]
    );
    assert_eq!(
        data.read(|state| state.shell(&first).cloned()),
        Some(created.clone())
    );

    *branch.lock().unwrap() = "feature".into();
    emit(
        &data,
        shell_event("vcs.branch.updated", json!({ "branch": "feature" })),
    );
    let current = || {
        data.read(|state| {
            state
                .location(None)
                .and_then(|data| data.vcs.as_ref())
                .and_then(|vcs| vcs.branch.current.clone())
        })
    };
    wait(|| current().as_deref() == Some("feature")).await;
    assert_eq!(references(), loaded);
    emit(
        &data,
        shell_event("shell.created", json!({ "info": shell("sh_second") })),
    );
    assert_eq!(shells(), ["sh_first", "sh_second"]);
    assert_eq!(references(), loaded);
    emit(
        &data,
        shell_event("shell.deleted", json!({ "id": "sh_second" })),
    );
    assert_eq!(shells(), ["sh_first"]);
    assert_eq!(
        data.read(|state| state.shell(&first).cloned()),
        Some(created.clone())
    );

    data.websearch_refresh(None).await.unwrap();
    assert_eq!(
        data.read(|state| state.location(None).unwrap().websearch.clone())
            .unwrap()
            .iter()
            .map(|provider| provider.name.clone())
            .collect::<Vec<_>>(),
        ["Search"]
    );
    assert_eq!(references(), loaded);
    emit(
        &data,
        json!({ "id": "evt_connected", "created": 1, "type": "server.connected", "data": {} }),
    );
    wait(|| data.read(|state| state.location(None).unwrap().info.is_some())).await;
    wait(|| requests.get().iter().any(|path| path == "/api/project")).await;
    assert_eq!(references(), loaded);
    assert_eq!(
        data.read(|state| state.shell(&first).cloned()),
        Some(created)
    );
    assert_eq!(current().as_deref(), Some("feature"));
    let mut paths = requests.get();
    paths.sort();
    assert_eq!(
        paths,
        [
            "/api/location",
            "/api/project",
            "/api/reference",
            "/api/session/active",
            // The branch update reloads VCS info.
            "/api/vcs",
            "/api/vcs",
            "/api/websearch/provider",
        ]
    );
}

#[tokio::test]
async fn keeps_global_forms_per_location_and_settles_them_with_the_location_header() {
    let requests = Log::<(String, Option<String>)>::default();
    let log = requests.clone();
    let data = data(
        handler(move |req: Req| {
            log.push((
                req.path.clone(),
                req.header("x-opencode-directory").map(str::to_owned),
            ));
            async move {
                if req.method != "GET" {
                    return Reply::Json(
                        404,
                        json!({ "_tag": "FormNotFoundError", "id": "frm_global", "message": "gone" }),
                    );
                }
                ok(json!({ "location": { "directory": "/other dir" }, "data": [] }))
            }
        }),
        Options::default(),
    );
    let form = |id: &str, directory: &str| {
        json!({
            "id": format!("evt_{id}_{directory}"), "created": 1, "type": "form.created",
            "location": { "directory": directory },
            "data": { "form": { "id": id, "sessionID": "global", "title": "Sign in", "fields": [] } },
        })
    };
    // Form IDs are unique across locations: a repeated ID is dropped.
    emit(&data, form("frm_project", "/project"));
    emit(&data, form("frm_global", "/other dir"));
    emit(&data, form("frm_global", "/other dir"));
    emit(&data, form("frm_project", "/other dir"));
    let count = |directory: &str| {
        data.read(|state| {
            state
                .forms("global", Some(&at(directory)))
                .map(|forms| forms.len())
        })
    };
    assert_eq!(count("/project"), Some(1));
    assert_eq!(count("/other dir"), Some(1));
    assert!(data.read(|state| state.forms("global", None).is_none()));
    assert!(data.read(|state| state.form_sessions().is_empty()));

    data.form_cancel(
        SessionFormCancelInput {
            session_id: "global".into(),
            form_id: FormID("frm_global".into()),
            message: None,
        },
        Some(&at("/other dir")),
    )
    .await
    .unwrap();
    assert_eq!(count("/other dir"), Some(0));
    assert_eq!(count("/project"), Some(1));
    wait(|| requests.len() == 2).await;
    assert_eq!(
        requests.get(),
        [
            (
                "/api/session/global/form/frm_global".to_owned(),
                Some("%2Fother%20dir".to_owned())
            ),
            ("/api/form".to_owned(), None),
        ]
    );
}

#[tokio::test]
async fn an_optimistic_session_takes_the_project_of_its_location() {
    let data = data(
        handler(|req: Req| async move {
            match req.path.as_str() {
                "/api/location" => ok(json!({
                    "directory": "/project",
                    "project": { "id": "prj_known", "directory": "/project", "canonical": "/project" },
                })),
                _ => Reply::Fail("offline".into()),
            }
        }),
        Options::default(),
    );
    data.location_sync_info(None).await.unwrap();
    let (id, _request) = data.session_create(CreateSession::default());
    assert_eq!(
        data.read(|state| state.session(&id).map(|info| info.project_id.0.clone())),
        Some("prj_known".into())
    );
}
