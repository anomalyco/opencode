//! `machine add`, `machine list` and `machine remove`: remote machines through the experimental API of `--server`
//! or the background service. Every failure prints one line to stderr and exits 1, as TS's `reportMachineError`.

use std::io::IsTerminal;

use opencode_api::client::Client;
use opencode_api::error::Error as ApiError;
use opencode_api::generated::{
    ConflictError, ExperimentalMachineAddInput, ExperimentalMachineRemoveInput, ForbiddenError, InvalidRequestError,
    MachineInfo, MachineInvite, MachineInviteReachItem, MachineNotFoundError, MachineReach, tag,
};
use opencode_util::time::{Zone, now_ms};
use opencode_util::{bail, error};
use serde::Deserialize;

use super::Context;
use super::client::{Connected, block_on, connect};
use super::pair::{is_loopback, server_urls};
use super::service::Local;
use super::stats::js_round;
use crate::args::{MachineArgs, MachineCommand};
use crate::output::{Exit, print};

/// `MACHINE_LINK_PATH`.
const LINK_PATH: &str = "/api/experimental/machine/link";

/// The `machine.add` reply as a server from before `Machine.Invite`'s `reach` also sends it.
#[derive(Deserialize)]
struct Added {
    data: AddedInvite,
}

#[derive(Deserialize)]
struct AddedInvite {
    name: String,
    join: String,
    expires: i64,
    reach: Option<Vec<MachineInviteReachItem>>,
}

pub fn run(context: &Context, args: &MachineArgs) -> error::Result<()> {
    let Some(command) = &args.command else { return crate::help::print(&["machine"]) };
    let name = match command {
        MachineCommand::Add(add) => Some(add.name.as_str()),
        MachineCommand::Remove(remove) => Some(remove.name.as_str()),
        MachineCommand::List => None,
    };
    let Err(error) = block_on(machine(context, command)).and_then(|result| result) else { return Ok(()) };
    eprintln!("{}", message(&error, name));
    Err(Exit(1).into())
}

async fn machine(context: &Context, command: &MachineCommand) -> error::Result<()> {
    let connected = client(context).await?;
    let client = &connected.client;
    match command {
        MachineCommand::Add(args) => {
            let reach = reach(&server_urls(client, args.url.as_deref()).await?);
            let input = ExperimentalMachineAddInput {
                name: args.name.clone(),
                reach: reach.clone(),
                replace: args.replace.then_some(true),
            };
            let added: Added = client.json(Client::experimental_machine_add_call(&input)?).await?;
            let invite = MachineInvite {
                name: added.data.name,
                join: added.data.join,
                expires: added.data.expires,
                // A server from before this field existed returns none; show what was sent.
                reach: added.data.reach.unwrap_or_else(|| reach.into_iter().map(MachineInviteReachItem::Url).collect()),
            };
            print(&add_text(&invite, std::io::stdout().is_terminal(), now_ms(), Zone::Local))
        }
        MachineCommand::List => print(&format!("{}\n", list_text(&client.experimental_machine_list().await?))),
        MachineCommand::Remove(args) => {
            client.experimental_machine_remove(&ExperimentalMachineRemoveInput { name: args.name.clone() }).await?;
            print(&format!("Removed machine {}.\n", args.name))
        }
    }
}

/// `ensureMachineClient`: the `--server` given, else the background service, started if needed.
async fn client(context: &Context) -> error::Result<Connected> {
    if context.server.standalone {
        bail!("--standalone starts a server for this command only; a machine needs one that keeps running.");
    }
    let disabled = Local::from_env()?.config().read()?.disabled == Some(true);
    if context.server.server.is_none() && disabled {
        bail!("Managing machines requires the background service; run `opencode service unset disabled` first.");
    }
    connect(context).await
}

/// `machineReach`: each server URL's link address over ws(s), reachable ones first, loopback ones last, once each.
fn reach(urls: &[String]) -> Vec<MachineReach> {
    let parsed: Vec<(String, bool)> = urls
        .iter()
        .filter_map(|raw| {
            let mut url = opencode_api::js::join_url(&opencode_api::js::parse_url(raw).ok()?, LINK_PATH).ok()?;
            // As `url.protocol = ...`, a scheme the URL cannot take leaves it as it was.
            let _ = url.set_scheme(if url.scheme() == "https" { "wss" } else { "ws" });
            let loopback = is_loopback(url.host_str().unwrap_or(""));
            Some((String::from(url), loopback))
        })
        .collect();
    let ordered = parsed.iter().filter(|entry| !entry.1).chain(parsed.iter().filter(|entry| entry.1));
    let mut seen: Vec<&str> = Vec::new();
    for (href, _) in ordered {
        if !seen.contains(&href.as_str()) {
            seen.push(href);
        }
    }
    seen.into_iter().map(|url| MachineReach { r#type: tag::Url, url: url.into() }).collect()
}

/// `formatMachineAdd`: only the join string when stdout is not a terminal.
fn add_text(invite: &MachineInvite, tty: bool, now: i64, zone: Zone) -> String {
    if !tty {
        return format!("{}\n", invite.join);
    }
    let addresses = match invite.reach.is_empty() {
        true => vec!["  (none)".to_string()],
        false => invite.reach.iter().map(|entry| format!("  {}", address(entry))).collect(),
    };
    let reachable = |entry: &MachineInviteReachItem| match entry {
        MachineInviteReachItem::Url(entry) => {
            opencode_api::js::parse_url(&entry.url).is_ok_and(|url| !is_loopback(url.host_str().unwrap_or("")))
        }
        _ => false,
    };
    let access = if invite.reach.iter().any(|entry| matches!(entry, MachineInviteReachItem::Iroh(_))) {
        "Works from any network."
    } else if invite.reach.iter().any(reachable) {
        "Works from computers that can reach one of these addresses."
    } else {
        "Only works on this computer. Pass --url with an address other computers can reach."
    };
    let lines = [
        format!("Machine: {}", invite.name),
        expiry(invite.expires, now, zone),
        String::new(),
        invite.join.clone(),
        String::new(),
        access.into(),
        "Addresses:".into(),
    ];
    lines.into_iter().chain(addresses).collect::<Vec<_>>().join("\n") + "\n"
}

/// `entry.type === "iroh" ? "iroh" : entry.url`.
fn address(entry: &MachineInviteReachItem) -> &str {
    match entry {
        MachineInviteReachItem::Url(entry) => &entry.url,
        MachineInviteReachItem::Iroh(_) => "iroh",
        MachineInviteReachItem::Unknown(value) => {
            value.get("url").and_then(serde_json::Value::as_str).unwrap_or("undefined")
        }
    }
}

fn expiry(expires: i64, now: i64, zone: Zone) -> String {
    let minutes = js_round((expires - now).max(0) as f64 / 60_000.0) as i64;
    let at = zone.at(expires).map(|date| date.two_digit_time()).unwrap_or_default();
    match minutes {
        0 => format!("Expires in less than a minute (at {at})."),
        1 => format!("Expires in 1 minute (at {at})."),
        _ => format!("Expires in {minutes} minutes (at {at})."),
    }
}

/// `formatMachineList`: name, pairing, connection, then platform and how a connected machine connects.
fn list_text(machines: &[MachineInfo]) -> String {
    let paired = |machine: &MachineInfo| if machine.paired { "paired" } else { "waiting" };
    let online = |machine: &MachineInfo| if machine.online { "connected" } else { "offline" };
    let Some(name_width) = machines.iter().map(|machine| machine.id.len()).max() else {
        return "No machines added.".into();
    };
    let paired_width = machines.iter().map(|machine| paired(machine).len()).max().unwrap_or(0);
    let online_width = machines.iter().map(|machine| online(machine).len()).max().unwrap_or(0);
    machines
        .iter()
        .map(|machine| {
            // `os && arch ? os/arch : (os ?? arch)`: an empty part counts as missing only in the first test, so an
            // empty platform still takes its place among the details.
            let platform = match (&machine.os, &machine.arch) {
                (Some(os), Some(arch)) if !os.is_empty() && !arch.is_empty() => Some(format!("{os}/{arch}")),
                (Some(os), _) => Some(os.clone()),
                (None, arch) => arch.clone(),
            };
            let carrier = machine.connection.as_ref().filter(|_| machine.online).map(|connection| {
                let path = connection.path.as_ref().map(|path| path.as_str().to_string());
                let rtt = connection.rtt.map(|rtt| format!("{}ms", js_round(rtt) as i64));
                [Some(connection.kind.as_str().to_string()), path, rtt]
                    .into_iter()
                    .flatten()
                    .collect::<Vec<_>>()
                    .join(" ")
            });
            let details = [platform, carrier].into_iter().flatten().collect::<Vec<_>>().join("  ");
            let (id, paired, online) = (&machine.id, paired(machine), online(machine));
            match details.is_empty() {
                true => format!("{id:name_width$}  {paired:paired_width$}  {online}"),
                false => format!("{id:name_width$}  {paired:paired_width$}  {online:online_width$}  {details}"),
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// `formatMachineError`: the server's refusals with what to do about them, else the error's message.
fn message(error: &error::Error, name: Option<&str>) -> String {
    let Some(api) = error.downcast_ref::<ApiError>() else { return error.to_string() };
    let Some(declared) = api.declared() else { return api.error_message() };
    let quote = |text: &str| serde_json::to_string(text).unwrap_or_default();
    if declared.is::<ForbiddenError>() {
        return "Machines are experimental and disabled on this server. Turn them on with OPENCODE_FLAGS=machines or experimental.machines: true in your config.".into();
    }
    if declared.decode::<InvalidRequestError>().is_ok_and(|invalid| invalid.kind.as_deref() == Some("invalid_name")) {
        let label = name.map_or_else(|| "That name".to_string(), quote);
        return format!(
            "{label} is not a valid machine name. Use lowercase letters, digits, and hyphens, starting with a letter, 2 to 63 characters, and not \"local\"."
        );
    }
    if let Ok(missing) = declared.decode::<MachineNotFoundError>() {
        return format!("No machine named {}.", quote(name.unwrap_or(&missing.machine)));
    }
    if let Ok(conflict) = declared.decode::<ConflictError>() {
        let label = name
            .or(conflict.resource.as_deref())
            .map_or_else(|| "This machine".to_string(), |target| format!("Machine {}", quote(target)));
        return format!(
            "{label} is already paired. Pass --replace to issue a new join string; once the new computer joins, the computer currently paired stops being able to connect."
        );
    }
    api.error_message()
}

#[cfg(test)]
mod tests {
    use super::*;
    use opencode_api::error::DeclaredError;
    use serde_json::json;

    fn urls(reach: &[MachineReach]) -> Vec<&str> {
        reach.iter().map(|entry| entry.url.as_str()).collect()
    }

    /// machine.test.ts "machine reach".
    #[test]
    fn reach_puts_reachable_addresses_first_over_ws() {
        let servers = [
            "http://127.0.0.1:4096",
            "http://localhost:4096",
            "http://10.0.0.8:4096",
            "https://example.com",
            "http://[::1]:4096",
            "https://example.com/",
            "https://gpu.example.com:8443",
        ];
        assert_eq!(
            urls(&reach(&servers.map(String::from))),
            [
                "ws://10.0.0.8:4096/api/experimental/machine/link",
                "wss://example.com/api/experimental/machine/link",
                "wss://gpu.example.com:8443/api/experimental/machine/link",
                "ws://127.0.0.1:4096/api/experimental/machine/link",
                "ws://localhost:4096/api/experimental/machine/link",
                "ws://[::1]:4096/api/experimental/machine/link",
            ]
        );
    }

    /// machine.test.ts "machine output formatting".
    #[test]
    fn add_prints_the_join_string_alone_off_a_terminal() {
        let reach = invite_reach(json!([{ "type": "url", "url": "wss://example.com/api/experimental/machine/link" }]));
        let invite = MachineInvite { name: "gpu".into(), join: "ocjoin_example".into(), expires: 0, reach };
        // 2026-01-01T12:00:00Z.
        let now = 1_767_268_800_000;
        let at = |ms: i64| MachineInvite { expires: now + ms, ..invite.clone() };
        let utc = Zone::Fixed(0);
        assert_eq!(add_text(&at(300_000), false, now, utc), "ocjoin_example\n");
        assert_eq!(
            add_text(&at(300_000), true, now, utc),
            "Machine: gpu\nExpires in 5 minutes (at 12:05 PM).\n\nocjoin_example\n\nWorks from computers that can reach one of these addresses.\nAddresses:\n  wss://example.com/api/experimental/machine/link\n"
        );
        let none = |ms: i64| MachineInvite { reach: Vec::new(), ..at(ms) };
        let soon = add_text(&none(60_000), true, now, utc);
        assert!(soon.contains("in 1 minute (at 12:01 PM).\n\nocjoin_example\n\nOnly works on this computer. Pass --url with an address other computers can reach.\nAddresses:\n  (none)\n"), "{soon}");
        // 00:59:59.999 at UTC-11: past expiries count as now, and hour 0 reads 12.
        let past = add_text(&none(-1), true, now, Zone::Fixed(-3600 * 11));
        assert!(past.contains("less than a minute (at 12:59 AM)."), "{past}");
    }

    fn invite_reach(value: serde_json::Value) -> Vec<MachineInviteReachItem> {
        serde_json::from_value(value).unwrap()
    }

    /// machine.test.ts "explains invite reach".
    #[test]
    fn add_says_who_can_join() {
        let loopback: Vec<_> = ["localhost", "127.0.0.1", "[::1]"]
            .iter()
            .map(|host| json!({ "type": "url", "url": format!("ws://{host}:4096") }))
            .collect();
        let cases = [
            (
                json!([{ "type": "url", "url": "ws://localhost:4096" }, { "type": "iroh" }]),
                "Works from any network.",
                vec!["ws://localhost:4096", "iroh"],
            ),
            (
                json!([{ "type": "url", "url": "wss://example.com" }]),
                "Works from computers that can reach one of these addresses.",
                vec!["wss://example.com"],
            ),
            (
                json!(loopback),
                "Only works on this computer. Pass --url with an address other computers can reach.",
                vec!["ws://localhost:4096", "ws://127.0.0.1:4096", "ws://[::1]:4096"],
            ),
        ];
        for (reach, sentence, addresses) in cases {
            let invite = MachineInvite {
                name: "gpu".into(),
                join: "ocjoin_example".into(),
                expires: 300_000,
                reach: invite_reach(reach),
            };
            let output = add_text(&invite, true, 0, Zone::Fixed(0));
            assert!(output.contains(&format!("{sentence}\nAddresses:\n")), "{output}");
            for address in addresses {
                assert!(output.contains(&format!("  {address}\n")), "{output}");
            }
            assert_eq!(add_text(&invite, false, 0, Zone::Fixed(0)), "ocjoin_example\n");
        }
    }

    /// machine.test.ts "prints connection".
    #[test]
    fn list_says_how_a_connected_machine_connects() {
        let cases = [
            (json!({ "kind": "websocket" }), "websocket"),
            (json!({ "kind": "iroh" }), "iroh"),
            (json!({ "kind": "iroh", "path": "direct", "rtt": 81.6 }), "iroh direct 82ms"),
            (json!({ "kind": "iroh", "path": "relayed", "rtt": 123 }), "iroh relayed 123ms"),
            (json!({ "kind": "iroh", "path": "direct", "rtt": 0 }), "iroh direct 0ms"),
        ];
        for (connection, label) in cases {
            let info = |value| serde_json::from_value::<MachineInfo>(value).unwrap();
            let online = info(
                json!({ "id": "gpu", "paired": true, "online": true, "os": "linux", "arch": "x64", "connection": connection }),
            );
            assert_eq!(list_text(&[online]), format!("gpu  paired  connected  linux/x64  {label}"));
            let offline = info(json!({ "id": "gpu", "paired": true, "online": false, "connection": connection }));
            assert_eq!(list_text(&[offline]), "gpu  paired  offline");
        }
        // An empty platform still holds its place before the connection, as `[platform, carrier].join("  ")`.
        let bare = serde_json::from_value::<MachineInfo>(
            json!({ "id": "pi", "paired": true, "online": true, "os": "", "connection": { "kind": "iroh" } }),
        )
        .unwrap();
        assert_eq!(list_text(&[bare]), "pi  paired  connected    iroh");
    }

    #[test]
    fn list_aligns_its_columns() {
        assert_eq!(list_text(&[]), "No machines added.");
        let machine = |id: &str, paired, online, os: Option<&str>, arch: Option<&str>| MachineInfo {
            id: id.into(),
            paired,
            online,
            os: os.map(Into::into),
            arch: arch.map(Into::into),
            connection: None,
        };
        let machines = [
            machine("gpu", true, true, Some("linux"), Some("x64")),
            machine("laptop", true, false, None, None),
            machine("worker", false, false, None, None),
            machine("mac", true, false, Some("darwin"), None),
            machine("pi", true, false, Some(""), Some("arm64")),
        ];
        assert_eq!(
            list_text(&machines),
            [
                "gpu     paired   connected  linux/x64",
                "laptop  paired   offline",
                "worker  waiting  offline",
                "mac     paired   offline    darwin",
                "pi      paired   offline",
            ]
            .join("\n")
        );
    }

    #[test]
    fn errors_say_what_to_do() {
        let declared = |status, body| error::Error::new(ApiError::Declared(Box::new(DeclaredError::new(status, body))));
        let forbidden = declared(403, json!({ "_tag": "ForbiddenError", "message": "disabled" }));
        assert!(message(&forbidden, None).contains("OPENCODE_FLAGS=machines or experimental.machines: true"));
        let invalid = declared(400, json!({ "_tag": "InvalidRequestError", "kind": "invalid_name", "message": "bad" }));
        assert!(message(&invalid, Some("Bad")).starts_with("\"Bad\" is not a valid machine name."));
        assert!(message(&invalid, None).contains("That name is not a valid machine name. Use lowercase letters, digits, and hyphens, starting with a letter, 2 to 63 characters"));
        let other = declared(400, json!({ "_tag": "InvalidRequestError", "message": "bad reach" }));
        assert_eq!(message(&other, Some("gpu")), "bad reach");
        let conflict = declared(409, json!({ "_tag": "ConflictError", "resource": "gpu", "message": "paired" }));
        assert!(message(&conflict, None).starts_with("Machine \"gpu\" is already paired. Pass --replace"));
        assert!(message(&conflict, Some("gpu")).ends_with("stops being able to connect."));
        let anonymous = declared(409, json!({ "_tag": "ConflictError", "message": "paired" }));
        assert!(message(&anonymous, None).starts_with("This machine is already paired."));
        let missing = declared(404, json!({ "_tag": "MachineNotFoundError", "machine": "x", "message": "missing" }));
        assert_eq!(message(&missing, Some("x")), "No machine named \"x\".");
        assert_eq!(message(&opencode_util::err!("plain failure"), None), "plain failure");
    }
}
