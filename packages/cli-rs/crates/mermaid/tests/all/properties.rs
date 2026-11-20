//! Properties over generated diagrams and edits of the P.3 corpus: they render within bounds, and as TS renders them.
//! `MERMAID_CASES` and `MERMAID_SEED` widen a run.

use opencode_mermaid::{Palette, Rendered, render};
use opencode_plugin::node::Reader;
use opencode_ui::theme::{Catalog, ThemeMode};
use opencode_util::rng::SplitMix64;

/// One of the items of `list`, separated by `¦`.
fn pick<'a>(rng: &mut SplitMix64, list: &'a str) -> &'a str {
    let items: Vec<&str> = list.split('¦').collect();
    items[rng.below(items.len() as u64) as usize]
}

/// Label text: wide, combining, zero-width and control characters, flags, entities, tags and diagram syntax.
const WORDS: &str = "A¦Node¦x¦界面¦😀¦👩‍🔬¦🇩🇰¦#️⃣¦e\u{301}¦\u{200b}¦\u{7}¦\t¦a b¦<br>¦<i>it</i>¦&amp;¦&#x1F600;¦&#0;¦\"q\"¦'s'¦\
                     a:b¦a;b¦a|b¦[x]¦(y)¦{z}¦-->¦%%¦#¦\u{fe0f}¦\u{3164}¦▶¦long label with many words in it¦Ω¦\u{10ffff}¦";

/// A count, now and then a large one.
fn size(rng: &mut SplitMix64, large: u64) -> u64 {
    let limit = if rng.below(5) == 0 { large } else { 6 };
    1 + rng.below(limit)
}

fn word(rng: &mut SplitMix64) -> String {
    let words: Vec<&str> = (0..1 + rng.below(3)).map(|_| pick(rng, WORDS)).collect();
    words.join(pick(rng, "¦ ¦<br/>"))
}

fn node(rng: &mut SplitMix64, count: u64) -> String {
    let id = format!("{}{}", pick(rng, "N¦n_¦a.b¦X-"), rng.below(count));
    let shape = pick(rng, "[L]¦(\"L\")¦{L}¦([L])¦[(L)]¦[[L]]¦((c))¦:::cls¦");
    format!("{id}{}", shape.replacen('L', &word(rng), 1))
}

fn flowchart(rng: &mut SplitMix64) -> String {
    let count = size(rng, 60);
    let mut lines = vec![format!("{} {}", pick(rng, "flowchart¦graph¦FLOWCHART"), pick(rng, "LR¦TD¦TB¦RL¦BT¦"))];
    let mut open = 0;
    for _ in 0..rng.below(3 * count + 2) {
        let line = match rng.below(12) {
            0 => {
                open += 1;
                format!("subgraph {}", pick(rng, "G¦g1[\"Group one\"]¦\"Quoted 界\"¦sub"))
            }
            1 if open > 0 => {
                open -= 1;
                "end".into()
            }
            2 => format!("direction {}", pick(rng, "LR¦TB¦RL¦BT")),
            3 => node(rng, count),
            4 => pick(rng, "classDef x fill:#f00¦style A fill:#fff¦%% comment¦¦accTitle: t").into(),
            _ => (0..1 + rng.below(3)).fold(node(rng, count), |line, _| {
                let label = word(rng);
                let op = pick(rng, "-->|L|¦-- L -->¦-. L .->¦== L ==>¦-->¦---¦-.->¦==>¦<-->¦~~~¦--o¦--x")
                    .replacen('L', &label, 1);
                let group = rng.below(5) == 0;
                let target =
                    if group { format!("{} & {}", node(rng, count), node(rng, count)) } else { node(rng, count) };
                format!("{line} {op} {target}")
            }),
        };
        lines.push(format!("{}{line}", "  ".repeat(open.min(4))));
    }
    lines.extend((0..open).filter(|_| rng.below(4) != 0).map(|_| "end".to_string()));
    lines.join("\n")
}

fn sequence(rng: &mut SplitMix64) -> String {
    let count = size(rng, 30);
    let mut lines = vec!["sequenceDiagram".to_string()];
    let p = |rng: &mut SplitMix64| format!("{}{}", pick(rng, "A¦Bob¦参与者¦P"), rng.below(count));
    let mut open = 0;
    for _ in 0..rng.below(4 * count + 2) {
        let line = match rng.below(14) {
            0 => format!("{} {} as {}", pick(rng, "participant¦actor"), p(rng), word(rng)),
            1 => format!("participant {}", p(rng)),
            2 => {
                let target = if rng.below(2) == 0 { format!("{},{}", p(rng), p(rng)) } else { p(rng) };
                format!("Note {} {target}: {}", pick(rng, "over¦left of¦right of"), word(rng))
            }
            3 => {
                open += 1;
                format!("{} {}", pick(rng, "loop¦alt¦opt¦par¦critical¦break¦rect rgb(0,0,0)¦box Aqua"), word(rng))
            }
            4 if open > 0 => pick(rng, "else other¦and more¦option x").into(),
            5 if open > 0 => {
                open -= 1;
                "end".into()
            }
            6 => format!("{} {}", pick(rng, "activate¦deactivate"), p(rng)),
            7 => pick(rng, "autonumber¦%% c¦¦title T").into(),
            _ => {
                let arrow = pick(rng, "->>¦-->>¦->¦-->¦-x¦--x¦-)¦--)¦<<->>");
                format!("{}{arrow}{}{}: {}", p(rng), pick(rng, "¦+¦-"), p(rng), word(rng))
            }
        };
        lines.push(format!("  {line}"));
    }
    lines.join("\n")
}

fn state(rng: &mut SplitMix64) -> String {
    let count = size(rng, 40);
    let mut lines = vec![pick(rng, "stateDiagram-v2¦stateDiagram").to_string()];
    let s = |rng: &mut SplitMix64| if rng.below(6) == 0 { "[*]".to_string() } else { format!("S{}", rng.below(count)) };
    let mut open = 0;
    for _ in 0..rng.below(3 * count + 2) {
        let line = match rng.below(12) {
            0 => format!("state \"{}\" as {}", word(rng), s(rng)),
            1 => {
                open += 1;
                format!("state {} {{", s(rng))
            }
            2 if open > 0 => {
                open -= 1;
                "}".into()
            }
            3 => format!("note {} of {} : {}", pick(rng, "right¦left"), s(rng), word(rng)),
            4 => format!("state {} <<{}>>", s(rng), pick(rng, "choice¦fork¦join")),
            5 => format!("direction {}", pick(rng, "LR¦TB¦RL¦BT")),
            6 if open > 0 => "--".into(),
            7 => format!("{}: {}", s(rng), word(rng)),
            _ => {
                let label = if rng.below(2) == 0 { format!(": {}", word(rng)) } else { String::new() };
                format!("{} --> {}{label}", s(rng), s(rng))
            }
        };
        lines.push(format!("{}{line}", "  ".repeat(open.min(4) + 1)));
    }
    lines.join("\n")
}

fn gantt(rng: &mut SplitMix64) -> String {
    let count = size(rng, 40);
    let mut lines = vec!["gantt".to_string()];
    for _ in 0..rng.below(2 * count + 2) {
        let line = match rng.below(8) {
            0 => format!("title {}", word(rng)),
            1 => format!("dateFormat {}", pick(rng, "YYYY-MM-DD¦X¦x¦s¦HH:mm¦DD/MM/YYYY¦bogus¦YYYY-MM-DD HH:mm")),
            2 => format!("section {}", word(rng)),
            3 => pick(rng, "axisFormat %m-%d¦excludes weekends¦todayMarker off¦tickInterval 1day").into(),
            _ => {
                let tags = pick(rng, "¦crit, ¦done, ¦active, ¦milestone, ¦crit, active, ");
                let start = match rng.below(3) {
                    0 => format!("after t{}", rng.below(count)),
                    1 => format!("2024-0{}-1{}", 1 + rng.below(9), rng.below(10)),
                    _ => pick(rng, "2024-02-30¦9999-12-31¦0¦1e300¦-1e300¦1e18¦-5¦1.5¦NaN¦Infinity¦2024-01-01 10:30¦")
                        .into(),
                };
                let end =
                    pick(rng, "3d¦1w¦0d¦100000d¦2024-03-01¦12h¦-2d¦1.5d¦1e18¦1e300¦99999999999w¦0.0001ms¦5¦-1e300");
                format!("{} :{tags}t{}, {start}, {end}", word(rng), rng.below(count))
            }
        };
        lines.push(format!("  {line}"));
    }
    lines.join("\n")
}

fn gitgraph(rng: &mut SplitMix64) -> String {
    let count = size(rng, 40);
    let mut lines = vec![pick(rng, "gitGraph¦gitGraph LR:¦gitGraph TB:").to_string()];
    for _ in 0..rng.below(3 * count + 2) {
        let line = match rng.below(8) {
            0..3 => format!("{} {}", pick(rng, "branch¦checkout¦merge"), pick(rng, "main¦dev¦feature/x¦b1¦界")),
            3 => format!("cherry-pick id: \"c{}\"", rng.below(count)),
            4 => format!("commit id: \"c{}\" tag: \"{}\"", rng.below(count), word(rng)),
            5 => format!("commit type: {}", pick(rng, "HIGHLIGHT¦REVERSE¦NORMAL")),
            _ => "commit".into(),
        };
        lines.push(format!("  {line}"));
    }
    lines.join("\n")
}

fn timeline(rng: &mut SplitMix64) -> String {
    let count = size(rng, 40);
    let mut lines = vec![pick(rng, "timeline¦timeline LR¦timeline TD").to_string()];
    for _ in 0..rng.below(2 * count + 2) {
        let line = match rng.below(5) {
            0 => format!("title {}", word(rng)),
            1 => format!("section {}", word(rng)),
            2 => format!(": {}", word(rng)),
            _ => {
                let events: Vec<String> = (0..rng.below(4)).map(|_| word(rng)).collect();
                format!("{} : {}", word(rng), events.join(" : "))
            }
        };
        lines.push(format!("  {line}"));
    }
    lines.join("\n")
}

/// A random edit at line or char granularity: delete, duplicate, or splice.
fn mutate(rng: &mut SplitMix64, source: &str) -> String {
    let chars: Vec<char> = source.chars().collect();
    let (a, b) = (rng.below(chars.len() as u64 + 1) as usize, rng.below(chars.len() as u64 + 1) as usize);
    let (a, b) = (a.min(b), a.max(b));
    let s = |range: std::ops::Range<usize>| chars[range].iter().collect::<String>();
    match rng.below(6) {
        0 => s(0..a) + &s(b..chars.len()),
        1 => s(0..b) + &s(a..chars.len()),
        2 => s(0..a) + pick(rng, WORDS) + &s(a..chars.len()),
        3 => {
            let lines: Vec<&str> = source.split('\n').collect();
            let line = lines[rng.below(lines.len() as u64) as usize];
            let copies = rng.below(40) as usize;
            lines.iter().copied().chain(std::iter::repeat_n(line, copies)).collect::<Vec<_>>().join("\n")
        }
        4 => source.replacen(pick(rng, "A¦B¦-->¦[¦]¦\"¦:¦ "), pick(rng, WORDS), 1),
        _ => s(a..b).repeat(1 + rng.below(10) as usize) + &s(b..chars.len()),
    }
}

fn palette() -> Palette {
    let theme = Catalog::default().load("opencode", ThemeMode::Dark).unwrap().theme;
    Palette::read(&Reader::new(&theme, ThemeMode::Dark))
}

fn corpus() -> Vec<String> {
    let corpus: serde_json::Value =
        serde_json::from_str(include_str!("../../../../parity/fixtures/P.3/corpus.json")).unwrap();
    let mut sources: Vec<String> =
        corpus["cases"].as_array().unwrap().iter().map(|case| case["source"].as_str().unwrap().to_string()).collect();
    sources.dedup();
    sources
}

fn source(rng: &mut SplitMix64, corpus: &[String]) -> String {
    let kinds = [flowchart, sequence, state, gantt, gitgraph, timeline];
    if rng.below(2) == 0 {
        return kinds[rng.below(6) as usize](rng);
    }
    let base = rng.below(corpus.len() as u64) as usize;
    let mut source = mutate(rng, &corpus[base]);
    for _ in 0..rng.below(3) {
        source = mutate(rng, &source);
    }
    source
}

fn cases(default: u64) -> (u64, SplitMix64) {
    let number = |name: &str| std::env::var(name).ok().and_then(|value| value.parse().ok());
    (number("MERMAID_CASES").unwrap_or(default), SplitMix64(number("MERMAID_SEED").unwrap_or(1)))
}

const WIDTHS: [u16; 14] = [1, 2, 3, 5, 10, 20, 40, 60, 80, 119, 120, 121, 200, 500];

/// Any source, and any prefix a streaming reply shows, renders the same way twice, in bounded time, without a line
/// break inside a run.
#[test]
fn diagrams_render_within_bounds() {
    let (cases, mut rng) = cases(60);
    let (corpus, palette) = (corpus(), palette());
    let check = |source: &str, width: u16| {
        let started = std::time::Instant::now();
        let rendered = render(source, width, &palette);
        assert!(started.elapsed().as_secs() < 5, "{source:?} at width {width} took {:?}", started.elapsed());
        if let Rendered::Diagram(diagram) | Rendered::Syntax { prefix: Some(diagram), .. } = &rendered {
            let breaks = diagram.lines.iter().flatten().any(|run| run.text.contains(['\n', '\r']));
            assert!(!breaks, "{source:?}: a run holds a line break");
        }
        rendered
    };
    for _ in 0..cases {
        let source = source(&mut rng, &corpus);
        let width = WIDTHS[rng.below(WIDTHS.len() as u64) as usize];
        assert_eq!(check(&source, width), render(&source, width, &palette), "{source:?}: not deterministic");
        let ends: Vec<usize> = source.char_indices().map(|(at, _)| at).chain([source.len()]).collect();
        for _ in 0..if rng.below(4) == 0 { 24 } else { 0 } {
            check(&source[..ends[rng.below(ends.len() as u64) as usize]], width);
        }
    }
}

/// The TS plugin's code-block renderer draws the same styled rows (`parity/oracle/P.3-mermaid-live.ts`).
#[test]
fn diagrams_match_typescript_live() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../..");
    let skip = |reason: &str| {
        assert!(
            std::env::var_os("OPENCODE_RS_REQUIRE_TS").is_none(),
            "OPENCODE_RS_REQUIRE_TS is set, but skipped: {reason}"
        );
        eprintln!("skipped: {reason}");
    };
    if std::process::Command::new("bun").arg("--version").output().is_err() {
        return skip("bun is not on PATH");
    }
    if !root.join("node_modules").is_dir() {
        return skip("the checkout has no node_modules");
    }
    let (cases, mut rng) = cases(20);
    let (corpus, palette) = (corpus(), palette());
    let items: Vec<(String, u16)> =
        (0..cases).map(|_| (source(&mut rng, &corpus), [1, 10, 40, 60, 80, 120, 200][rng.below(7) as usize])).collect();
    let directory = std::env::temp_dir().join(format!("opencode-parity-P.3-live-{}", std::process::id()));
    std::fs::create_dir_all(&directory).unwrap();
    let (input, output) = (directory.join("in.json"), directory.join("out.json"));
    let json: Vec<serde_json::Value> =
        items.iter().map(|(source, width)| serde_json::json!({ "source": source, "width": width })).collect();
    std::fs::write(&input, serde_json::to_string(&json).unwrap()).unwrap();
    let script = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../parity/oracle/P.3-mermaid-live.ts");
    let status = std::process::Command::new("bun").arg(script).arg(&input).arg(&output).status().unwrap();
    assert!(status.success());
    let ts: Vec<serde_json::Value> = serde_json::from_str(&std::fs::read_to_string(&output).unwrap()).unwrap();
    std::fs::remove_dir_all(&directory).unwrap();
    for ((source, width), expected) in items.iter().zip(&ts) {
        // TS throws on some inputs that Rust draws or rejects, such as a group nested in itself.
        if expected["error"].is_string() {
            continue;
        }
        let expected = expected["lines"].as_array().map(|lines| {
            if expected["height"].as_u64() == Some(0) {
                return (Vec::new(), Vec::new());
            }
            let runs = expected["runs"].as_array().unwrap().iter().map(|row| {
                let row = row.as_array().unwrap().iter();
                row.map(|run| (run[0].as_u64().unwrap() as usize, run[1].as_str().unwrap().to_string())).collect()
            });
            (lines.iter().map(|line| line.as_str().unwrap().to_string()).collect::<Vec<_>>(), runs.collect::<Vec<_>>())
        });
        let actual = super::oracle::rust_case(source, *width, &palette);
        let merged = |case: Option<super::oracle::Case>| {
            case.map(|(lines, runs)| (lines, runs.into_iter().map(super::oracle::merged).collect::<Vec<_>>()))
        };
        assert_eq!(merged(actual), merged(expected), "at width {width}:\n{source}");
    }
}
