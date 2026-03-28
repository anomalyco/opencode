#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Backend {
    Auto,
    Wayland,
    X11,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackendDecision {
    pub backend: Backend,
    pub note: String,
}

#[derive(Debug, Clone, Default)]
pub struct SessionEnv {
    pub wayland_display: bool,
    pub xdg_session_type: Option<String>,
    pub display: bool,
    pub xdg_current_desktop: Option<String>,
    pub xdg_session_desktop: Option<String>,
    pub desktop_session: Option<String>,
    pub oc_allow_wayland: Option<String>,
    pub oc_force_x11: Option<String>,
    pub oc_force_wayland: Option<String>,
    pub oc_linux_decorations: Option<String>,
    pub oc_force_decorations: Option<String>,
    pub oc_no_decorations: Option<String>,
    pub i3_sock: bool,
}

impl SessionEnv {
    pub fn capture() -> Self {
        Self {
            wayland_display: std::env::var_os("WAYLAND_DISPLAY").is_some(),
            xdg_session_type: std::env::var("XDG_SESSION_TYPE").ok(),
            display: std::env::var_os("DISPLAY").is_some(),
            xdg_current_desktop: std::env::var("XDG_CURRENT_DESKTOP").ok(),
            xdg_session_desktop: std::env::var("XDG_SESSION_DESKTOP").ok(),
            desktop_session: std::env::var("DESKTOP_SESSION").ok(),
            oc_allow_wayland: std::env::var("OC_ALLOW_WAYLAND").ok(),
            oc_force_x11: std::env::var("OC_FORCE_X11").ok(),
            oc_force_wayland: std::env::var("OC_FORCE_WAYLAND").ok(),
            oc_linux_decorations: std::env::var("OC_LINUX_DECORATIONS").ok(),
            oc_force_decorations: std::env::var("OC_FORCE_DECORATIONS").ok(),
            oc_no_decorations: std::env::var("OC_NO_DECORATIONS").ok(),
            i3_sock: std::env::var_os("I3SOCK").is_some(),
        }
    }
}

pub fn select_backend(env: &SessionEnv, prefer_wayland: bool) -> Option<BackendDecision> {
    if is_truthy(env.oc_force_x11.as_deref()) {
        return Some(BackendDecision {
            backend: Backend::X11,
            note: "Forcing X11 due to OC_FORCE_X11=1".into(),
        });
    }

    if is_truthy(env.oc_force_wayland.as_deref()) {
        return Some(BackendDecision {
            backend: Backend::Wayland,
            note: "Forcing native Wayland due to OC_FORCE_WAYLAND=1".into(),
        });
    }

    if !is_wayland_session(env) {
        return None;
    }

    if prefer_wayland {
        return Some(BackendDecision {
            backend: Backend::Wayland,
            note: "Wayland session detected; forcing native Wayland from settings".into(),
        });
    }

    if is_truthy(env.oc_allow_wayland.as_deref()) {
        return Some(BackendDecision {
            backend: Backend::Wayland,
            note: "Wayland session detected; forcing native Wayland due to OC_ALLOW_WAYLAND=1"
                .into(),
        });
    }

    Some(BackendDecision {
        backend: Backend::Auto,
        note: "Wayland session detected; using native Wayland first with X11 fallback (auto backend). Set OC_FORCE_X11=1 to force X11."
            .into(),
    })
}

pub fn use_decorations(env: &SessionEnv) -> bool {
    if let Some(mode) = decoration_override(env.oc_linux_decorations.as_deref()) {
        return match mode {
            DecorationOverride::Native => true,
            DecorationOverride::None => false,
            DecorationOverride::Auto => default_use_decorations(env),
        };
    }

    if is_truthy(env.oc_force_decorations.as_deref()) {
        return true;
    }
    if is_truthy(env.oc_no_decorations.as_deref()) {
        return false;
    }

    default_use_decorations(env)
}

fn default_use_decorations(env: &SessionEnv) -> bool {
    if is_known_tiling_session(env) {
        return false;
    }
    if !is_wayland_session(env) {
        return true;
    }
    is_full_desktop_session(env)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DecorationOverride {
    Auto,
    Native,
    None,
}

fn decoration_override(value: Option<&str>) -> Option<DecorationOverride> {
    let value = value?.trim().to_ascii_lowercase();
    if matches!(value.as_str(), "auto") {
        return Some(DecorationOverride::Auto);
    }
    if matches!(
        value.as_str(),
        "native" | "server" | "de" | "wayland" | "on" | "true" | "1"
    ) {
        return Some(DecorationOverride::Native);
    }
    if matches!(
        value.as_str(),
        "none" | "off" | "false" | "0" | "client" | "csd"
    ) {
        return Some(DecorationOverride::None);
    }
    None
}

fn is_truthy(value: Option<&str>) -> bool {
    matches!(
        value.map(|v| v.trim().to_ascii_lowercase()),
        Some(v) if matches!(v.as_str(), "1" | "true" | "yes" | "on")
    )
}

fn is_wayland_session(env: &SessionEnv) -> bool {
    env.wayland_display
        || matches!(
            env.xdg_session_type.as_deref(),
            Some(value) if value.eq_ignore_ascii_case("wayland")
        )
}

fn is_full_desktop_session(env: &SessionEnv) -> bool {
    desktop_tokens(env).any(|value| {
        matches!(
            value.as_str(),
            "gnome"
                | "kde"
                | "plasma"
                | "xfce"
                | "xfce4"
                | "x-cinnamon"
                | "cinnamon"
                | "mate"
                | "lxqt"
                | "budgie"
                | "pantheon"
                | "deepin"
                | "unity"
                | "cosmic"
        )
    })
}

fn is_known_tiling_session(env: &SessionEnv) -> bool {
    if env.i3_sock {
        return true;
    }

    desktop_tokens(env).any(|value| {
        matches!(
            value.as_str(),
            "niri"
                | "sway"
                | "swayfx"
                | "hyprland"
                | "river"
                | "i3"
                | "i3wm"
                | "bspwm"
                | "dwm"
                | "qtile"
                | "xmonad"
                | "leftwm"
                | "dwl"
                | "awesome"
                | "herbstluftwm"
                | "spectrwm"
                | "worm"
                | "i3-gnome"
        )
    })
}

fn desktop_tokens<'a>(env: &'a SessionEnv) -> impl Iterator<Item = String> + 'a {
    [
        env.xdg_current_desktop.as_deref(),
        env.xdg_session_desktop.as_deref(),
        env.desktop_session.as_deref(),
    ]
    .into_iter()
    .flatten()
    .flat_map(|desktop| desktop.split(':'))
    .map(|value| value.trim().to_ascii_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_wayland_first_on_wayland_session() {
        let env = SessionEnv {
            wayland_display: true,
            display: true,
            ..Default::default()
        };

        let decision = select_backend(&env, false).expect("missing decision");
        assert_eq!(decision.backend, Backend::Auto);
    }

    #[test]
    fn force_x11_override_wins() {
        let env = SessionEnv {
            wayland_display: true,
            display: true,
            oc_force_x11: Some("1".into()),
            oc_allow_wayland: Some("1".into()),
            oc_force_wayland: Some("1".into()),
            ..Default::default()
        };

        let decision = select_backend(&env, true).expect("missing decision");
        assert_eq!(decision.backend, Backend::X11);
    }

    #[test]
    fn prefer_wayland_forces_wayland_backend() {
        let env = SessionEnv {
            wayland_display: true,
            display: true,
            ..Default::default()
        };

        let decision = select_backend(&env, true).expect("missing decision");
        assert_eq!(decision.backend, Backend::Wayland);
    }

    #[test]
    fn force_wayland_override_works_outside_wayland_session() {
        let env = SessionEnv {
            display: true,
            oc_force_wayland: Some("1".into()),
            ..Default::default()
        };

        let decision = select_backend(&env, false).expect("missing decision");
        assert_eq!(decision.backend, Backend::Wayland);
    }

    #[test]
    fn allow_wayland_forces_wayland_backend() {
        let env = SessionEnv {
            wayland_display: true,
            display: true,
            oc_allow_wayland: Some("1".into()),
            ..Default::default()
        };

        let decision = select_backend(&env, false).expect("missing decision");
        assert_eq!(decision.backend, Backend::Wayland);
    }

    #[test]
    fn xdg_session_type_wayland_is_detected() {
        let env = SessionEnv {
            xdg_session_type: Some("wayland".into()),
            ..Default::default()
        };

        let decision = select_backend(&env, false).expect("missing decision");
        assert_eq!(decision.backend, Backend::Auto);
    }

    #[test]
    fn returns_none_when_not_wayland_and_no_overrides() {
        let env = SessionEnv {
            display: true,
            xdg_current_desktop: Some("GNOME".into()),
            ..Default::default()
        };

        assert!(select_backend(&env, false).is_none());
    }

    #[test]
    fn prefer_wayland_setting_does_not_override_x11_session() {
        let env = SessionEnv {
            display: true,
            xdg_current_desktop: Some("GNOME".into()),
            ..Default::default()
        };

        assert!(select_backend(&env, true).is_none());
    }

    #[test]
    fn disables_decorations_on_niri() {
        let env = SessionEnv {
            xdg_current_desktop: Some("niri".into()),
            wayland_display: true,
            ..Default::default()
        };

        assert!(!use_decorations(&env));
    }

    #[test]
    fn keeps_decorations_on_gnome() {
        let env = SessionEnv {
            xdg_current_desktop: Some("GNOME".into()),
            wayland_display: true,
            ..Default::default()
        };

        assert!(use_decorations(&env));
    }

    #[test]
    fn disables_decorations_when_session_desktop_is_tiling() {
        let env = SessionEnv {
            xdg_session_desktop: Some("Hyprland".into()),
            wayland_display: true,
            ..Default::default()
        };

        assert!(!use_decorations(&env));
    }

    #[test]
    fn disables_decorations_for_unknown_wayland_session() {
        let env = SessionEnv {
            xdg_current_desktop: Some("labwc".into()),
            wayland_display: true,
            ..Default::default()
        };

        assert!(!use_decorations(&env));
    }

    #[test]
    fn disables_decorations_for_dwm_on_x11() {
        let env = SessionEnv {
            xdg_current_desktop: Some("dwm".into()),
            display: true,
            ..Default::default()
        };

        assert!(!use_decorations(&env));
    }

    #[test]
    fn disables_decorations_for_i3_on_x11() {
        let env = SessionEnv {
            xdg_current_desktop: Some("i3".into()),
            display: true,
            ..Default::default()
        };

        assert!(!use_decorations(&env));
    }

    #[test]
    fn disables_decorations_for_i3sock_without_xdg_tokens() {
        let env = SessionEnv {
            display: true,
            i3_sock: true,
            ..Default::default()
        };

        assert!(!use_decorations(&env));
    }

    #[test]
    fn keeps_decorations_for_gnome_on_x11() {
        let env = SessionEnv {
            xdg_current_desktop: Some("GNOME".into()),
            display: true,
            ..Default::default()
        };

        assert!(use_decorations(&env));
    }

    #[test]
    fn no_decorations_override_wins() {
        let env = SessionEnv {
            xdg_current_desktop: Some("GNOME".into()),
            oc_no_decorations: Some("1".into()),
            ..Default::default()
        };

        assert!(!use_decorations(&env));
    }

    #[test]
    fn linux_decorations_native_override_wins() {
        let env = SessionEnv {
            xdg_current_desktop: Some("niri".into()),
            wayland_display: true,
            oc_linux_decorations: Some("native".into()),
            ..Default::default()
        };

        assert!(use_decorations(&env));
    }

    #[test]
    fn linux_decorations_none_override_wins() {
        let env = SessionEnv {
            xdg_current_desktop: Some("GNOME".into()),
            wayland_display: true,
            oc_linux_decorations: Some("none".into()),
            ..Default::default()
        };

        assert!(!use_decorations(&env));
    }

    #[test]
    fn linux_decorations_auto_uses_default_policy() {
        let env = SessionEnv {
            xdg_current_desktop: Some("sway".into()),
            wayland_display: true,
            oc_linux_decorations: Some("auto".into()),
            ..Default::default()
        };

        assert!(!use_decorations(&env));
    }

    #[test]
    fn linux_decorations_override_beats_legacy_overrides() {
        let env = SessionEnv {
            xdg_current_desktop: Some("GNOME".into()),
            wayland_display: true,
            oc_linux_decorations: Some("none".into()),
            oc_force_decorations: Some("1".into()),
            ..Default::default()
        };

        assert!(!use_decorations(&env));
    }
}
