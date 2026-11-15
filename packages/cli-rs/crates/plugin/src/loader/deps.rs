//! What a native build asks the platform loader to load with it (bigboi-3; final review big-boi 2, carbon-7): the
//! dependencies and search paths an ELF or Mach-O file names, read as the loader that loads that format reads them,
//! glibc's or musl's `ld.so` for ELF and `dyld` for Mach-O. The loader opens a build from a private copy that holds
//! only that one file, so a dependency comes from the system, from the paths the build names, from the user's own
//! loader settings, or, for a relative path, from the current directory, which is the project. An approval names one
//! file's bytes (rich-plugins 3.9), so what it covers must not reach code outside it.
//!
//! The policy is fail-closed: a name or a mechanism it does not know to be safe is refused, not passed.
//!
//! - No build may name a path the loader resolves against the current directory, a path with a `..` component
//!   anywhere (which leaves the directory it starts in: the private copy, the client's, or a trusted root), an empty
//!   search path entry (which glibc reads as the current directory), or a loader token other than the one leading
//!   origin token, whole: `$ORIGIN` and `${ORIGIN}` on ELF (`$ORIGIN_X` is no token to `ld.so`, so it is a relative
//!   path), `@loader_path`, `@executable_path` and `@rpath` on Mach-O, each followed by `/` or nothing. A bare name
//!   is a library `ld.so` searches for; `dyld` reads one as a path, so on Mach-O it is refused.
//! - No build may use a mechanism that brings in code the host does not read: ELF's `DT_FILTER`, `DT_AUXILIARY`,
//!   `DT_AUDIT`, `DT_DEPAUDIT` and `DT_USED`, a dynamic tag the policy does not know, or Mach-O's
//!   `LC_LOAD_DYLINKER` and `LC_DYLD_ENVIRONMENT`.
//! - A project's build may also name no absolute path outside the system's libraries: `/usr/lib`, `/usr/lib64`,
//!   `/lib` and `/lib64` on Linux and the other ELF systems, `/usr/lib` and `/System` on macOS, each matched by whole
//!   components. A root is trusted once it and every directory above it, symbolic links resolved, are the
//!   superuser's and no one else may write them; a path under one that exists must still be under one once its links
//!   are resolved. A path that does not exist loads nothing (on macOS a system library is in the shared cache and not
//!   on disk).
//! - The user's own loader settings are the user's choice and trusted: `LD_LIBRARY_PATH` and `LD_PRELOAD` on ELF
//!   systems, the `DYLD_*` paths on macOS, and the system's loader configuration. So a project's build is not
//!   promised libraries from the system alone. One part of them is not the user's: an empty or relative entry in
//!   `LD_LIBRARY_PATH` (whose entries glibc splits at `:` and at `;`) or a `DYLD_*` path is read against the current
//!   directory, so a build that names a library the loader searches for is refused while one is set: on ELF a bare
//!   name, on Mach-O any library, as `dyld` looks for every library's leaf name in those paths, `@rpath` ones too
//!   (final re-review big-boi 2).
//!
//! Windows needs no reading: `win::load_library` searches no directory a project controls. A file that is neither
//! ELF nor Mach-O passes here; the platform loader refuses it.

use std::path::{Component, Path, PathBuf};

/// Checks the dependencies `bytes` names, with the stricter rule for a project's build, against this machine's
/// trusted roots and the loader settings this process inherited.
pub fn check(bytes: &[u8], project: bool) -> Result<(), String> {
    check_with(bytes, project, &Policy::host())
}

/// [`check`] under `policy`.
pub(crate) fn check_with(bytes: &[u8], project: bool, policy: &Policy) -> Result<(), String> {
    let loader = Loader::of(bytes);
    let names = named(bytes)?;
    for name in &names {
        if let Some(reason) = refused(loader, name, project, policy) {
            return Err(format!("the library depends on {:?}, {reason}", name.text()));
        }
    }
    let searched = names.iter().any(|name| match (loader, name) {
        (Loader::Elf, Name::Library(text)) => !text.contains('/'),
        (Loader::Dyld, Name::Library(_)) => true,
        _ => false,
    });
    if let (true, Some((variable, entry))) = (searched, policy.relative_entry(loader)) {
        return Err(format!(
            "the library names a library the loader searches for, and {variable} holds {entry:?}, which the loader \
             reads against the current directory: the project"
        ));
    }
    Ok(())
}

/// A dependency or search path an executable file names.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Name {
    /// An ELF `DT_NEEDED` or a Mach-O `LC_*_DYLIB` path.
    Library(String),
    /// One entry of an ELF `DT_RPATH` or `DT_RUNPATH`, or a Mach-O `LC_RPATH`.
    Search(String),
    /// A mechanism that brings in code the policy does not read, which is refused: a dynamic tag or load command.
    Mechanism(String),
}

impl Name {
    fn text(&self) -> &str {
        match self {
            Name::Library(text) | Name::Search(text) | Name::Mechanism(text) => text,
        }
    }
}

/// The loader that reads a file's names.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Loader {
    /// glibc's or musl's `ld.so`.
    Elf,
    Dyld,
    /// Neither: the platform loader refuses the file.
    None,
}

impl Loader {
    fn of(bytes: &[u8]) -> Self {
        if bytes.starts_with(b"\x7fELF") {
            return Loader::Elf;
        }
        match bytes.get(..4).map(|magic| [magic[0], magic[1], magic[2], magic[3]]) {
            Some([0xca, 0xfe, 0xba, 0xbe] | [0xca, 0xfe, 0xba, 0xbf]) => Loader::Dyld,
            Some(magic) if macho_magic(magic).is_some() => Loader::Dyld,
            _ => Loader::None,
        }
    }

    /// The leading tokens this loader expands, each to a directory a build may name below.
    fn tokens(self) -> &'static [&'static str] {
        match self {
            Loader::Elf => &["$ORIGIN", "${ORIGIN}"],
            Loader::Dyld => &["@loader_path", "@executable_path", "@rpath"],
            Loader::None => &[],
        }
    }
}

/// The trusted roots of absolute paths a project's build may name, and the loader settings the process inherited.
pub(crate) struct Policy {
    roots: Vec<PathBuf>,
    /// Who besides the superuser may own a trusted root and the directories above it: no one but in tests. Windows
    /// trusts no root here.
    #[cfg_attr(not(unix), allow(dead_code))]
    owner: u32,
    /// The loader path settings, by name: their values as the process inherited them.
    settings: Vec<(&'static str, String)>,
}

impl Policy {
    /// This machine's.
    fn host() -> Self {
        let roots: &[&str] = match cfg!(target_os = "macos") {
            true => &["/usr/lib", "/System"],
            false => &["/usr/lib", "/usr/lib64", "/lib", "/lib64"],
        };
        let names: &[&'static str] = match cfg!(target_os = "macos") {
            true => &[
                "DYLD_LIBRARY_PATH",
                "DYLD_FALLBACK_LIBRARY_PATH",
                "DYLD_FRAMEWORK_PATH",
                "DYLD_FALLBACK_FRAMEWORK_PATH",
            ],
            false => &["LD_LIBRARY_PATH"],
        };
        let settings = names
            .iter()
            .filter_map(|name| Some((*name, std::env::var_os(name)?.to_string_lossy().into_owned())))
            .collect();
        Self { roots: roots.iter().map(PathBuf::from).collect(), owner: 0, settings }
    }

    /// For tests: `roots`, owned by `owner`, and `settings`.
    #[cfg(all(test, unix))]
    pub(crate) fn new(roots: Vec<PathBuf>, owner: u32, settings: Vec<(&'static str, String)>) -> Self {
        Self { roots, owner, settings }
    }

    /// The first entry of the loader's path settings that it reads against the current directory: empty or relative.
    fn relative_entry(&self, loader: Loader) -> Option<(&'static str, String)> {
        // glibc splits `LD_LIBRARY_PATH` at both separators; dyld its paths at `:` alone.
        let (wanted, separators): (&str, &[char]) = match loader {
            Loader::Elf => ("LD_", &[':', ';']),
            Loader::Dyld => ("DYLD_", &[':']),
            Loader::None => return None,
        };
        self.settings.iter().filter(|(name, _)| name.starts_with(wanted)).find_map(|(name, value)| {
            let entry = value.split(separators).find(|entry| !entry.starts_with('/'))?;
            Some((*name, entry.to_owned()))
        })
    }

    /// Whether the absolute `path` is under a trusted root, as the loader will find it.
    fn trusts(&self, path: &Path) -> bool {
        let Some(root) = self.roots.iter().find(|root| path.starts_with(root)) else { return false };
        let Some(real_root) = self.verified(root) else { return false };
        match std::fs::canonicalize(path) {
            Ok(real) => self.roots.iter().filter_map(|root| self.verified(root)).any(|root| real.starts_with(root)),
            // Nothing there loads nothing; only the root's owner can put something there.
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => real_root.exists(),
            Err(_) => false,
        }
    }

    /// `root` with its links resolved, if it and every directory above it are the superuser's and no one else may
    /// write them.
    fn verified(&self, root: &Path) -> Option<PathBuf> {
        let real = std::fs::canonicalize(root).ok()?;
        real.ancestors().all(|dir| self.owned(dir)).then_some(real)
    }

    #[cfg(unix)]
    fn owned(&self, dir: &Path) -> bool {
        use std::os::unix::fs::MetadataExt;
        std::fs::metadata(dir).is_ok_and(|meta| {
            meta.is_dir() && (meta.uid() == 0 || meta.uid() == self.owner) && meta.mode() & 0o022 == 0
        })
    }

    #[cfg(not(unix))]
    fn owned(&self, _: &Path) -> bool {
        false
    }
}

/// Why `name` is refused, if it is, as `loader` reads it.
fn refused(loader: Loader, name: &Name, project: bool, policy: &Policy) -> Option<String> {
    let text = name.text();
    if let Name::Mechanism(_) = name {
        return Some("a mechanism that loads code the host does not check".into());
    }
    if text.is_empty() {
        return Some(match name {
            Name::Search(_) => "an empty search path, which means the current directory".into(),
            _ => "an empty name".into(),
        });
    }
    // A leading token, whole: followed by a separator or nothing.
    let token = loader
        .tokens()
        .iter()
        .find(|token| text.strip_prefix(**token).is_some_and(|rest| rest.is_empty() || rest.starts_with('/')));
    let rest = token.map_or(text, |token| &text[token.len()..]);
    if Path::new(rest).components().any(|part| part == Component::ParentDir) {
        return Some("whose `..` leaves the directory it starts in".into());
    }
    let tokens: &[char] = match loader {
        Loader::Elf => &['$'],
        Loader::Dyld => &['@'],
        Loader::None => &[],
    };
    if rest.contains(tokens) {
        return Some("a loader token the host does not read as the loader does".into());
    }
    if token.is_some() {
        return None;
    }
    if !text.starts_with('/') {
        return match (loader, name) {
            // A bare name is searched for in the search paths and the system's directories.
            (Loader::Elf, Name::Library(_)) if !text.contains('/') => None,
            _ => Some("a path relative to the current directory, which is the project".into()),
        };
    }
    match project && !policy.trusts(Path::new(text)) {
        true => Some("a path outside the system's libraries, which a project's plugin may not name".into()),
        false => None,
    }
}

/// The names `bytes` asks the loader for; none for a file that is neither ELF nor Mach-O. A file that claims to be one
/// but cannot be read as one is refused.
pub fn named(bytes: &[u8]) -> Result<Vec<Name>, String> {
    if bytes.starts_with(b"\x7fELF") {
        return elf(bytes).ok_or_else(|| "the library's ELF dynamic section cannot be read".to_owned());
    }
    match bytes.get(..4).map(|magic| [magic[0], magic[1], magic[2], magic[3]]) {
        Some([0xca, 0xfe, 0xba, 0xbe] | [0xca, 0xfe, 0xba, 0xbf]) => fat(bytes),
        Some(magic) if macho_magic(magic).is_some() => macho(bytes),
        _ => Ok(Vec::new()),
    }
    .map_err(|()| "the library's Mach-O load commands cannot be read".to_owned())
}

/// Reads integers of one width and byte order.
#[derive(Clone, Copy)]
struct Reader<'a> {
    bytes: &'a [u8],
    big: bool,
}

impl Reader<'_> {
    fn u16(self, at: usize) -> Option<u64> {
        let raw: [u8; 2] = self.bytes.get(at..at.checked_add(2)?)?.try_into().ok()?;
        Some(u64::from(if self.big { u16::from_be_bytes(raw) } else { u16::from_le_bytes(raw) }))
    }

    fn u32(self, at: usize) -> Option<u64> {
        let raw: [u8; 4] = self.bytes.get(at..at.checked_add(4)?)?.try_into().ok()?;
        Some(u64::from(if self.big { u32::from_be_bytes(raw) } else { u32::from_le_bytes(raw) }))
    }

    fn u64(self, at: usize) -> Option<u64> {
        let raw: [u8; 8] = self.bytes.get(at..at.checked_add(8)?)?.try_into().ok()?;
        Some(if self.big { u64::from_be_bytes(raw) } else { u64::from_le_bytes(raw) })
    }

    /// A word of the file's class: 8 bytes in a 64-bit file.
    fn word(self, wide: bool, at: usize) -> Option<u64> {
        if wide { self.u64(at) } else { self.u32(at) }
    }

    /// The NUL-terminated string at `at`.
    fn string(self, at: usize) -> Option<String> {
        let rest = self.bytes.get(at..)?;
        let end = rest.iter().position(|byte| *byte == 0)?;
        Some(String::from_utf8_lossy(&rest[..end]).into_owned())
    }
}

const PT_LOAD: u64 = 1;
const PT_DYNAMIC: u64 = 2;
const DT_NEEDED: u64 = 1;
const DT_STRTAB: u64 = 5;
const DT_RPATH: u64 = 15;
const DT_RUNPATH: u64 = 29;

const EM_X86_64: u64 = 62;
const EM_AARCH64: u64 = 183;
const EM_RISCV: u64 = 243;

/// The GNU and Sun tags glibc defines that load nothing: prelink and conflict tables, checksums, sizes, `DT_GNU_HASH`,
/// TLS descriptors, symbol info, versions, the relocation counts and the flags. Not the audit libraries, `DT_CONFIG`,
/// the filters or `DT_USED`.
const GNU_TAGS: &[u64] = &[
    0x6fff_fdf4,
    0x6fff_fdf5,
    0x6fff_fdf6,
    0x6fff_fdf7,
    0x6fff_fdf8,
    0x6fff_fdf9,
    0x6fff_fdfa,
    0x6fff_fdfb,
    0x6fff_fdfc,
    0x6fff_fdfd,
    0x6fff_fdfe,
    0x6fff_fdff,
    0x6fff_fef5,
    0x6fff_fef6,
    0x6fff_fef7,
    0x6fff_fef8,
    0x6fff_fef9,
    0x6fff_fefd,
    0x6fff_fefe,
    0x6fff_feff,
    0x6fff_fff0,
    0x6fff_fff9,
    0x6fff_fffa,
    0x6fff_fffb,
    0x6fff_fffc,
    0x6fff_fffd,
    0x6fff_fffe,
    0x6fff_ffff,
];

/// The generic tags the ELF ABI assigns, `DT_NULL` (0) to `DT_RELRENT` (37): every number but 31, which none is.
const GENERIC_TAGS: &[u64] = &[
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
    32, 33, 34, 35, 36, 37,
];

/// Whether dynamic tag `tag` of a file for `machine` is one the policy knows loads no code but what it reads: each of
/// [`GENERIC_TAGS`], each of [`GNU_TAGS`], and the processor tags its machine defines (x86-64's
/// PLT tags; AArch64's BTI, PAC, variant PCS and memory tags; RISC-V's variant calling convention). A tag in a range
/// but not named here is refused (final re-review big-boi 2, and its final pass: tag 31).
fn known(tag: u64, machine: u64) -> bool {
    let processor: &[u64] = match machine {
        EM_X86_64 => &[0x7000_0000, 0x7000_0001, 0x7000_0003],
        EM_AARCH64 => {
            &[0x7000_0001, 0x7000_0003, 0x7000_0005, 0x7000_0009, 0x7000_000b, 0x7000_000c, 0x7000_000d, 0x7000_000f]
        }
        EM_RISCV => &[0x7000_0001],
        _ => &[],
    };
    GENERIC_TAGS.contains(&tag) || GNU_TAGS.contains(&tag) || processor.contains(&tag)
}

/// An ELF file's `DT_NEEDED` names and `DT_RPATH` and `DT_RUNPATH` entries.
fn elf(bytes: &[u8]) -> Option<Vec<Name>> {
    let wide = match bytes.get(4)? {
        1 => false,
        2 => true,
        _ => return None,
    };
    let big = match bytes.get(5)? {
        1 => false,
        2 => true,
        _ => return None,
    };
    let read = Reader { bytes, big };
    let machine = read.u16(0x12)?;
    let (phoff, phentsize, phnum) = match wide {
        true => (read.u64(0x20)?, read.u16(0x36)?, read.u16(0x38)?),
        false => (read.u32(0x1c)?, read.u16(0x2a)?, read.u16(0x2c)?),
    };
    // (type, offset, address, size in the file) of each program header.
    let headers: Vec<(u64, u64, u64, u64)> = (0..phnum)
        .map(|index| {
            let at = usize::try_from(phoff.checked_add(index.checked_mul(phentsize)?)?).ok()?;
            Some(match wide {
                true => (read.u32(at)?, read.u64(at + 8)?, read.u64(at + 16)?, read.u64(at + 32)?),
                false => (read.u32(at)?, read.u32(at + 4)?, read.u32(at + 8)?, read.u32(at + 16)?),
            })
        })
        .collect::<Option<_>>()?;
    // A file without a dynamic section is linked statically and loads nothing more.
    let Some(&(_, dynamic, _, size)) = headers.iter().find(|header| header.0 == PT_DYNAMIC) else {
        return Some(Vec::new());
    };
    let entry = if wide { 16 } else { 8 };
    let entries: Vec<(u64, u64)> = (0..size / entry)
        .map(|index| {
            let at = usize::try_from(dynamic.checked_add(index * entry)?).ok()?;
            Some((read.word(wide, at)?, read.word(wide, at + entry as usize / 2)?))
        })
        .collect::<Option<Vec<_>>>()?
        .into_iter()
        .take_while(|(tag, _)| *tag != 0)
        .collect();
    // A tag that brings in code, or one the policy does not know, is refused by its number (big-boi 2, carbon-7).
    let mut out: Vec<Name> = entries
        .iter()
        .filter(|(tag, _)| !known(*tag, machine))
        .map(|(tag, _)| Name::Mechanism(format!("ELF dynamic tag {tag:#x}")))
        .collect();
    let names: Vec<&(u64, u64)> =
        entries.iter().filter(|(tag, _)| matches!(*tag, DT_NEEDED | DT_RPATH | DT_RUNPATH)).collect();
    if names.is_empty() {
        return Some(out);
    }
    // The string table is named by its address; the loadable segment that holds it gives its place in the file.
    let address = entries.iter().find(|(tag, _)| *tag == DT_STRTAB)?.1;
    let table = headers
        .iter()
        .filter(|header| header.0 == PT_LOAD)
        .find(|(_, _, start, size)| address >= *start && address - start < *size)
        .map(|(_, offset, start, _)| offset + (address - start))?;
    for (tag, value) in names {
        let text = read.string(usize::try_from(table.checked_add(*value)?).ok()?)?;
        match *tag {
            DT_NEEDED => out.push(Name::Library(text)),
            _ => out.extend(text.split(':').map(|entry| Name::Search(entry.to_owned()))),
        }
    }
    Some(out)
}

const LC_LOAD_DYLIB: u64 = 0xc;
const LC_LOAD_WEAK_DYLIB: u64 = 0x8000_0018;
const LC_RPATH: u64 = 0x8000_001c;
const LC_REEXPORT_DYLIB: u64 = 0x8000_001f;
const LC_LAZY_LOAD_DYLIB: u64 = 0x20;
const LC_LOAD_UPWARD_DYLIB: u64 = 0x8000_0023;
/// The loader a main executable asks for, and the `DYLD_*` settings it carries: neither belongs in a plugin.
const LC_LOAD_DYLINKER: u64 = 0xe;
const LC_DYLD_ENVIRONMENT: u64 = 0x27;

/// Whether `magic` is a thin Mach-O header's: `(wide, big-endian)`.
fn macho_magic(magic: [u8; 4]) -> Option<(bool, bool)> {
    match u32::from_le_bytes(magic) {
        0xfeed_face => Some((false, false)),
        0xfeed_facf => Some((true, false)),
        _ => match u32::from_be_bytes(magic) {
            0xfeed_face => Some((false, true)),
            0xfeed_facf => Some((true, true)),
            _ => None,
        },
    }
}

/// The dylib paths and run paths of a thin Mach-O file's load commands.
fn macho(bytes: &[u8]) -> Result<Vec<Name>, ()> {
    let magic = bytes.get(..4).ok_or(())?;
    let (wide, big) = macho_magic([magic[0], magic[1], magic[2], magic[3]]).ok_or(())?;
    let read = Reader { bytes, big };
    let count = read.u32(16).ok_or(())?;
    let mut at = if wide { 32 } else { 28 };
    let mut out = Vec::new();
    for _ in 0..count {
        let (command, size) = (read.u32(at).ok_or(())?, read.u32(at + 4).ok_or(())?);
        if size < 8 {
            return Err(());
        }
        let name = || {
            let offset = read.u32(at + 8)?;
            read.string(at.checked_add(usize::try_from(offset).ok()?)?)
        };
        match command {
            LC_LOAD_DYLIB | LC_LOAD_WEAK_DYLIB | LC_REEXPORT_DYLIB | LC_LAZY_LOAD_DYLIB | LC_LOAD_UPWARD_DYLIB => {
                out.push(Name::Library(name().ok_or(())?))
            }
            LC_RPATH => out.push(Name::Search(name().ok_or(())?)),
            LC_LOAD_DYLINKER | LC_DYLD_ENVIRONMENT => {
                out.push(Name::Mechanism(format!("Mach-O load command {command:#x}")));
            }
            _ => {}
        }
        at = at.checked_add(usize::try_from(size).map_err(|_| ())?).ok_or(())?;
    }
    Ok(out)
}

/// The names of every slice of a universal Mach-O file.
fn fat(bytes: &[u8]) -> Result<Vec<Name>, ()> {
    let read = Reader { bytes, big: true };
    let wide = bytes.get(3) == Some(&0xbf);
    let count = read.u32(4).ok_or(())?;
    let entry = if wide { 32 } else { 20 };
    let mut out = Vec::new();
    for index in 0..usize::try_from(count).map_err(|_| ())? {
        let at = 8 + index * entry;
        let (offset, size) = match wide {
            true => (read.u64(at + 8).ok_or(())?, read.u64(at + 16).ok_or(())?),
            false => (read.u32(at + 8).ok_or(())?, read.u32(at + 12).ok_or(())?),
        };
        let start = usize::try_from(offset).map_err(|_| ())?;
        let end = start.checked_add(usize::try_from(size).map_err(|_| ())?).ok_or(())?;
        out.extend(macho(bytes.get(start..end).ok_or(())?)?);
    }
    Ok(out)
}

/// A little-endian ELF64 file with one loadable segment over the whole file, a dynamic section, and a string table
/// holding `needed` and `runpath`.
#[cfg(test)]
pub(crate) fn elf64(needed: &[&str], runpath: Option<&str>) -> Vec<u8> {
    let mut tags: Vec<(u64, &str)> = needed.iter().map(|name| (DT_NEEDED, *name)).collect();
    tags.extend(runpath.map(|path| (DT_RUNPATH, path)));
    elf64_tags(&tags)
}

/// [`elf64`] with the dynamic entries `tags`, each naming a string, for x86-64.
#[cfg(test)]
pub(crate) fn elf64_tags(tags: &[(u64, &str)]) -> Vec<u8> {
    elf64_for(EM_X86_64, tags)
}

/// [`elf64_tags`] for the machine `machine`.
#[cfg(test)]
pub(crate) fn elf64_for(machine: u64, tags: &[(u64, &str)]) -> Vec<u8> {
    let mut strings = vec![0u8];
    let mut add = |text: &str| {
        let at = strings.len() as u64;
        strings.extend(text.as_bytes());
        strings.push(0);
        at
    };
    let mut dynamic: Vec<(u64, u64)> = tags.iter().map(|(tag, text)| (*tag, add(text))).collect();
    let (phoff, phnum) = (64u64, 2u64);
    let dynoff = phoff + 56 * phnum;
    let strtab = dynoff + 16 * (dynamic.len() as u64 + 2);
    dynamic.push((DT_STRTAB, strtab));
    dynamic.push((0, 0));
    let mut out = vec![0u8; 64];
    out[..4].copy_from_slice(b"\x7fELF");
    (out[4], out[5]) = (2, 1);
    out[0x12..0x14].copy_from_slice(&(machine as u16).to_le_bytes());
    out[0x20..0x28].copy_from_slice(&phoff.to_le_bytes());
    out[0x36..0x38].copy_from_slice(&56u16.to_le_bytes());
    out[0x38..0x3a].copy_from_slice(&(phnum as u16).to_le_bytes());
    let total = strtab + strings.len() as u64;
    for (kind, offset, size) in [(PT_LOAD, 0, total), (PT_DYNAMIC, dynoff, 16 * dynamic.len() as u64)] {
        let mut header = vec![0u8; 56];
        header[..4].copy_from_slice(&(kind as u32).to_le_bytes());
        header[8..16].copy_from_slice(&offset.to_le_bytes());
        header[16..24].copy_from_slice(&offset.to_le_bytes());
        header[32..40].copy_from_slice(&size.to_le_bytes());
        out.extend(header);
    }
    for (tag, value) in dynamic {
        out.extend(tag.to_le_bytes());
        out.extend(value.to_le_bytes());
    }
    out.extend(strings);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const DT_DEPAUDIT: u64 = 0x6fff_fefb;
    const DT_AUDIT: u64 = 0x6fff_fefc;
    const DT_AUXILIARY: u64 = 0x7fff_fffd;
    const DT_USED: u64 = 0x7fff_fffe;
    const DT_FILTER: u64 = 0x7fff_ffff;

    /// A little-endian 64-bit Mach-O file with one load command per `(command, path)`.
    fn macho64(commands: &[(u64, &str)]) -> Vec<u8> {
        let mut out = vec![0u8; 32];
        out[..4].copy_from_slice(&0xfeed_facfu32.to_le_bytes());
        out[16..20].copy_from_slice(&(commands.len() as u32).to_le_bytes());
        for (command, path) in commands {
            let offset = if *command == LC_RPATH { 12 } else { 24 };
            let size = (offset + path.len() + 1).next_multiple_of(8);
            let mut body = vec![0u8; size];
            body[..4].copy_from_slice(&(*command as u32).to_le_bytes());
            body[4..8].copy_from_slice(&(size as u32).to_le_bytes());
            body[8..12].copy_from_slice(&(offset as u32).to_le_bytes());
            body[offset..offset + path.len()].copy_from_slice(path.as_bytes());
            out.extend(body);
        }
        out
    }

    /// This machine's roots, with no loader settings inherited.
    fn policy() -> Policy {
        Policy { settings: Vec::new(), ..Policy::host() }
    }

    /// Whether `bytes` pass for any build and for a project's, under [`policy`].
    fn passes(bytes: &[u8]) -> (bool, bool) {
        (check_with(bytes, false, &policy()).is_ok(), check_with(bytes, true, &policy()).is_ok())
    }

    // Expected (bigboi-3, final review big-boi 2 and carbon-7): an ELF build names its libraries and search paths,
    // read as `ld.so` reads them, and the policy refuses what the current directory or a path outside where it starts
    // would supply, `..` anywhere and a token `ld.so` does not expand; a project's build may name system libraries
    // only, matched by whole components.
    #[test]
    fn elf_dependencies_follow_the_policy() {
        let plain = elf64(&["libc.so.6", "libm.so.6"], None);
        assert_eq!(named(&plain).unwrap(), [Name::Library("libc.so.6".into()), Name::Library("libm.so.6".into())]);
        assert_eq!(passes(&plain), (true, true));
        let unix = cfg!(unix);
        for (runpath, trusted, project) in [
            ("$ORIGIN", true, true),
            ("${ORIGIN}/", true, true),
            ("$ORIGIN/lib", true, true),
            ("lib", false, false),
            ("", false, false),
            ("/usr/lib:", false, false),
            ("$ORIGIN/../lib", false, false),
            ("/opt/x/lib", true, false),
            // `ld.so` takes `$ORIGIN` only as a whole token: `$ORIGIN_DIR` is a path from the current directory.
            ("$ORIGIN_DIR", false, false),
            ("$ORIGINlib", false, false),
            ("${ORIGIN}x", false, false),
            // A token past the start, and the tokens the policy does not read.
            ("/usr/lib/$ORIGIN/x", false, false),
            ("/usr/lib/$ORIGIN/../../home/me/repo", false, false),
            ("/usr/$LIB", false, false),
            ("$PLATFORM/x", false, false),
            // A trusted root by its components: itself, not a sibling that starts with its name.
            ("/usr/lib", true, unix),
            ("/usr/libexec/x", true, false),
            ("/usr/lib/../../home/me/repo", false, false),
            ("/usr/lib/./x", true, unix),
        ] {
            let bytes = elf64(&["libc.so.6"], Some(runpath));
            assert_eq!(passes(&bytes), (trusted, project), "{runpath:?}");
        }
        for (needed, trusted, project) in [
            ("./libx.so", false, false),
            ("sub/libx.so", false, false),
            ("/opt/libx.so", true, false),
            ("$ORIGIN/libx.so", true, true),
            ("$ORIGIN_X/libx.so", false, false),
            ("/usr/lib/../../home/me/repo/evil.so", false, false),
            ("/usr/lib/libz-test-absent.so", true, unix),
            ("lib$x.so", false, false),
        ] {
            let bytes = elf64(&[needed], None);
            assert_eq!(passes(&bytes), (trusted, project), "{needed}");
        }
        let error = check_with(&elf64(&["libc.so.6"], Some("lib")), true, &policy()).unwrap_err();
        assert!(error.contains("\"lib\"") && error.contains("current directory"), "{error}");
        // A file that claims to be ELF but is cut short is refused, not passed.
        assert!(check(&plain[..100], false).is_err());
        // Neither ELF nor Mach-O: the platform loader decides.
        assert_eq!(check(b"MZ\x90\x00", true), Ok(()));
    }

    // Expected (final review carbon-7, big-boi 2; final re-review big-boi 2): a dynamic tag that brings in code the
    // policy does not read, a filter, an auxiliary filter, an audit library, `DT_USED`, `DT_CONFIG`, or a tag it does
    // not know, is refused for every build, also one inside the ranges the known tags are in, and a processor tag of
    // another machine; the tags a toolchain writes pass, a processor's own on its machine.
    #[test]
    fn elf_mechanisms_that_load_code_are_refused() {
        let refused = [
            (EM_X86_64, DT_FILTER),
            (EM_X86_64, DT_AUXILIARY),
            (EM_X86_64, DT_AUDIT),
            (EM_X86_64, DT_DEPAUDIT),
            (EM_X86_64, DT_USED),
            (EM_X86_64, 0x6fff_fefa),
            (EM_X86_64, 0x6000_000f),
            (EM_X86_64, 38),
            (EM_X86_64, 31),
            (EM_X86_64, 0x6fff_fe00),
            (EM_X86_64, 0x6fff_fff5),
            (EM_X86_64, 0x7000_0005),
            (EM_X86_64, 0x7123_4567),
            (EM_AARCH64, 0x7000_0000),
            (0, 0x7000_0001),
        ];
        for (machine, tag) in refused {
            let bytes = elf64_for(machine, &[(DT_NEEDED, "libc.so.6"), (tag, "libc.so.6")]);
            assert_eq!(passes(&bytes), (false, false), "{machine} {tag:#x}");
            let error = check_with(&bytes, false, &policy()).unwrap_err();
            assert!(error.contains(&format!("{tag:#x}")) && error.contains("loads code"), "{error}");
        }
        // `DT_GNU_HASH`, `DT_VERNEED`, `DT_FLAGS_1`, `DT_RELACOUNT`, `DT_INIT_ARRAY`, `DT_RELR`, x86-64's PLT size,
        // AArch64's variant PCS, RISC-V's variant calling convention.
        let passed = [
            (EM_X86_64, 0x6fff_fef5),
            (EM_X86_64, 0x6fff_fffe),
            (EM_X86_64, 0x6fff_fffb),
            (EM_X86_64, 0x6fff_fff9),
            (EM_X86_64, 25),
            (EM_X86_64, 36),
            (EM_X86_64, 0x7000_0001),
            (EM_AARCH64, 0x7000_0005),
            (EM_RISCV, 0x7000_0001),
        ];
        for (machine, tag) in passed {
            let bytes = elf64_for(machine, &[(DT_NEEDED, "libc.so.6"), (tag, "")]);
            assert_eq!(passes(&bytes), (true, true), "{machine} {tag:#x}");
        }
    }

    // Expected (final review big-boi 2): the user's loader settings are trusted, but an empty or relative entry in them
    // is read against the current directory: a build that names a library the loader searches for is refused while
    // one is set, and one that names only paths is not.
    #[test]
    fn a_relative_loader_path_setting_refuses_a_searched_library() {
        let searched = elf64(&["libc.so.6"], None);
        let pathed = elf64(&["$ORIGIN/libx.so"], None);
        for (value, ok) in
            [("/opt/lib:/usr/local/lib", true), (":/opt/lib", false), ("/opt/lib:", false), ("lib", false)]
        {
            let ld = Policy { settings: vec![("LD_LIBRARY_PATH", value.to_owned())], ..policy() };
            assert_eq!(check_with(&searched, false, &ld).is_ok(), ok, "{value:?}");
            assert_eq!(check_with(&pathed, false, &ld), Ok(()), "{value:?}");
            // The other loader's settings do not apply to it.
            let dyld = Policy { settings: vec![("DYLD_LIBRARY_PATH", value.to_owned())], ..policy() };
            assert_eq!(check_with(&searched, false, &dyld), Ok(()), "{value:?}");
        }
        // glibc splits `LD_LIBRARY_PATH` at `;` too (final re-review big-boi 2).
        for value in ["/opt/lib;lib", ";/opt/lib", "/opt/lib;"] {
            let ld = Policy { settings: vec![("LD_LIBRARY_PATH", value.to_owned())], ..policy() };
            assert!(check_with(&searched, false, &ld).is_err(), "{value:?}");
        }
    }

    // Expected (final re-review big-boi 2): `dyld` looks for every library's leaf name in its `DYLD_*` paths, an
    // `@rpath` name's and an absolute one's too: a relative entry refuses a build that names any library, and an
    // absolute one does not; it splits them at `:` alone, so a `;` is part of an absolute entry.
    #[test]
    fn a_relative_dyld_path_refuses_any_library() {
        for name in ["@rpath/libx.dylib", "@loader_path/libx.dylib", "/usr/lib/libSystem.B.dylib"] {
            let bytes = macho64(&[(LC_LOAD_DYLIB, name)]);
            for (variable, value, ok) in [
                ("DYLD_LIBRARY_PATH", "/opt/lib", true),
                ("DYLD_LIBRARY_PATH", "/opt/lib;lib", true),
                ("DYLD_LIBRARY_PATH", "lib", false),
                ("DYLD_FALLBACK_LIBRARY_PATH", "/usr/lib:", false),
                ("DYLD_FRAMEWORK_PATH", ":/Library/Frameworks", false),
                ("LD_LIBRARY_PATH", "lib", true),
            ] {
                let policy = Policy { settings: vec![(variable, value.to_owned())], ..policy() };
                assert_eq!(check_with(&bytes, false, &policy).is_ok(), ok, "{name} {variable}={value:?}");
            }
        }
    }

    // Expected (final review big-boi 2): a trusted root is trusted as the loader finds it: a path under one that leads
    // through a symbolic link out of every root is refused, as is a root someone else may write; one that stays in it
    // passes. Here the roots are a directory of the user's own, which only the tests may own.
    #[cfg(unix)]
    #[test]
    fn a_trusted_root_is_checked_on_the_disk() {
        use std::os::unix::fs::{MetadataExt, PermissionsExt, symlink};
        let base =
            Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("../../target/deps-roots-{}", std::process::id()));
        std::fs::create_dir_all(&base).unwrap();
        let base = std::fs::canonicalize(base).unwrap();
        let root = base.join("root");
        let outside = base.join("outside");
        std::fs::create_dir_all(root.join("lib")).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(root.join("lib/libok.so"), b"").unwrap();
        std::fs::write(outside.join("libevil.so"), b"").unwrap();
        symlink(&outside, root.join("escape")).unwrap();
        let owner = std::fs::metadata(&root).unwrap().uid();
        let ancestors_ok = std::fs::canonicalize(&root)
            .unwrap()
            .ancestors()
            .all(|dir| std::fs::metadata(dir).is_ok_and(|meta| meta.mode() & 0o022 == 0));
        let roots = Policy::new(vec![root.clone()], owner, Vec::new());
        let at = |path: &Path| check_with(&elf64(&[&path.to_string_lossy()], None), true, &roots).is_ok();
        assert_eq!(at(&root.join("lib/libok.so")), ancestors_ok, "a library in the root");
        assert_eq!(at(&root.join("lib/libabsent.so")), ancestors_ok, "nothing there loads nothing");
        assert!(!at(&root.join("escape/libevil.so")), "a link out of the root");
        assert!(!at(&outside.join("libevil.so")), "outside");
        std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o777)).unwrap();
        assert!(!at(&root.join("lib/libok.so")), "a root anyone may write");
        std::fs::remove_dir_all(&base).unwrap();
        // This machine's own roots, which the superuser owns.
        #[cfg(target_os = "linux")]
        assert!(policy().trusts(Path::new("/usr/lib")), "/usr/lib is not a trusted root here");
    }

    // Expected (bigboi-3, final review big-boi 2 and carbon-7): the same policy for Mach-O load commands, read as
    // `dyld` reads them, also inside a universal file: a token followed by a separator or nothing, no `..` anywhere,
    // a bare name refused (`dyld` reads it as a path), and the load commands of a main executable refused.
    #[test]
    fn macho_dependencies_follow_the_policy() {
        let system = macho64(&[(LC_LOAD_DYLIB, "/usr/lib/libSystem.B.dylib")]);
        assert_eq!(named(&system).unwrap(), [Name::Library("/usr/lib/libSystem.B.dylib".into())]);
        // `/usr/lib` is a trusted root on this machine on Linux and macOS alike.
        assert_eq!(passes(&system), (true, cfg!(unix)));
        let macos = cfg!(target_os = "macos");
        for (command, path, trusted, project) in [
            (LC_LOAD_DYLIB, "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation", true, macos),
            (LC_LOAD_DYLIB, "@rpath/libx.dylib", true, true),
            (LC_LOAD_DYLIB, "@executable_path/libx.dylib", true, true),
            (LC_LOAD_DYLIB, "@loader_path/libx.dylib", true, true),
            (LC_LOAD_DYLIB, "@loader_path/../libx.dylib", false, false),
            (LC_LOAD_WEAK_DYLIB, "lib/libx.dylib", false, false),
            (LC_LOAD_DYLIB, "/opt/homebrew/lib/libx.dylib", true, false),
            (LC_RPATH, "@loader_path", true, true),
            (LC_RPATH, "build", false, false),
            (LC_RPATH, "/Users/me/repo/lib", true, false),
            (LC_LOAD_DYLIB, "@rpath_dir/evil.dylib", false, false),
            (LC_LOAD_DYLIB, "@rpath/../../evil.dylib", false, false),
            (LC_LOAD_DYLIB, "@executable_path/../../../../Users/me/evil.dylib", false, false),
            (LC_LOAD_DYLIB, "@loader_pathx/libx.dylib", false, false),
            (LC_LOAD_DYLIB, "/System/../../Users/me/evil.dylib", false, false),
            (LC_LOAD_DYLIB, "/usr/lib/@rpath/x.dylib", false, false),
            (LC_LOAD_DYLIB, "libx.dylib", false, false),
            (LC_RPATH, "@loader_path/../lib", false, false),
            (LC_LOAD_DYLINKER, "/usr/lib/dyld", false, false),
            (LC_DYLD_ENVIRONMENT, "DYLD_INSERT_LIBRARIES=/tmp/x.dylib", false, false),
        ] {
            let bytes = macho64(&[(LC_LOAD_DYLIB, "/usr/lib/libSystem.B.dylib"), (command, path)]);
            // A project's build passes only where `/usr/lib`, which each build here also names, is a trusted root.
            assert_eq!(passes(&bytes), (trusted, project && cfg!(unix)), "{path}");
        }
        // A universal file holding one slice.
        let universal = |slice: Vec<u8>| {
            let mut out = vec![0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 1];
            out.extend([0u8; 8]);
            out.extend(32u32.to_be_bytes());
            out.extend((slice.len() as u32).to_be_bytes());
            // The alignment, then padding up to the slice at 32.
            out.extend([0u8; 8]);
            out.extend(slice);
            out
        };
        assert_eq!(named(&universal(system.clone())).unwrap(), named(&system).unwrap());
        assert!(check(&universal(macho64(&[(LC_RPATH, "build")])), false).is_err());
        assert!(check(&system[..20], false).is_err());
    }
}
