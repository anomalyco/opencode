use anyhow::Context;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// User/project configuration, mirroring the original `pencode.json` schema.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub theme: Option<String>,
    pub model: Option<String>,
    pub small_model: Option<String>,
    #[serde(rename = "autoupdate")]
    pub autoupdate: bool,
    #[serde(skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub provider: std::collections::BTreeMap<String, ProviderConfig>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ProviderConfig {
    pub api_key: Option<String>,
    pub base_url: Option<String>,
}

impl Config {
    /// Global config at `$XDG_CONFIG_HOME/pencode/config.json`, overlaid by
    /// project-local `.pencode/config.json` when present.
    pub fn load() -> anyhow::Result<Self> {
        let mut config = Self::default();
        if let Some(global) = global_config_path() {
            config.merge_file(&global)?;
        }
        if let Ok(local) = Path::new(".pencode").join("config.json").metadata() {
            if local.is_file() {
                config.merge_file(Path::new(".pencode").join("config.json").as_path())?;
            }
        }
        Ok(config)
    }

    fn merge_file(&mut self, path: &Path) -> anyhow::Result<()> {
        let raw = match std::fs::read_to_string(path) {
            Ok(raw) => raw,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(err) => return Err(err).with_context(|| format!("reading {}", path.display())),
        };
        let incoming: Config = serde_json::from_str(&raw)
            .with_context(|| format!("parsing {}", path.display()))?;
        self.apply(incoming);
        Ok(())
    }

    fn apply(&mut self, other: Config) {
        if other.theme.is_some() {
            self.theme = other.theme;
        }
        if other.model.is_some() {
            self.model = other.model;
        }
        if other.small_model.is_some() {
            self.small_model = other.small_model;
        }
        if other.autoupdate {
            self.autoupdate = true;
        }
        for (name, provider) in other.provider {
            self.provider.insert(name, provider);
        }
    }
}

fn global_config_path() -> Option<PathBuf> {
    dirs::config_dir().map(|dir| dir.join("pencode").join("config.json"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_camel_case_fields() {
        let raw = r#"{"theme":"dark","model":"anthropic/claude-sonnet-4","autoupdate":true}"#;
        let cfg: Config = serde_json::from_str(raw).unwrap();
        assert_eq!(cfg.theme.as_deref(), Some("dark"));
        assert_eq!(cfg.model.as_deref(), Some("anthropic/claude-sonnet-4"));
        assert!(cfg.autoupdate);
    }

    #[test]
    fn missing_files_leave_defaults() {
        let mut cfg = Config::default();
        cfg.merge_file(Path::new("definitely/missing.json")).unwrap();
        assert!(cfg.model.is_none());
    }
}
