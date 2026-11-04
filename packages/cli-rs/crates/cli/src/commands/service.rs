//! `service`: the background server.

use super::{Context, not_built};
use crate::args::{ServiceArgs, ServiceCommand};

pub fn run(_context: &Context, args: &ServiceArgs) -> anyhow::Result<()> {
    match &args.command {
        None => crate::help::print(&["service"]),
        Some(ServiceCommand::Start) => not_built("service start", "C.8"),
        Some(ServiceCommand::Restart) => not_built("service restart", "C.8"),
        Some(ServiceCommand::Status) => not_built("service status", "C.8"),
        Some(ServiceCommand::Stop) => not_built("service stop", "C.8"),
        Some(ServiceCommand::Get(_)) => not_built("service get", "C.8"),
        Some(ServiceCommand::Set(_)) => not_built("service set", "C.8"),
        Some(ServiceCommand::Unset(_)) => not_built("service unset", "C.8"),
    }
}
