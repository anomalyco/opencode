//! Measures the native stack a program needs, by running it on threads of different stack sizes in child processes
//! and bisecting for the smallest size that does not overflow.
//!
//! `stack_probe` prints, for each construct, the stack bytes per nesting level of compiling it.
//! `stack_probe <construct> <depth> <stack bytes> [run]` compiles (and with `run`, runs) one program and exits 0.

use psychoscript::{ProgramOptions, Runtime};

const CONSTRUCTS: &[&str] = &[
    "parens",
    "arrays",
    "objects",
    "blocks",
    "calls",
    "arrows",
    "functions",
    "if-else",
    "if",
    "unary",
    "ternary",
    "assign",
    "binary",
    "members",
    "template",
    "typeof",
    "void",
    "await",
    "new",
    "negate",
    "spread",
    "destructure",
    "pattern",
    "optional",
    "labels",
    "while",
];

fn source(construct: &str, n: usize) -> String {
    let rep = |s: &str| s.repeat(n);
    match construct {
        "parens" => format!("return {}1{}", rep("("), rep(")")),
        "arrays" => format!("return {}1{}", rep("["), rep("]")),
        "objects" => format!("return {}1{}", rep("{a:"), rep("}")),
        "blocks" => format!("{}{}return 1", rep("{"), rep("}")),
        "calls" => format!("const f = (x) => x; return {}1{}", rep("f("), rep(")")),
        "arrows" => format!("return {}1", rep("() => ")),
        "functions" => format!("return {}1{}", rep("function () { return "), rep(" }")),
        "if-else" => format!("let a = 1; {}{{}} return 1", rep("if (a) {} else ")),
        "if" => format!("let a = 1; {}a = 2; return a", rep("if (a) ")),
        "unary" => format!("return {}1", rep("!")),
        "ternary" => format!("let a = 1; return {}0", rep("a ? 1 : ")),
        "assign" => format!("let a; return {}1", rep("a = ")),
        "binary" => format!("return 1{}", rep(" + 1")),
        "members" => format!(
            "const o = {{ a() {{ return o }} }}; return o{}",
            rep(".a()")
        ),
        "template" => format!("return {}1{}", rep("`${"), rep("}`")),
        "typeof" => format!("return {}1", rep("typeof ")),
        "void" => format!("return {}1", rep("void ")),
        "await" => format!("return {}1", rep("await ")),
        "new" => format!("function F() {{}} return {}F{}", rep("new "), rep("()")),
        "negate" => format!("return {}1", rep("- ")),
        "spread" => format!("return {}1{}", rep("[..."), rep("]")),
        "destructure" => format!("const {}a{} = 1; return 1", rep("["), rep("]")),
        "pattern" => format!("let a; ({}a{} = {{}}); return 1", rep("{a:"), rep("}")),
        "optional" => format!("const o = {{}}; return o{}", rep("?.a")),
        "labels" => format!(
            "{}break a0; return 1",
            (0..n).map(|i| format!("a{i}: ")).collect::<String>()
        ),
        "while" => format!("let a = 0; {}a = 1; return a", rep("while (a) ")),
        // Native re-entrancy at run time: each level calls back into the VM through a built-in.
        "map" => {
            format!("function f(n) {{ return n ? [n].map((x) => f(x - 1))[0] : 0 }} return f({n})")
        }
        "sort" => format!(
            "function f(n) {{ if (n) [2, 1].sort((a, b) => (f(n - 1), a - b)); return 0 }} return f({n})"
        ),
        "tostring" => format!(
            "function f(n) {{ return n ? String({{ toString() {{ return f(n - 1) }} }}) : '0' }} return f({n})"
        ),
        "replace" => format!(
            "function f(n) {{ return n ? 'a'.replace('a', () => f(n - 1)) : '0' }} return f({n})"
        ),
        other => panic!("unknown construct {other}"),
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() >= 3 {
        let (construct, depth, stack) =
            (&args[0], args[1].parse().unwrap(), args[2].parse().unwrap());
        let run = args.get(3).is_some_and(|a| a == "run");
        let code = source(construct, depth);
        let ok = std::thread::Builder::new()
            .stack_size(stack)
            .spawn(move || {
                let rt = Runtime::make();
                let program = rt.program(&code, &ProgramOptions::new());
                if run {
                    let outcome = program.run().expect("not interrupted");
                    if let Err(d) = outcome.result {
                        eprintln!("{:?}", d.message);
                        return false;
                    }
                }
                true
            })
            .unwrap()
            .join()
            .unwrap();
        std::process::exit(if ok { 0 } else { 2 });
    }
    let run = args.first().is_some_and(|a| a == "run");
    let constructs: Vec<&str> = if run {
        vec!["map", "sort", "tostring", "replace"]
    } else {
        CONSTRUCTS.to_vec()
    };
    let (lo, hi) = match (run, cfg!(debug_assertions)) {
        (true, true) => (500, 4500),
        (true, false) => (500, 4500),
        _ => (200, 600),
    };
    for construct in constructs {
        let a = smallest(construct, lo, run);
        let b = smallest(construct, hi, run);
        let per = (b as f64 - a as f64) / (hi - lo) as f64;
        println!("{construct:10} {lo}: {a:>9} B  {hi}: {b:>9} B  per level: {per:>7.0} B");
    }
}

/// The smallest thread stack, to 1 KiB, that runs the construct at that depth.
fn smallest(construct: &str, depth: usize, run: bool) -> usize {
    let exe = std::env::current_exe().unwrap();
    let ok = |stack: usize| {
        let mut cmd = std::process::Command::new(&exe);
        cmd.args([construct, &depth.to_string(), &stack.to_string()]);
        if run {
            cmd.arg("run");
        }
        cmd.stderr(std::process::Stdio::null())
            .status()
            .is_ok_and(|s| s.success())
    };
    let (mut lo, mut hi) = (16 << 10, 512 << 20);
    assert!(ok(hi), "{construct} at {depth} fails even with {hi} bytes");
    while hi - lo > 1024 {
        let mid = (lo + hi) / 2;
        if ok(mid) { hi = mid } else { lo = mid }
    }
    hi
}
