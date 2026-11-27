//! Times compiling and running widget steps natively: `cargo run --release -p widget-web --example step --
//! <program.js> <data.json>` (the program is prelude + "\n" + source).

use std::time::Instant;

use widget_web::Program;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let program = std::fs::read_to_string(&args[1]).expect("a program file");
    let data = std::fs::read_to_string(&args[2]).expect("a data file");
    let t = Instant::now();
    let p = Program::new(&(program + "\nreturn __widget_step(__input())"), None).expect("compiles");
    println!("compile {:.2} ms", t.elapsed().as_secs_f64() * 1000.0);
    for i in 0..5 {
        let t = Instant::now();
        let out = p
            .run(
                &format!(r#"{{"phase":"init","data":{data}}}"#),
                Some(250),
                None,
            )
            .expect("runs");
        println!(
            "init #{i} {:.2} ms, {} bytes",
            t.elapsed().as_secs_f64() * 1000.0,
            out.len()
        );
    }
}
