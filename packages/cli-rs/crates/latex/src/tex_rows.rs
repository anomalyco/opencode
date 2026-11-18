use crate::layout::{self, Options};
use crate::parse::{Environment, Limits, Mode, Node, PLACEHOLDER, Role, Variant, parse, parse_with};

fn display(source: &str) -> String {
    crate::render(source).unwrap_or_else(|error| panic!("{source:?}: {error}")).to_string()
}

fn inline(source: &str) -> String {
    crate::inline::render(source).unwrap_or_else(|error| panic!("{source:?}: {error}")).to_string()
}

fn sym(value: &str) -> Node {
    Node::Symbol { value: value.into(), role: Some(Role::Ordinary) }
}

const EMPTY: Node = Node::Row(Vec::new());

/// A matrix's cells: `""` for an empty one, a symbol's value, `*` for anything else.
fn cells(node: &Node) -> Vec<Vec<String>> {
    let Node::Matrix { rows, .. } = node else { panic!("not a matrix: {node:?}") };
    let cell = |node: &Node| match node {
        Node::Row(body) if body.is_empty() => String::new(),
        Node::Symbol { value, .. } => value.clone(),
        _ => "*".into(),
    };
    rows.iter().map(|row| row.iter().map(cell).collect()).collect()
}

#[test]
fn comments_end_at_any_line_break_and_leave_raw_groups() {
    for (source, expected) in [
        ("x% ignored }\\unknown\ny", "xy"),
        ("x% ignored\ry", "xy"),
        ("x% ignored at EOF", "x"),
        ("\\frac% ignored\n{x}{y}", "\\frac{x}{y}"),
        ("\\begin{array}{l% ignored }\ncr}x&y&z\\end{array}", "\\begin{array}{lcr}x&y&z\\end{array}"),
        ("\\textcolor{re% ignored\r\nd}{x}", "\\textcolor{red}{x}"),
    ] {
        assert_eq!(parse(source), parse(expected), "{source:?}");
    }
}

#[test]
fn matrices_keep_empty_cells() {
    for (source, rows) in [
        ("a&&\\\\&b&", vec![vec!["a", "", ""], vec!["", "b", ""]]),
        ("&=x\\\\&=y", vec![vec!["", "*"], vec!["", "*"]]),
        ("&&", vec![vec!["", "", ""]]),
        ("a\\\\", vec![vec!["a"]]),
        ("\\\\", vec![vec![""]]),
        ("", vec![vec![]]),
    ] {
        for environment in ["matrix", "aligned", "align*"] {
            let node = parse(&format!("\\begin{{{environment}}}{source}\\end{{{environment}}}")).unwrap();
            assert_eq!(cells(&node), rows, "{environment} {source:?}");
        }
    }
    let nested = parse("\\begin{aligned}&\\begin{matrix}a&&b\\end{matrix}\\\\c&\\end{aligned}").unwrap();
    assert_eq!(cells(&nested), [vec!["", "*"], vec!["c", ""]]);
    let Node::Matrix { rows, .. } = &nested else { unreachable!() };
    assert_eq!(cells(&rows[0][1]), [vec!["a", "", "b"]]);
    assert_eq!(cells(&parse("\\displaylines{a&\\\\&b}").unwrap()), [vec!["a", ""], vec!["", "b"]]);
    let Node::Row(body) = parse("\\displaylines{\\frac{1}{2}\\\\{y}}+z").unwrap() else { panic!() };
    assert!(matches!(&body[0], Node::Matrix { environment: Environment::Gathered, .. }), "{body:?}");
    assert_eq!(body.len(), 3);
}

#[test]
fn variants_braces_and_text() {
    for (command, variant) in [
        ("mathrm", Variant::Normal),
        ("textrm", Variant::Normal),
        ("mathnormal", Variant::Normal),
        ("mathbf", Variant::Bold),
        ("boldsymbol", Variant::Bold),
        ("bm", Variant::Bold),
        ("mathit", Variant::Italic),
        ("mathsf", Variant::Sans),
        ("mathtt", Variant::Monospace),
        ("mathbb", Variant::DoubleStruck),
        ("mathcal", Variant::Script),
        ("mathscr", Variant::Script),
        ("mathfrak", Variant::Fraktur),
    ] {
        let body = if command == "textrm" { Node::Text("x".into()) } else { sym("x") };
        assert_eq!(parse(&format!("\\{command}{{x}}")), Ok(Node::Variant { variant, body: Box::new(body) }));
    }
    for (source, value) in [
        ("\\text{left \\{ right \\} \\% \\# \\$ \\& \\_ \\ }", "left { right } % # $ & _  "),
        ("\\text{a\\,b\\:c\\;d\\!e~f\\textbackslash!}", "a b c de f\\!"),
        ("\\mbox{\\quad!\\qquad!\\enspace!\\thinspace!}", "  !    ! ! !"),
        ("\\text{100% raw\ntext}", "100% raw\ntext"),
        ("\\text{\\unknown}", "\\unknown"),
    ] {
        assert_eq!(parse(source), Ok(Node::Text(value.into())), "{source:?}");
    }
    let textrm = Node::Variant { variant: Variant::Normal, body: Box::new(Node::Text(" if ".into())) };
    assert_eq!(parse("\\textrm{ if }"), Ok(textrm));
    for command in ["mod", "bmod"] {
        assert_eq!(parse(&format!("\\{command}")), Ok(Node::Operator { value: "mod".into(), limits: Limits::Never }));
    }
}

#[test]
fn color_ends_at_its_argument_or_the_cell() {
    let red = |body: Node| Node::Color { color: "red".into(), body: Box::new(body) };
    assert_eq!(parse("\\textcolor{red}{x}+y").unwrap(), Node::Row(vec![red(sym("x")), plus(), sym("y")]));
    assert_eq!(
        parse("{\\color{red}xy}z").unwrap(),
        Node::Row(vec![red(Node::Row(vec![sym("x"), sym("y")])), sym("z")])
    );
    let matrix = parse("\\begin{matrix}\\color{red}x&y\\\\z\\end{matrix}").unwrap();
    let Node::Matrix { rows, .. } = matrix else { panic!() };
    assert_eq!(rows, [vec![red(sym("x")), sym("y")], vec![sym("z")]]);
    let Ok(Node::Delimited { body, right, .. }) = parse("\\left(\\color{red}x\\right)") else { panic!() };
    assert_eq!((*body, right.as_str()), (red(sym("x")), ")"));
    let Ok(Node::Root { index, body }) = parse("\\sqrt[\\color{red}3]{x}") else { panic!() };
    assert_eq!((index.map(|index| *index), *body), (Some(red(sym("3"))), sym("x")));
}

fn plus() -> Node {
    Node::Symbol { value: "+".into(), role: Some(Role::Binary) }
}

#[test]
fn commands_and_symbols() {
    for command in [
        "arccos", "arcsin", "arctan", "arg", "cosh", "cot", "coth", "csc", "deg", "dim", "hom", "lg", "Pr", "sec",
        "sinh", "tanh", "liminf", "limsup",
    ] {
        let limits = if command.starts_with("lim") { Limits::Display } else { Limits::Never };
        assert_eq!(parse(&format!("\\{command}")), Ok(Node::Operator { value: command.into(), limits }));
    }
    for (command, value) in [
        ("imath", "ı"),
        ("jmath", "ȷ"),
        ("beth", "ℶ"),
        ("daleth", "ℸ"),
        ("measuredangle", "∡"),
        ("lozenge", "◊"),
        ("nexists", "∄"),
        ("clubsuit", "♣"),
        ("uplus", "⊎"),
        ("sqcup", "⊔"),
        ("wr", "≀"),
        ("triangleleft", "◁"),
        ("equals", "="),
        ("asymp", "≍"),
        ("preceq", "⪯"),
        ("sqsubseteq", "⊑"),
        ("owns", "∋"),
        ("mid", "∣"),
        ("dashv", "⊣"),
        ("smile", "⌣"),
        ("hookrightarrow", "↪"),
        ("rightharpoonup", "⇀"),
        ("rightleftharpoons", "⇌"),
        ("Longrightarrow", "⟹"),
        ("longmapsto", "⟼"),
        ("Updownarrow", "⇕"),
        ("nwarrow", "↖"),
        ("epsilon", "ϵ"),
        ("varepsilon", "ε"),
        ("degree", "°"),
    ] {
        assert!(matches!(parse(&format!("\\{command}")), Ok(Node::Symbol { value: v, .. }) if v == value), "{command}");
    }
    for (command, value) in [("bigoplus", "⨁"), ("bigotimes", "⨂"), ("bigodot", "⨀")] {
        assert_eq!(parse(&format!("\\{command}")), Ok(Node::Operator { value: value.into(), limits: Limits::Display }));
    }
    for (source, value) in [
        ("=", "≠"),
        ("<", "≮"),
        (">", "≯"),
        ("\\leq", "≰"),
        ("\\geq", "≱"),
        ("\\in", "∉"),
        ("\\ni", "∌"),
        ("\\subset", "⊄"),
        ("\\supset", "⊅"),
        ("\\equiv", "≢"),
        ("\\approx", "≉"),
        ("\\sim", "≁"),
        ("\\subseteq", "⊈"),
        ("\\supseteq", "⊉"),
        ("\\mid", "∤"),
        ("\\parallel", "∦"),
        ("x", "x\u{338}"),
    ] {
        assert!(
            matches!(parse(&format!("\\not {source}")), Ok(Node::Symbol { value: v, .. }) if v == value),
            "{source}"
        );
    }
    for (left, right, value) in [("lvert", "rvert", "│"), ("lVert", "rVert", "║"), ("lbrace", "rbrace", "{")] {
        let delimited = parse(&format!("\\left\\{left} x\\right\\{right}"));
        assert!(matches!(delimited, Ok(Node::Delimited { left: l, .. }) if l == value), "{left}");
        assert_eq!(parse(&format!("\\{left}")), Ok(Node::Symbol { value: value.into(), role: None }));
    }
}

#[test]
fn directives_make_no_atom_and_limits_reach_operators_through_styles() {
    for directive in ["displaystyle", "textstyle", "scriptstyle", "scriptscriptstyle"] {
        assert_eq!(parse(&format!("x^\\{directive}2")), parse("x^2"), "{directive}");
        assert_eq!(parse(&format!("\\sum\\{directive}_1^2")), parse("\\sum_1^2"), "{directive}");
    }
    assert_eq!(display("\\displaystyle \\frac{a}{b} \\textstyle c \\scriptstyle d"), " a\n─── cd\n b");
}

#[test]
fn styled_atoms_keep_their_meaning() {
    for (source, expected) in [
        ("a\\not\\mathbf{=}b", "a ≠ b"),
        ("x\\not\\mathrm{\\in}S", "x ∉ S"),
        ("\\not\\textcolor{red}{\\mathit{\\subseteq}}", "⊈"),
        ("\\mathbf{x}\u{305}", "x\u{305}"),
        ("\\mathrm{x}\u{20d7}", "x\u{20d7}"),
        ("\\textcolor{red}{\\mathit{x}}\u{305}", "x\u{305}"),
        ("\\mathbb{R}+\\mathcal{F}", "ℝ + ℱ"),
        ("\\arctan x", "arctan x"),
        ("x\\pmod{n}", "x (mod n)"),
        ("\\operatorname{arg\\,max} x", "arg max x"),
        ("x % comment\n+y", "x + y"),
        ("\\mathrm{d}\\mathbf{x}+\\alpha", "dx + α"),
        ("\\hat{x}+\\overline{yz}", "^   ──\nx + yz"),
        ("\\frac{x+1}{y-1}", " x + 1\n───────\n y - 1"),
        ("\\sum_{i=1}^{n} i^2", "  n\n  ∑   i²\ni = 1"),
    ] {
        assert_eq!(display(source), expected, "{source:?}");
    }
    let layout = crate::render("\\mathbf{x+\\mathit{y}}+\\textcolor{red}{z}").unwrap();
    assert_eq!(layout.to_string(), "x + y + z");
    let style = |x: usize| &layout.cells[0][x].as_ref().unwrap().style;
    assert!(style(4).bold && style(4).italic);
    assert_eq!(style(8).color.as_deref(), Some("red"));
}

#[test]
fn graphemes_and_combining_marks_stay_whole() {
    for suffix in ["{x}", "^2", "_2", "\\alpha", "~x", "% ignored\nx"] {
        assert_eq!(parse(&format!("\u{600}{suffix}")), parse(&format!("\u{600} {suffix}")), "{suffix:?}");
    }
    assert_eq!(cells(&parse("\\begin{matrix}\u{600}&&x\\end{matrix}").unwrap()), [vec!["\u{600}", "", "x"]]);
    for (source, expected) in [
        ("a=\u{338}b", "a =\u{338} b"),
        ("x\u{305}+y", "x\u{305} + y"),
        ("x\u{305}^2", "x\u{305}²"),
        ("\\frac x\u{305}y", " x\u{305}\n───\n y"),
        ("\u{1f469}\u{200d}\u{1f52c}^2+\u{1f1e9}\u{1f1f0}", "\u{1f469}\u{200d}\u{1f52c}² + \u{1f1e9}\u{1f1f0}"),
        ("[\u{305}x]\u{305}", "[\u{305}x]\u{305}"),
        ("\\big[\u{305}x\\big]\u{305}", "[\u{305}x]\u{305}"),
        ("\\left[\u{305}x\\right]\u{305}", "[\u{305}x]\u{305}"),
        ("\\left\\langle\u{305}x\\right\\rangle\u{305}", "⟨\u{305}x⟩\u{305}"),
        ("\\%\u{305}x", "%\u{305}x"),
        ("\\{\u{305}x\\}\u{305}", "{\u{305}x}\u{305}"),
        ("\\alpha\u{305}\u{301}\\beta", "α\u{305}\u{301}β"),
        ("\\alpha\u{1d167}^2", "α\u{1d167}²"),
        ("\\#\u{fe0f}\u{20e3}^2", "#\u{fe0f}\u{20e3}²"),
        ("{\\alpha\u{305}}^2_1", "α\u{305}²₁"),
        ("\\frac\\alpha\u{305}x", " α\u{305}\n───\n x"),
        ("x^\\alpha\u{305}y", " α\u{305}\nx y"),
        ("\\sum\u{305}\\limits_1^2", "2\n∑\u{305}\n1"),
        ("\\left.\u{305}x\\right.\u{305}", "x"),
        ("\\left[\u{305}\\frac{1}{2}\\right]\u{305}", "⎡ 1 ⎤\n⎢\u{305}───⎥\u{305}\n⎣ 2 ⎦"),
        ("\\left\\{\u{305}\\frac{1}{2}\\right\\}\u{305}", "⎧ 1 ⎫\n⎨\u{305}───⎬\u{305}\n⎩ 2 ⎭"),
        ("\\|x\\|", "║x║"),
        ("\\left\\|x\\right\\|", "║x║"),
        ("\\left\\|\\frac{1}{2}\\right\\|", "║ 1 ║\n║───║\n║ 2 ║"),
        ("|x|", "|x|"),
        ("\\left|x\\right|", "│x│"),
        ("\\left.x\\right\\|", "x║"),
        ("\\left\\.x\\right\\.", "x"),
        ("x\\.", "x"),
    ] {
        assert_eq!(display(source), expected, "{source:?}");
    }
}

#[test]
fn malformed_input_fails() {
    let deep =
        |prefix: &str, middle: &str, suffix: &str| format!("{}{middle}{}", prefix.repeat(257), suffix.repeat(257));
    for source in [
        "\\unknown",
        "\\constructor",
        "\\toString",
        "\\left\\unknown x\\right)",
        "\\left(x\\right\\unknown",
        "\\big\\unknown",
        "\\left(x\\middle\\unknown y\\right)",
        "a}b",
        "\\frac}",
        "\\not}",
        "\\end{matrix}",
        "\\begin{unknown}x",
        "\\begin{matrix}x}",
        "\\begin{matrix}&}",
        "\\begin{matrix}1\\end{pmatrix}",
        "\\begin{array}x",
        "\\begin{array}{}x",
        "\\begin{array}{||}x",
        "\\begin{array}{p{2cm}}x",
        "\\begin{array}{*{2}{c}}x",
        "\\begin{array}{c@{}c}x",
        "\\begin{array}{lXr}x",
        "\\cfrac[c]12",
        "\\cfrac[lr]12",
        "\\cfrac[l{1}{2}",
        "\\cfrac[l\n",
        "\\begin{array}{% comment\n}",
        "\\displaylines[l]{x}",
        "\\left(x\\right}",
        "\\frac",
        "\\frac{1}{",
        "x^",
        "x^\\displaystyle",
        "\\left(x",
        "\\left(x\\right",
        "\\left(x\\rightfoo",
        "\\sqrt[3",
        "\\text{abc",
        "\\overbrace{",
        "\\mathbb",
        "\\textcolor{red}{",
        "\\displaylines{a\\\\b",
        "\\begin{matrix}1&&",
        "\\cfrac[",
        "{ab",
        "\\left[\u{305}x",
        "\\sqrt[\\frac{1}{2}",
    ] {
        assert!(parse(source).is_err(), "{source:?} parsed");
    }
    // 256 levels of commands take about 4 MB of a debug build's stack: the main thread's 8 MB, where the TUI parses,
    // not a test thread's 2 MB.
    let deep = [
        deep("{", "", "}"),
        deep("\\frac", "x", ""),
        deep("\\mathbb{", "x", "}"),
        deep("\\displaylines{", "x", "}"),
        deep("\\color{red}", "x", ""),
        deep("\\text{", "", "}"),
    ];
    let parsed = std::thread::Builder::new()
        .stack_size(8 << 20)
        .spawn(move || deep.iter().map(|source| parse(source).is_err()).collect::<Vec<_>>());
    assert_eq!(parsed.unwrap().join().unwrap(), [true; 6]);
    assert_eq!(parse(&format!("{}{}", "{".repeat(256), "}".repeat(256))), Ok(EMPTY));
    assert_eq!(parse(&format!("{}x{}", "{".repeat(255), "}".repeat(255))), Ok(sym("x")));
}

#[test]
fn empty_scripts_add_no_geometry() {
    for base in [
        "x",
        r"\frac{1}{2}",
        r"\sqrt{x}",
        r"\begin{pmatrix}a\\b\end{pmatrix}",
        r"\overbrace{abcd}",
        r"\underbrace{abcd}",
        r"\sum\limits",
    ] {
        for display in [false, true] {
            let options = Options { display, ..Options::default() };
            let render = |tail: &str| crate::render_with(&format!("{base}{tail}"), &options).unwrap();
            for empty in ["", r"\text{}", r"\textcolor{red}{}"] {
                for tail in [format!("^{{{empty}}}"), format!("_{{{empty}}}"), format!("^{{{empty}}}_{{{empty}}}")] {
                    assert_eq!(render(&tail), render(""), "{base}{tail}");
                }
                assert_eq!(render(&format!("^{{{empty}}}_q")), render("_q"), "{base}");
            }
        }
    }
}

#[test]
fn inline_math_takes_one_row() {
    for (source, expected) in [
        ("x^2", "x²"),
        ("E = mc^2", "E = mc²"),
        ("a_n + b_{ij}", "aₙ + bᵢⱼ"),
        ("\\alpha + \\beta = \\gamma", "α + β = γ"),
        ("x^{ab}", "xᵃᵇ"),
        ("e^{i\\pi}", "e^(iπ)"),
        ("x_{\\alpha}", "x_α"),
        ("\\frac{a}{b}", "a/b"),
        ("\\frac{1}{2}", "1/2"),
        ("\\frac{x+1}{y}", "(x + 1)/y"),
        ("\\frac{1}{1+\\frac{1}{x}}", "1/(1 + 1/x)"),
        ("\\sqrt{2}", "√2"),
        ("\\sqrt{x+1}", "√(x + 1)"),
        ("\\sqrt[3]{x}", "∛x"),
        ("\\sqrt[n]{x}", "ⁿ√x"),
        ("\\sum_{i=1}^{n} i^2", "∑ⁿᵢ₌₁ i²"),
        ("\\sum\\limits_{i=1}^{n} i", "∑ⁿᵢ₌₁ i"),
        ("\\int_0^1 f(x)\\,dx", "∫¹₀ f(x)dx"),
        ("\\lim_{x \\to 0}", "lim_(x → 0)"),
        ("\\hat{x}", "x\u{302}"),
        ("\\vec{v} \\cdot \\bar{u}", "v\u{20d7} · u\u{304}"),
        ("\\overline{AB}", "A\u{305}B\u{305}"),
        ("\\hat{\\frac{a}{b}}", "(a/b)^"),
        ("\\mathbb{R}^n", "ℝⁿ"),
        ("\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}", "(a, b; c, d)"),
        ("\\begin{aligned}x &= 1 \\\\ y &= 2\\end{aligned}", "x = 1; y = 2"),
        ("\\binom{n}{k}", "(n k)"),
        ("\\overset{def}{=}", "=ᵈᵉᶠ"),
        ("\\underbrace{a+b}_{n}", "a + bₙ"),
        ("\\left(\\frac{a}{b}\\right)", "(a/b)"),
        ("f'(x) \\le \\infty", "f'(x) ≤ ∞"),
    ] {
        assert_eq!(inline(source), expected, "{source:?}");
    }
    let line = crate::inline_line("a \\le \\mathit{b}").unwrap();
    assert!(line.iter().any(|span| span.text.contains('≤') && span.bold), "{line:?}");
    assert!(line.iter().any(|span| span.text == "b" && span.italic), "{line:?}");
    assert!(line.iter().all(|span| span.fg.is_none()), "{line:?}");
    for source in ["\\frac{1}{", "x^", "\\unknown", "", " "] {
        assert_eq!(crate::inline_line(source), None, "{source:?}");
    }
}

#[test]
fn accents_on_styled_text() {
    assert_eq!(inline("\\hat{\\mathbf{x}}"), "x\u{302}");
    assert_eq!(inline("\\tilde{\\mathbb{R}}"), "ℝ\u{303}");
}

fn text_mode(source: &str, display: bool, mode: Mode) -> String {
    let options = Options { display, ..Options::default() };
    crate::render_mode(source, &options, mode).unwrap_or_else(|error| panic!("{source:?}: {error}")).to_string()
}

const INCOMPLETE: Mode = Mode { permissive: false, incomplete: true };
const PERMISSIVE: Mode = Mode { permissive: true, incomplete: false };

#[test]
fn the_radical_and_its_index() {
    for (source, expected, width, height, baseline) in [
        ("\\sqrt{x^2+y^2}", " ╭───────\n√ x² + y²", 9, 2, 1),
        ("\\sqrt[3]{x}", "3╭─\n√ x", 3, 2, 1),
        ("\\sqrt[\\frac{1}{2}]{x}", " 1\n───\n 2 ╭─\n  √ x", 5, 4, 3),
        ("\\sqrt[a_b]{x}", "a\n b╭─\n √ x", 4, 3, 2),
        ("\\sqrt[界]{x}", "界╭─\n √ x", 4, 2, 1),
        ("\\sqrt[\\frac{1}{2}]{\\frac{x}{y}}", " 1\n───\n 2 ╭───\n     x\n  √ ───\n     y", 7, 6, 4),
    ] {
        let options = Options { display: false, ..Options::default() };
        let layout = crate::render_with(source, &options).unwrap();
        assert_eq!(
            (layout.to_string().as_str(), layout.width, layout.height, layout.baseline),
            (expected, width, height, baseline),
            "{source:?}"
        );
    }
}

fn text(value: &str) -> Node {
    Node::Text(value.into())
}

fn fraction(denominator: &str, bar: bool, align: Option<crate::parse::Align>) -> Node {
    Node::Fraction { numerator: Box::new(text("1")), denominator: Box::new(text(denominator)), bar, align }
}

#[test]
fn fractions_braces_matrices_and_tall_scripts() {
    for (source, expected) in [
        ("\\frac{1}{12345}", "   1\n───────\n 12345"),
        ("\\underbrace{x}", " x\n╰┬╯"),
        ("\\overbrace{x}", "╭┴╮\n x"),
        ("\\overbrace{abcd}^{n}", " n\n╭┴─╮\nabcd"),
        (
            "\\begin{array}{ | l || r | }a&b\\\\\\frac{1}{2}&cc\\end{array}",
            "│ a   ││  b │\n│  1  ││    │\n│ ─── ││ cc │\n│  2  ││    │",
        ),
        ("\\begin{array}{lcr}a&b&c\\\\long&wide&last\\end{array}", "a     b      c\nlong wide last"),
        ("\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}^2", "     2\n⎛a b⎞\n⎝c d⎠"),
        ("\\frac{1}{2}^2_1", "   2\n 1\n───\n 2\n   1"),
        ("\\begin{aligned}x &= 1 \\\\ yy &= 2\\end{aligned}", " x  = 1\nyy  = 2"),
        ("\\begin{aligned}&=x\\\\&=y\\end{aligned}", "  = x\n  = y"),
        ("\\cfrac[l]{1}{12345}", " 1\n───────\n 12345"),
        ("\\cfrac[r]{1}{12345}", "     1\n───────\n 12345"),
        ("\\displaylines{x=1\\\\y=2}", "x = 1\ny = 2"),
        ("\\begin{array}{l|r}a&wide\\\\long&b\\end{array}", "a    │ wide\nlong │    b"),
        ("\\begin{pmatrix}a & b \\\\ cc & d\\end{pmatrix}", "⎛a  b⎞\n⎝cc d⎠"),
        ("\\begin{cases}x & x \\ge 0 \\\\ -x & x < 0\\end{cases}", "⎧x   x ≥ 0\n⎩-x  x < 0"),
    ] {
        assert_eq!(display(source), expected, "{source:?}");
    }
    let nested =
        display("\\begin{aligned}A &= \\begin{pmatrix}a & b \\\\ c & d\\end{pmatrix} \\\\ z &= 1\\end{aligned}");
    assert!(nested.contains('⎛') && nested.contains('z'), "{nested}");
}

#[test]
fn limits_in_three_ways() {
    for display in [false, true] {
        for (source, expected) in [
            ("\\sum\\limits_1^2", "2\n∑\n1"),
            ("\\sum\\nolimits_1^2", "∑²₁"),
            ("\\int\\limits_1^2", "2\n∫\n1"),
            ("\\sum^2\\nolimits_1", "∑²₁"),
            ("\\sum\\limits\\nolimits_1^2", "∑²₁"),
            ("\\sum\\nolimits\\limits_1^2", "2\n∑\n1"),
            ("\\mathbf{\\sum}\\limits_1^2", "2\n∑\n1"),
            ("\\textcolor{red}{\\sum}\\nolimits_1^2", "∑²₁"),
            ("\\mathbf{\\sin}x", "sin x"),
            ("\\mathbf{\\underbrace{abcd}}_{n}", "abcd\n╰┬─╯\n n"),
            ("\\mathbf{\\sum_1^2}\\nolimits", "∑²₁"),
            ("\\textcolor{red}{\\mathbf{\\sum_1^2}}\\limits", "2\n∑\n1"),
            ("\\mathbf{\\sum_1}\\limits^2", "2\n∑\n1"),
            ("\\mathbf{\\sum^2}\\limits_1", "2\n∑\n1"),
            ("\\textcolor{red}{\\sum_1}\\limits^2", "2\n∑\n1"),
            ("x^\\displaystyle2", "x²"),
        ] {
            assert_eq!(text_mode(source, display, Mode::default()), expected, "{source:?} {display}");
        }
        let display_only = if display { "2\n∑\n1" } else { "∑²₁" };
        assert_eq!(text_mode("\\mathbf{\\sum}_1^2", display, Mode::default()), display_only);
        assert_eq!(text_mode("\\sum_1^2", display, Mode::default()), display_only);
    }
    assert_eq!(text_mode("\\int_1^2", true, Mode::default()), "∫²₁");
    for star in ["", "*"] {
        let Ok(Node::Scripts { base, .. }) = parse(&format!("\\operatorname{star}{{arg\\,max}}_x")) else { panic!() };
        let limits = if star == "*" { Limits::Always } else { Limits::Never };
        assert_eq!(*base, Node::Operator { value: "arg max".into(), limits });
    }
}

#[test]
fn permissive_mode_keeps_unsupported_commands_as_text() {
    for source in ["\\unknown", "\\constructor", "\\toString"] {
        for incomplete in [false, true] {
            let permissive = Mode { permissive: true, incomplete };
            assert_eq!(parse_with(source, permissive), Ok(text(source)), "{source}");
            assert!(parse_with(source, Mode { permissive: false, incomplete }).is_err(), "{source}");
        }
    }
    for source in [
        "\\left\\unknown x\\right)",
        "\\left(x\\right\\unknown",
        "\\big\\unknown",
        "\\left(x\\middle\\unknown y\\right)",
        "\\left ax\\right)",
    ] {
        for incomplete in [false, true] {
            assert!(parse_with(source, Mode { permissive: true, incomplete }).is_ok(), "{source}");
            assert!(parse_with(source, Mode { permissive: false, incomplete }).is_err(), "{source}");
        }
    }
    assert_eq!(text_mode("\\unknown{x}", true, PERMISSIVE), "\\unknownx");
    let Ok(Node::Delimited { left, right, body }) = parse_with("\\left\u{1f431}x\\right\u{1f436}", PERMISSIVE) else {
        panic!()
    };
    assert_eq!((left.as_str(), right.as_str(), *body), ("\u{1f431}", "\u{1f436}", sym("x")));
}

#[test]
fn incomplete_mode_draws_a_prefix_with_placeholders() {
    let incomplete =
        |source: &str| parse_with(source, INCOMPLETE).unwrap_or_else(|error| panic!("{source:?}: {error}"));
    assert_eq!(cells(&incomplete("\\displaylines{a\\\\b")), [vec!["a"], vec!["b"]]);
    assert_eq!(cells(&incomplete("\\begin{matrix}1&&")), [vec!["1", "", PLACEHOLDER]]);
    assert_eq!(cells(&incomplete("\\begin{matrix}1& % comment")), [vec!["1", PLACEHOLDER]]);
    for (source, columns) in [
        ("\\begin{array}", ""),
        ("\\begin{array}{|", "|"),
        ("\\begin{array}{% comment }", ""),
        ("\\begin{array}{lr", "lr"),
    ] {
        let node = incomplete(source);
        assert!(matches!(&node, Node::Matrix { columns: Some(c), .. } if c == columns), "{source:?} {node:?}");
        assert_eq!(cells(&node), [vec![PLACEHOLDER]], "{source:?}");
    }
    for (source, align) in [
        ("\\cfrac[", None),
        ("\\cfrac[l", Some(crate::parse::Align::Left)),
        ("\\cfrac[r", Some(crate::parse::Align::Right)),
    ] {
        assert!(matches!(incomplete(source), Node::Fraction { align: a, .. } if a == align), "{source:?}");
    }
    for (source, expected) in [
        ("\\frac", " □\n───\n □"),
        ("\\operatorname*", "□"),
        ("\\overbrace{", "╭┴╮\n □"),
        ("\\mathbb", "□"),
        ("\\textcolor{red}{", "□"),
        ("\\left(x\\right\\", "(x"),
        ("x\u{305}^", " □\nx\u{305}"),
        ("\\alpha\u{305}^", " □\nα\u{305}"),
        ("\\left[\u{305}x", "[\u{305}x"),
        ("\\sqrt[\\frac{1}{2}", " 1\n───\n 2 ╭─\n  √ □"),
        ("\\sqrt[a_b]{", "a\n b╭─\n √ □"),
        ("\\sum\\limits_", "∑\n□"),
        ("x^\\displaystyle", " □\nx"),
        ("\\begin{matrix}1&&2", "1  2"),
        ("\\left(x\\right", "(x"),
        ("\\begin{matrix}   ", "□"),
        ("\\mathbf{\\sum_1}\\limits^2", "2\n∑\n1"),
        ("\\mathbf{\\sum^2}\\limits_1", "2\n∑\n1"),
        ("\\textcolor{red}{\\sum_1}\\limits^2", "2\n∑\n1"),
        ("a\\not\\mathbf{=}b", "a ≠ b"),
        ("x\\not\\mathrm{\\in}S", "x ∉ S"),
        ("\\mathbf{x}\u{305}", "x\u{305}"),
    ] {
        assert_eq!(text_mode(source, false, INCOMPLETE), expected, "{source:?}");
    }
    for (source, contains) in [
        ("\\frac{1}{", "□"),
        ("\\begin{matrix}1&", "1 □"),
        ("\\begin{matrix}1&   ", "1 □"),
        ("\\text{abc", "abc"),
        ("\\sqrt[3", "□"),
    ] {
        assert!(text_mode(source, false, INCOMPLETE).contains(contains), "{source:?}");
    }
    let both = Mode { permissive: true, incomplete: true };
    assert!(text_mode("\\left(x\\rightfoo", false, both).contains("\\rightfoo"));
    assert!(parse("\\left(x\\rightfoo").is_err());
    for source in [
        "a}b",
        "\\frac}",
        "\\not}",
        "\\left(x\\right}",
        "\\end{matrix}",
        "\\begin{matrix}1\\end{pmatrix}",
        "\\begin{unknown}x",
        "\\alpha\u{305}}",
        "\\begin{array}{p{2cm}}x",
        "\\cfrac[c]12",
        "\\cfrac[l{1}{2}",
        "\\cfrac[l\n",
        "\\displaylines[l]{x}",
        "\\begin{matrix}x}",
    ] {
        assert!(parse_with(source, INCOMPLETE).is_err(), "{source:?} parsed incomplete");
    }
}

#[test]
fn sources_and_blocks_are_bounded() {
    assert_eq!(crate::render(&"x".repeat(4096)).unwrap().width, 4096);
    assert_eq!(crate::render(&"x\u{305}".repeat(1365)).unwrap().width, 1365);
    for source in [String::new(), "x".repeat(4097), "x\u{305}".repeat(1366), "\u{1f600}".repeat(1025), "   ".into()] {
        assert!(crate::render(&source).is_err(), "{} bytes", source.len());
    }
    let roots = format!("{}x{}", "\\sqrt[".repeat(100), "]{x}".repeat(100));
    assert!(crate::render(&roots).is_err());
    let options = Options { display: false, ..Options::default() };
    assert_eq!(layout::layout(&text(&"x".repeat(16384)), &options).map(|l| l.width), Some(16384));
    assert!(layout::layout(&text(&"x".repeat(16385)), &options).is_none());
    let wide = Node::Matrix {
        rows: vec![vec![text(&"x".repeat(8192)), text("y")], vec![fraction("2", true, None), text("z")]],
        environment: Environment::Array,
        columns: Some("|l||r|".into()),
    };
    assert!(layout::layout(&wide, &options).is_none());
    assert!(layout::layout(&Node::Brace { body: Box::new(text(&"x".repeat(8193))), over: true }, &options).is_none());
    assert_eq!(crate::render("\u{1f469}\u{200d}\u{1f52c}^2+\u{1f1e9}\u{1f1f0}").unwrap().width, 8);
    assert_eq!(
        text_mode("\\left#\u{fe0f}\u{20e3}\\frac{1}{2}\\right#\u{fe0f}\u{20e3}", false, PERMISSIVE),
        "#  1 #\n#\u{fe0f}\u{20e3}───#\u{fe0f}\u{20e3}\n#  2 #"
    );
    // Zero-width delimiter marks may fail to render, but must not panic.
    for display in [false, true] {
        for mode in [Mode::default(), INCOMPLETE] {
            let _ = crate::render_mode(
                "\\left\u{3164}\u{305}\\frac{1}{2}\\right.",
                &Options { display, ..Options::default() },
                mode,
            );
        }
    }
}

#[test]
fn alphabets_and_styles() {
    for (variant, value, expected) in [
        ("mathbb", "CHNPQRZaz09", "ℂℍℕℙℚℝℤ𝕒𝕫𝟘𝟡"),
        ("mathcal", "BEFHILMRegoAz9", "ℬℰℱℋℐℒℳℛℯℊℴ𝒜𝓏9"),
        ("mathfrak", "CHIRZaz9", "ℭℌℑℜℨ𝔞𝔷9"),
        ("mathsf", "AZaz09", "𝖠𝖹𝖺𝗓𝟢𝟫"),
        ("mathtt", "AZaz09", "𝙰𝚉𝚊𝚣𝟶𝟿"),
        ("mathrm", "AZaz09", "AZaz09"),
    ] {
        assert_eq!(display(&format!(r"\{variant}{{\text{{{value}α+}}}}")), format!("{expected}α+"));
    }
    assert_eq!(display(r"\mathsf{\mathrm{x}}"), "x");
    let layout = crate::render(r"\textcolor{red}{\mathbf{a\mathit{b}\textcolor{blue}{c}}}d\textcolor{red}{e}").unwrap();
    assert_eq!(layout.to_string(), "abcde");
    let style = |x: usize| {
        let style = &layout.cells[0][x].as_ref().unwrap().style;
        (style.color.as_deref(), style.bold, style.italic)
    };
    assert_eq!(
        [style(0), style(1), style(2), style(3), style(4)],
        [
            (Some("red"), true, false),
            (Some("red"), true, true),
            (Some("blue"), true, false),
            (None, false, false),
            (Some("red"), false, false)
        ]
    );
    for source in [
        r"\frac{1}{2}",
        r"\sqrt[3]{\frac{1}{2}}",
        r"\left[̅\frac{1}{2}\right]̅",
        r"\begin{array}{|l||r|}x&\frac{1}{2}\end{array}",
        r"\begin{cases}x\\y\end{cases}",
        r"\overbrace{abcd}",
        r"\hat{x}",
        r"\underline{x}",
        r"x^2_i",
        r"\frac{1}{2}^q",
        r"\overset{n}{\underset{m}{x}}",
    ] {
        let styled = crate::render(&format!(r"\textcolor{{red}}{{\mathbf{{{source}}}}}")).unwrap();
        assert_eq!(styled.to_string(), display(source), "{source}");
        assert!(
            styled.cells.iter().flatten().flatten().all(|c| c.style.color.as_deref() == Some("red") && c.style.bold),
            "{source}"
        );
    }
    let layout = crate::render(r"x^{\textcolor{blue}{q}}").unwrap();
    assert_eq!(layout.to_string(), " q\nx");
    assert_eq!(layout.cells[0][1].as_ref().unwrap().style.color.as_deref(), Some("blue"));
    assert_eq!(display("\\left[\u{305}\\frac{1}{2}\\right]\u{305}"), "⎡ 1 ⎤\n⎢\u{305}───⎥\u{305}\n⎣ 2 ⎦");
    assert_eq!(display("\\epsilon\\varepsilon\\phi\\varphi"), "ϵεϕφ");
}

#[test]
fn colors_reach_the_rows() {
    use opencode_plugin_abi::{Color, Rgba};
    let red = Some(Color::Rgba(Rgba::new(255, 0, 0, 255)));
    let rows = crate::formula(&crate::render("\\mathbf{x+\\mathit{y}}+\\textcolor{red}{z}").unwrap(), false);
    let spans = &rows[0];
    assert!(spans.iter().any(|span| span.text == "y" && span.bold && span.italic), "{spans:?}");
    assert!(spans.iter().any(|span| span.text == "z" && span.fg == red), "{spans:?}");
    let inline = crate::inline_line("a + \\textcolor{#f00}{b}").unwrap();
    assert!(inline.iter().any(|span| span.text == "b" && span.fg == red), "{inline:?}");
    assert!(inline.iter().filter(|span| span.text != "b").all(|span| span.fg.is_none()), "{inline:?}");
    let unknown = crate::inline_line("\\textcolor{nocolor}{b}").unwrap();
    assert_eq!(unknown[0].fg, None);
}
