//! Resolves installed plugins without fetching anything. The package cache keys a registry spec by its requested
//! version or tag, and a git spec by its slug and a hash of the literal spec. Use the highest numbered generation.
//! Unclassified specs can have cache keys but must never be joined to the cache path.

use std::path::{Path, PathBuf};

use opencode_api_types::js::decode_component;

/// A package the cache holds.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Package {
    pub directory: PathBuf,
    pub name: String,
}

/// Why a plugin named by npm package `spec` is not loaded: the cache does not hold it, and `opencode-native` installs
/// nothing.
pub fn missing(spec: &str) -> String {
    format!(
        "not in opencode's package cache, and opencode-native installs nothing: run `opencode-native plugin add {spec}`"
    )
}

/// Resolves a registry or git spec to a package inside the cache. Only valid package names may be joined to the
/// generation directory.
pub fn resolve(spec: &str, cache: &Path) -> Option<Package> {
    let target = parse(spec)?;
    let root = cache.join("npm");
    let base = root.join(key(spec, Some(&target)));
    let base = generation(&base).unwrap_or(base);
    let name = target.name.or_else(|| first_dependency(&base)).unwrap_or(spec.to_owned());
    if !valid_name(&name) {
        return None;
    }
    // Real paths, without Windows' verbatim prefix: the JS host is handed this one.
    let directory = super::real(&base.join("node_modules").join(&name))?;
    let inside = super::real(&root).is_some_and(|root| directory.starts_with(root));
    (inside && directory.is_dir()).then_some(Package { directory, name })
}

/// The package `spec` names, where the spec itself says: a version, range or tag of a named package, or a git spec
/// with a name (`name@github:u/r`).
pub fn name(spec: &str) -> Option<String> {
    parse(spec)?.name
}

/// What `npm-package-arg` makes of a spec, as far as the key and the name go.
#[derive(Debug, PartialEq, Eq)]
struct Target {
    kind: Kind,
    name: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
enum Kind {
    /// A version, range or tag of `name`, and the spec part of the key.
    Registry(String),
    /// A git spec.
    Git,
}

/// The directory under `<cache>/npm` that holds the installs of `spec`.
pub fn cache_key(spec: &str) -> String {
    key(spec, parse(spec).as_ref())
}

/// Computes the key used by the shared npm cache.
fn key(spec: &str, target: Option<&Target>) -> String {
    match target {
        Some(Target { kind: Kind::Registry(range), name: Some(name) }) => sanitize(&format!("{name}@{range}")),
        Some(Target { kind: Kind::Git, .. }) => {
            let digest = ring::digest::digest(&ring::digest::SHA256, spec.as_bytes());
            let hex: String = digest.as_ref().iter().map(|byte| format!("{byte:02x}")).collect();
            format!("git-{}-{}", git_slug(spec), &hex[..12])
        }
        _ => sanitize(spec),
    }
}

/// Classifies installable registry and git specs.
fn parse(spec: &str) -> Option<Target> {
    match npa(spec).ok()? {
        Npa::Git(name) => Some(Target { kind: Kind::Git, name }),
        Npa::Registry(Some(name), raw) => {
            let range = if spec == name { "latest".to_owned() } else { raw };
            Some(Target { kind: Kind::Registry(range), name: Some(name) })
        }
        Npa::Registry(None, _) | Npa::Other => None,
    }
}

/// The type `npm-package-arg` 13 gives a spec, as far as `parse` reads it: git, a registry version, range or tag (with
/// its name, if any, and its raw spec), or another (a file, a directory, a URL, an alias). `Err` where it throws.
#[derive(Debug, PartialEq, Eq)]
enum Npa {
    Git(Option<String>),
    Registry(Option<String>, String),
    Other,
}

/// Refused by `npm-package-arg`.
struct Throws;

/// `npa(arg)` (`npm-package-arg/lib/npa.js`): where the name ends, then `resolve`.
fn npa(arg: &str) -> Result<Npa, Throws> {
    let name_ends = arg.get(1..).and_then(|rest| rest.find('@')).map(|index| index + 1);
    let name_part = name_ends.map_or(arg, |index| &arg[..index]);
    let (name, spec) = if is_url(arg) {
        (None, arg.to_owned())
    } else if is_scp(arg) {
        (None, format!("git+ssh://{arg}"))
    } else if !name_part.starts_with('@') && (has_slashes(name_part) || is_file_type(name_part)) {
        (None, arg.to_owned())
    } else if let Some(index) = name_ends {
        let spec = &arg[index + 1..];
        (Some(name_part.to_owned()), if spec.is_empty() { "*".to_owned() } else { spec.to_owned() })
    } else if valid_name(arg) {
        (Some(arg.to_owned()), "*".to_owned())
    } else {
        (None, arg.to_owned())
    };
    // `Result.setName`.
    if name.as_deref().is_some_and(|name| !valid_name(name)) {
        return Err(Throws);
    }
    let lower = spec.to_ascii_lowercase();
    if lower.starts_with("file:") || is_file_spec(&spec) || lower.starts_with("npm:") {
        return Ok(Npa::Other);
    }
    if let Some(committish) = hosted(&spec) {
        git_attrs(committish.as_deref())?;
        return Ok(Npa::Git(name));
    }
    if is_url(&spec) {
        return from_url(&spec).map(|git| if git { Npa::Git(name) } else { Npa::Other });
    }
    if has_slashes(&spec) || is_file_type(&spec) {
        return Ok(Npa::Other);
    }
    // `fromRegistry`: a version or a range, else a tag, which must be URI-safe.
    let trimmed = spec.trim_matches(js_space);
    if !semver_like(trimmed) && !uri_safe(trimmed) {
        return Err(Throws);
    }
    Ok(Npa::Registry(name, spec))
}

/// `isURL`: `^(?:git[+])?[a-z]+:`, any case.
fn is_url(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    let rest = lower.strip_prefix("git+").unwrap_or(&lower);
    let letters = rest.bytes().take_while(u8::is_ascii_lowercase).count();
    letters > 0 && rest.as_bytes().get(letters) == Some(&b':')
}

/// `isGit`: `^[^@]+@[^:.]+\.[^:]+:.+$`, an SCP-style `user@host.domain:path`.
fn is_scp(text: &str) -> bool {
    let Some((user, rest)) = text.split_once('@') else { return false };
    let Some(dot) = rest.find([':', '.']).filter(|at| *at > 0 && rest.as_bytes()[*at] == b'.') else { return false };
    let Some(colon) = rest[dot + 1..].find(':').filter(|at| *at > 0) else { return false };
    let path = &rest[dot + 1 + colon + 1..];
    !user.is_empty() && !path.is_empty() && !path.contains(['\n', '\r', '\u{2028}', '\u{2029}'])
}

/// `hasSlashes`: a `/`, or on Windows a `\` too.
fn has_slashes(text: &str) -> bool {
    text.contains('/') || (cfg!(windows) && text.contains('\\'))
}

/// `isFileType`: ends with `.tgz`, `.tar.gz` or `.tar`, any case.
fn is_file_type(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    [".tgz", ".tar.gz", ".tar"].iter().any(|end| lower.ends_with(end))
}

/// `isPosixFile` (`isWindowsFile` on Windows): starts with `.`, `~/`, `/`, a drive letter's `x:`, or on Windows `\`.
fn is_file_spec(text: &str) -> bool {
    let bytes = text.as_bytes();
    match bytes.first() {
        Some(b'.' | b'/') => true,
        Some(b'\\') => cfg!(windows),
        Some(b'~') => bytes.get(1) == Some(&b'/'),
        Some(letter) if letter.is_ascii_alphabetic() => bytes.get(1) == Some(&b':'),
        _ => false,
    }
}

/// `validate-npm-package-name` 7's `validForOldPackages`: no error, warnings (capitals, core module names, length, the
/// special characters) allowed.
fn valid_name(name: &str) -> bool {
    if name.is_empty()
        || name.starts_with(['.', '-', '_'])
        || name.trim_matches(js_space) != name
        || ["node_modules", "favicon.ico"].contains(&name.to_lowercase().as_str())
    {
        return false;
    }
    if uri_safe(name) {
        return true;
    }
    // `^(?:@([^/]+?)[/])?([^/]+?)$`: a scope and a name, each URI-safe; the name not starting with a period.
    let Some((scope, package)) = name.strip_prefix('@').and_then(|scoped| scoped.split_once('/')) else { return false };
    !scope.is_empty()
        && !package.is_empty()
        && !package.contains('/')
        && !package.starts_with('.')
        && uri_safe(scope)
        && uri_safe(package)
}

/// Whether `range` reads as a semver version or range (`semver.valid` or `semver.validRange`, loose), approximately:
/// what it lets through that `semver` refuses is a tag `npm-package-arg` refuses, which only keys and finds nothing.
fn semver_like(range: &str) -> bool {
    range.is_empty()
        || range.chars().any(|char| char.is_ascii_digit() || char == '*' || char == 'x' || char == 'X')
            && range.chars().all(|char| char.is_ascii_alphanumeric() || " .*xX^~<>=|-+".contains(char))
            && range.chars().next().is_some_and(|char| !char.is_ascii_alphabetic() || matches!(char, 'x' | 'X' | 'v'))
}

/// `encodeURIComponent(text) === text`.
fn uri_safe(text: &str) -> bool {
    text.chars().all(|char| char.is_ascii_alphanumeric() || "-_.!~*'()".contains(char))
}

/// JS's `\s` and what `trim` removes.
fn js_space(char: char) -> bool {
    (char.is_whitespace() && char != '\u{85}') || char == '\u{feff}'
}

/// `setGitAttrs`: a committish of `::` parts, each a committish, `semver:<range>` or `path:<dir>`, at most one of each
/// and not both a committish and a range; `Err` where it throws.
fn git_attrs(committish: Option<&str>) -> Result<(), Throws> {
    let Some(committish) = committish.filter(|committish| !committish.is_empty()) else { return Ok(()) };
    let (mut named, mut range, mut subdir) = (false, false, false);
    for part in committish.split("::") {
        let Some((name, value)) = part.split_once(':') else {
            if range || named {
                return Err(Throws);
            }
            named = true;
            continue;
        };
        let value = value.split(':').next().unwrap_or_default();
        match name {
            "semver" if named || range => return Err(Throws),
            "semver" => {
                decode_component(value).ok_or(Throws)?;
                range = true;
            }
            "path" if subdir => return Err(Throws),
            "path" => subdir = true,
            _ => {}
        }
    }
    Ok(())
}

/// `fromURL`: whether a URL spec is git (`git:`, `git+…:`, or `git+ssh://` SCP), not a remote tarball (`http:`,
/// `https:`); `Err` for any other protocol and for a URL `new URL` refuses.
fn from_url(spec: &str) -> Result<bool, Throws> {
    if let Some(rest) = spec.strip_prefix("git+ssh://") {
        // `^git\+ssh:\/\/([^:#]+:[^#]+(?:\.git)?)(?:#(.*))?$`, not with a port.
        let (address, fragment) = rest.split_once('#').map_or((rest, None), |(address, hash)| (address, Some(hash)));
        let scp = address.find(':').is_some_and(|colon| colon > 0 && colon + 1 < address.len())
            && fragment.is_none_or(|hash| !hash.contains(['\n', '\r', '\u{2028}', '\u{2029}']));
        if scp && !port(address) {
            git_attrs(fragment)?;
            return Ok(true);
        }
    }
    let spec = match spec.starts_with("git+file://") {
        true => spec.replace('\\', "/"),
        false => spec.to_owned(),
    };
    let url = opencode_api_types::js::parse_url(&spec).map_err(|_| Throws)?;
    match url.scheme() {
        "git" | "git+http" | "git+https" | "git+rsync" | "git+ftp" | "git+file" | "git+ssh" => {
            git_attrs(url.fragment())?;
            Ok(true)
        }
        "http" | "https" => Ok(false),
        _ => Err(Throws),
    }
}

/// `isPortNumber`: `:<digits>` then `/` or the end.
fn port(text: &str) -> bool {
    text.match_indices(':').any(|(at, _)| {
        let digits = text[at + 1..].bytes().take_while(u8::is_ascii_digit).count();
        digits > 0 && matches!(text.as_bytes().get(at + 1 + digits), None | Some(b'/'))
    })
}

/// `HostedGit.fromUrl(spec, { noGitPlus, noCommittish })` (`hosted-git-info` 9): the committish of a spec on a known
/// git host (GitHub, Bitbucket, GitLab, Gist, sourcehut) by its shortcut, its domain or GitHub's `user/repo`, or
/// `None` when it is none.
fn hosted(spec: &str) -> Option<Option<String>> {
    if spec.is_empty() {
        return None;
    }
    let corrected = match github_shorthand(spec) {
        true => format!("github:{spec}"),
        false => spec.to_owned(),
    };
    let url = parse_git_url(&corrected)?;
    let hash = url.fragment().unwrap_or_default();
    let host = url.host_str().unwrap_or_default();
    let domain = host.strip_prefix("www.").unwrap_or(host);
    let shortcut = HOSTS.iter().find(|known| url.scheme() == known.name);
    if shortcut.is_some() {
        let path = url.path().strip_prefix('/').unwrap_or(url.path());
        let path = path.split_once('@').map_or(path, |(_, after)| after);
        let (user, project) = path.rsplit_once('/').map_or((None, path), |(user, project)| (Some(user), project));
        if let Some(user) = user {
            decode_component(user)?;
        }
        decode_component(project)?;
        return Some(Some(decode_component(hash)?).filter(|hash| !hash.is_empty()));
    }
    let known = HOSTS.iter().find(|known| known.domain == domain)?;
    let scheme = format!("{}:", url.scheme());
    if !known.protocols.contains(&scheme.as_str()) {
        return None;
    }
    let (user, project, committish) = (known.extract)(url.path(), hash)?;
    if let Some(user) = user.filter(|user| !user.is_empty()) {
        decode_component(user)?;
    }
    decode_component(project)?;
    let committish = match committish {
        Some(committish) => decode_component(committish)?,
        None => "undefined".to_owned(),
    };
    Some(Some(committish).filter(|committish| !committish.is_empty()))
}

/// A known git host: its shortcut's name, its domain, the protocols its URLs take, and how a URL's path and hash give
/// its user, project and committish (`extract`, `hosts.js`).
struct GitHost {
    name: &'static str,
    domain: &'static str,
    protocols: &'static [&'static str],
    extract: Extract,
}

type Extract = for<'a> fn(&'a str, &'a str) -> Option<(Option<&'a str>, &'a str, Option<&'a str>)>;

const HOSTS: &[GitHost] = &[
    GitHost {
        name: "github",
        domain: "github.com",
        protocols: &["git:", "http:", "git+ssh:", "git+https:", "ssh:", "https:"],
        extract: |path, hash| {
            let parts = js_split(path, 5);
            let (user, project, kind) = (parts.get(1).copied(), parts.get(2).copied(), parts.get(3).copied());
            if kind.is_some_and(|kind| !kind.is_empty() && kind != "tree") {
                return None;
            }
            let committish = match kind.is_none_or(str::is_empty) {
                true => Some(hash),
                false => parts.get(4).copied(),
            };
            let project = project.map(strip_git)?;
            (!user?.is_empty() && !project.is_empty()).then_some((user, project, committish))
        },
    },
    GitHost {
        name: "bitbucket",
        domain: "bitbucket.org",
        protocols: &["git+ssh:", "git+https:", "ssh:", "https:"],
        extract: |path, hash| {
            let parts = js_split(path, 4);
            if parts.get(3) == Some(&"get") {
                return None;
            }
            let (user, project) = (parts.get(1).copied(), parts.get(2).copied().map(strip_git)?);
            (!user?.is_empty() && !project.is_empty()).then_some((user, project, Some(hash)))
        },
    },
    GitHost {
        name: "gitlab",
        domain: "gitlab.com",
        protocols: &["git+ssh:", "git+https:", "ssh:", "https:"],
        extract: |path, hash| {
            let path = path.get(1..).unwrap_or_default();
            if path.contains("/-/") || path.contains("/archive.tar.gz") {
                return None;
            }
            let (user, project) = path.rsplit_once('/').unwrap_or(("", path));
            let project = strip_git(project);
            (!user.is_empty() && !project.is_empty()).then_some((Some(user), project, Some(hash)))
        },
    },
    GitHost {
        name: "gist",
        domain: "gist.github.com",
        protocols: &["git:", "git+ssh:", "git+https:", "ssh:", "https:"],
        extract: |path, hash| {
            let parts = js_split(path, 4);
            if parts.get(3) == Some(&"raw") {
                return None;
            }
            let (user, project) = (parts.get(1).copied(), parts.get(2).copied());
            let (user, project) = match project.filter(|project| !project.is_empty()) {
                Some(project) => (user, project),
                None => (None, user.filter(|user| !user.is_empty())?),
            };
            Some((user, strip_git(project), Some(hash)))
        },
    },
    GitHost {
        name: "sourcehut",
        domain: "git.sr.ht",
        protocols: &["git+ssh:", "https:"],
        extract: |path, hash| {
            let parts = js_split(path, 4);
            if parts.get(3) == Some(&"archive") {
                return None;
            }
            let (user, project) = (parts.get(1).copied(), parts.get(2).copied().map(strip_git)?);
            (!user?.is_empty() && !project.is_empty()).then_some((user, project, Some(hash)))
        },
    },
];

/// `text.split("/", limit)`: at most `limit` pieces, the rest dropped.
fn js_split(text: &str, limit: usize) -> Vec<&str> {
    text.split('/').take(limit).collect()
}

fn strip_git(project: &str) -> &str {
    project.strip_suffix(".git").unwrap_or(project)
}

/// `isGitHubShorthand` (`from-url.js`): `user/repo`, a `#committish` after which anything goes.
fn github_shorthand(arg: &str) -> bool {
    let hash = arg.find('#');
    let after = |at: Option<usize>| at.is_none_or(|at| hash.is_some_and(|hash| at > hash));
    let slash = arg.find('/');
    let second = slash.and_then(|slash| arg[slash + 1..].find('/').map(|at| at + slash + 1));
    let space = arg.char_indices().find(|(_, char)| js_space(*char)).map(|(at, _)| at);
    let ends_with_slash = match hash {
        Some(hash) => hash > 0 && arg.as_bytes()[hash - 1] == b'/',
        None => arg.ends_with('/'),
    };
    after(space)
        && slash.is_some_and(|slash| slash > 0)
        && !ends_with_slash
        && !arg.starts_with('.')
        && after(arg.find('@'))
        && after(arg.find(':'))
        && after(second)
}

/// The protocols `parse-url.js` takes as they are: each host's shortcut, and the git and web ones.
const PROTOCOLS: &[&str] = &[
    "git+ssh:",
    "ssh:",
    "git+https:",
    "git:",
    "http:",
    "https:",
    "git+http:",
    "github:",
    "bitbucket:",
    "gitlab:",
    "gist:",
    "sourcehut:",
];

/// `parseUrl` (`parse-url.js`): the URL as written with its protocol corrected, else with an SCP `host:path` made a
/// path.
fn parse_git_url(giturl: &str) -> Option<url::Url> {
    let with_protocol = correct_protocol(giturl);
    let parse = |text: &str| opencode_api_types::js::parse_url(text).ok();
    parse(&with_protocol).or_else(|| parse(&correct_url(with_protocol.clone())))
}

/// `correctProtocol`.
fn correct_protocol(arg: &str) -> String {
    let colon = arg.find(':');
    let protocol = colon.map_or("", |colon| &arg[..=colon]);
    if PROTOCOLS.contains(&protocol) || colon.is_some_and(|colon| arg[colon..].starts_with("://")) {
        return arg.to_owned();
    }
    match arg.find('@') {
        Some(at) if colon.is_none_or(|colon| at > colon) => format!("git+ssh://{arg}"),
        Some(_) => arg.to_owned(),
        None => match colon {
            Some(colon) => format!("{}//{}", &arg[..=colon], &arg[colon + 1..]),
            None => format!("//{arg}"),
        },
    }
}

/// `correctUrl`: an SCP `host:path` (its last colon before any `#`, after its last `@`) becomes `host/path`, and a URL
/// without a scheme is `git+ssh://`.
fn correct_url(mut giturl: String) -> String {
    let before_hash = |text: &str, char: char| {
        let end = text.find('#').unwrap_or(text.len());
        text[..end].rfind(char)
    };
    let at = before_hash(&giturl, '@');
    if let Some(colon) = before_hash(&giturl, ':').filter(|colon| at.is_none_or(|at| *colon > at)) {
        giturl.replace_range(colon..=colon, "/");
    }
    if before_hash(&giturl, ':').is_none() && !giturl.contains("//") {
        giturl = format!("git+ssh://{giturl}");
    }
    giturl
}

fn git_slug(spec: &str) -> String {
    let target = spec.split('#').next().unwrap_or_default();
    let target = decode_component(target).unwrap_or_else(|| target.to_owned());
    // `/\.git$/i`.
    let target = match target
        .len()
        .checked_sub(4)
        .filter(|at| target.get(*at..).is_some_and(|end| end.eq_ignore_ascii_case(".git")))
    {
        Some(at) => target[..at].to_owned(),
        None => target,
    };
    let last = target.rsplit(['/', ':', '\\']).next().unwrap_or_default();
    let mut slug = String::new();
    let mut dash = false;
    for char in last.chars() {
        match char.is_ascii_alphanumeric() || "._-".contains(char) {
            true => {
                slug.push(char);
                dash = false;
            }
            false if !dash => {
                slug.push('-');
                dash = true;
            }
            false => {}
        }
    }
    let slug = slug.trim_matches('-');
    if slug.is_empty() { "repository".to_owned() } else { slug.to_owned() }
}

/// Windows filenames cannot contain control characters or `<>:"|?*`.
fn sanitize(key: &str) -> String {
    match cfg!(windows) {
        true => {
            key.chars().map(|char| if "<>:\"|?*".contains(char) || (char as u32) < 32 { '_' } else { char }).collect()
        }
        false => key.to_owned(),
    }
}

/// The newest generation under `root`: its numbered directory with the largest number.
fn generation(root: &Path) -> Option<PathBuf> {
    let entries = std::fs::read_dir(root).ok()?;
    let newest = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            let number = (!name.is_empty() && name.bytes().all(|byte| byte.is_ascii_digit()))
                .then(|| name.parse::<u128>().ok())??;
            Some((number, name))
        })
        .max_by_key(|(number, _)| *number)?;
    Some(root.join(newest.1))
}

/// The first dependency of `<base>/package.json`, as an install records the package it added.
fn first_dependency(base: &Path) -> Option<String> {
    let text = std::fs::read_to_string(base.join("package.json")).ok()?;
    let manifest: serde_json::Value = serde_json::from_str(&text).ok()?;
    manifest.get("dependencies")?.as_object()?.keys().next().cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_package_resolves_in_the_newest_generation() {
        let temp = opencode_util::temp::tempdir().unwrap();
        // A package resolves to its real path: the temporary directory's may be an 8.3 name (GitHub's Windows runner).
        let cache = super::super::real(temp.path()).unwrap();
        let install = |key: &str, generation: &str, name: &str| {
            let root = cache.join("npm").join(key).join(generation);
            std::fs::create_dir_all(root.join("node_modules").join(name)).unwrap();
            let manifest = serde_json::json!({ "dependencies": { name: "x" } });
            std::fs::write(root.join("package.json"), manifest.to_string()).unwrap();
            root.join("node_modules").join(name)
        };
        install("foo@latest", "100", "foo");
        let newest = install("foo@latest", "1200", "foo");
        install("foo@latest", "999", "foo");
        assert_eq!(resolve("foo", &cache), Some(Package { directory: newest, name: "foo".into() }));
        let scoped = install("@s/foo@^2", "5", "@s/foo");
        assert_eq!(resolve("@s/foo@^2", &cache).map(|package| package.directory), Some(scoped));
        // `foo@1` is another key than `foo`: it is not installed.
        assert_eq!(resolve("foo@1", &cache), None);
        let git = key("github:u/r", parse("github:u/r").as_ref());
        let named = install(&git, "7", "real-name");
        assert_eq!(resolve("github:u/r", &cache), Some(Package { directory: named, name: "real-name".into() }));
        assert_eq!(parse("foo@git+https://x.org/y.git").and_then(|target| target.name).as_deref(), Some("foo"));
        std::fs::create_dir_all(cache.join("npm").join("bar@latest").join("3")).unwrap();
        assert_eq!(resolve("bar", &cache), None);
        assert_eq!(resolve("baz", &cache), None);
    }

    #[cfg(unix)]
    #[test]
    fn nothing_outside_the_cache_is_found() {
        let root = opencode_util::temp::tempdir().unwrap();
        let cache = root.path().join("cache");
        let outside = root.path().join("escaped-js");
        std::fs::create_dir_all(outside.join("node_modules")).unwrap();
        std::fs::write(outside.join("package.json"), r#"{ "dependencies": { "..": "*" } }"#).unwrap();
        let generation = |key: &str| {
            let dir = cache.join("npm").join(key).join("5");
            std::fs::create_dir_all(dir.join("node_modules")).unwrap();
            dir
        };
        generation("existing@1.0.0");
        assert_eq!(resolve("existing@1.0.0/../../../escaped-js", &cache), None);
        // A git spec whose generation names its package by a key that is not a package name.
        for key in ["/abs/dir", "..", "../../escaped-js", "@s/../.."] {
            let spec = "github:u/r";
            let dir = generation(&cache_key(spec));
            std::fs::write(dir.join("package.json"), serde_json::json!({ "dependencies": { key: "*" } }).to_string())
                .unwrap();
            assert_eq!(resolve(spec, &cache), None, "{key}");
        }
        let tarball = generation("plugin.tgz");
        std::fs::create_dir_all(tarball.join("node_modules").join("plugin.tgz")).unwrap();
        assert_eq!(resolve("plugin.tgz", &cache), None);
        // A package that links out of the cache.
        let linked = generation("linked@1.0.0");
        std::os::unix::fs::symlink(&outside, linked.join("node_modules").join("linked")).unwrap();
        assert_eq!(resolve("linked@1.0.0", &cache), None);
        let found = generation("found@1.0.0").join("node_modules").join("found");
        std::fs::create_dir_all(&found).unwrap();
        let found = std::fs::canonicalize(found).unwrap();
        assert_eq!(resolve("found@1.0.0", &cache).map(|package| package.directory), Some(found));
        let git = generation(&cache_key("github:u/r"));
        std::fs::write(git.join("package.json"), r#"{ "dependencies": { "@s/real": "*" } }"#).unwrap();
        std::fs::create_dir_all(git.join("node_modules").join("@s").join("real")).unwrap();
        assert_eq!(resolve("github:u/r", &cache).map(|package| package.name), Some("@s/real".to_owned()));
    }

    #[test]
    fn a_package_name_is_validated_as_npm_does() {
        for name in ["foo", "Foo", "fs", "foo.bar", "foo~", "@s/foo", "@s/Foo", "@../x", "a!"] {
            assert!(valid_name(name), "{name}");
        }
        for name in [
            "",
            ".foo",
            "-foo",
            "_foo",
            " foo",
            "foo ",
            "node_modules",
            "favicon.ico",
            "a/b",
            "/abs",
            "..",
            "@s/.x",
            "@s/a/b",
            "@/x",
            "@s",
            "a b",
            "@s/",
        ] {
            assert!(!valid_name(name), "{name}");
        }
    }
}
