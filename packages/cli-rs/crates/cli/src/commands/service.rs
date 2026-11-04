//! `service`: the background server (C.8).
//!
//! Ports `packages/cli/src/commands/handlers/service/*.ts` and the stop/ensure calls of
//! `services/service-config.ts`. The commands act on the service this client uses: the one discovery
//! finds (O-21), else the one registered for the client's channel. They stop it only because the user
//! asked: `stop`, `restart`, and every `set`/`unset` that TS stops for. `set remote true` runs the TS
//! command, which creates the OpenTunnel tunnel (D.1).

use std::path::PathBuf;
use std::sync::Arc;

use opencode_api::transport::{Reqwest, Transport};
use opencode_local::channel::Channels;
use opencode_local::paths::Paths;
use opencode_local::registration;
use opencode_local::service_config::{Edit, ServiceConfig};
use opencode_service::connect::{self, Env};
use opencode_service::delegate;
use opencode_service::discover::{self, Found};
use opencode_service::stop::{self, Poll, Pty};
use opencode_service::ts_command::TsCommand;

use super::Context;
use super::client::block_on;
use crate::args::{ServiceArgs, ServiceCommand};
use crate::output::{Exit, print};

pub fn run(_context: &Context, args: &ServiceArgs) -> anyhow::Result<()> {
    let Some(command) = &args.command else {
        return crate::help::print(&["service"]);
    };
    let local = Local::from_env()?;
    match command {
        ServiceCommand::Start => {
            print(&(block_on(local.ensure())??.service.endpoint.url + "\n"))
        }
        ServiceCommand::Restart => print(&(block_on(local.restart())?? + "\n")),
        ServiceCommand::Status => {
            let found = block_on(local.discover())?;
            print(&(found.map_or("stopped".into(), |found| found.service.endpoint.url) + "\n"))
        }
        ServiceCommand::Stop => block_on(local.stop(true))?,
        ServiceCommand::Get(get) => {
            print(&(local.config().get(get.key.as_deref(), get.name.as_deref())? + "\n"))
        }
        ServiceCommand::Set(set) => {
            let edit = Edit::set(&set.key, &set.value, set.env_value.as_deref())?;
            if edit.needs_tunnel() {
                // The TS command creates the tunnel in the foreground, then stops the service and writes
                // the route; a tunnel that cannot be created leaves remote access off.
                return match delegate::enable_remote(&TsCommand::from_env())? {
                    0 => Ok(()),
                    code => Err(Exit(u8::try_from(code).unwrap_or(1)).into()),
                };
            }
            local.edit(&edit)
        }
        ServiceCommand::Unset(unset) => local.edit(&Edit::unset(&unset.key, unset.name.as_deref())?),
    }
}

/// The paths, environment, and channel the service commands work in.
pub struct Local {
    pub paths: Paths,
    pub env: Env,
    pub channel: String,
    transport: Arc<dyn Transport>,
}

impl Local {
    pub fn from_env() -> anyhow::Result<Self> {
        Ok(Self::new(Paths::from_env()?, Env::from_env()))
    }

    pub fn new(paths: Paths, env: Env) -> Self {
        let channel = Channels::from_vars(|name| match name {
            "OPENCODE_CHANNEL" => env.channel.clone().map(Into::into),
            _ => None,
        })
        .channel;
        Self {
            paths,
            env,
            channel,
            transport: Arc::new(Reqwest::default()),
        }
    }

    pub fn config(&self) -> ServiceConfig {
        ServiceConfig::new(&self.paths, &self.channel)
    }

    pub fn transport(&self) -> Arc<dyn Transport> {
        self.transport.clone()
    }

    /// The ready service this client would use (`Service.discover` without a version).
    pub async fn discover(&self) -> Option<Found> {
        discover::discover(
            self.transport.as_ref(),
            &self.paths,
            self.env.channel.as_deref(),
        )
        .await
        .ok()
    }

    /// A ready service, started quietly when none runs (`Service.ensure`).
    pub async fn ensure(&self) -> anyhow::Result<Found> {
        Ok(connect::reconnect(self.transport.clone(), &self.paths, &self.env).await?)
    }

    /// `ServerConnection.shutdownPersistentPty` (when `terminals`), then `Service.stop`. The registration
    /// stopped is the discovered service's, else one that is still starting, else the client channel's.
    pub async fn stop(&self, terminals: bool) -> anyhow::Result<()> {
        let file = match discover::discover(
            self.transport.as_ref(),
            &self.paths,
            self.env.channel.as_deref(),
        )
        .await
        {
            Ok(found) => {
                if terminals {
                    // An explicit stop ends the persistent terminals; only a restart through the TUI hands
                    // them over. TS ignores a failure here.
                    let _ =
                        stop::shutdown_persistent_pty(self.transport.clone(), &found.service.endpoint)
                            .await;
                }
                found.file
            }
            Err(missing) => missing.pending.unwrap_or_else(|| self.file()),
        };
        stop::stop(self.transport.clone(), &file, Pty::Clear, Poll::default()).await?;
        Ok(())
    }

    async fn restart(&self) -> anyhow::Result<String> {
        self.stop(true).await?;
        Ok(self.ensure().await?.service.endpoint.url)
    }

    /// `ServiceConfig.set` or `unset` for every key but `remote true`: stops the service first when TS
    /// does, then writes the file.
    pub fn edit(&self, edit: &Edit) -> anyhow::Result<()> {
        if edit.stops_service() {
            block_on(self.stop(false))??;
        }
        self.config().apply(edit)?;
        Ok(())
    }

    fn file(&self) -> PathBuf {
        registration::Files::new(&self.paths, &self.channel).file
    }
}
