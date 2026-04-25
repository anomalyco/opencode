import sys
import json
import argparse
import logging
import dataclasses
from pathlib import Path

# Enforce module execution to prevent Absolute Import crashes
if __package__ is None or __package__ == "":
    print("Error: Improper execution context.")
    print("This tool is part of the 'tools' package and must be run as a module from the project root.")
    print("Correct usage: python3 -m tools.fastci_cli <command> [args]")
    sys.exit(1)

from tools.models import to_dict, Trace, ErrorPayload, Span, DiagnosticReport, PreflightReport
from tools.preflight import execute_preflight
from tools.parser import parse_trace_file
from tools.diagnostics import analyze_trace
from tools.visualizer import generate_mermaid_gantt

logger = logging.getLogger(__name__)

def setup_logging(verbose: bool):
    # Logs go to stderr so they don't corrupt the stdout JSON/Markdown payload
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(level=level, format='%(levelname)s: %(message)s', stream=sys.stderr)

def check_file_exists(file_path: str):
    path = Path(file_path)
    if not path.is_file():
        return ErrorPayload(status="error", error_type="FileNotFound", message=f"Trace file not found: {file_path}")
    return None

def handle_preflight(args): 
    return execute_preflight()

def handle_parse(args):
    err = check_file_exists(args.file)
    if err: 
        return err
    return parse_trace_file(args.file)

def handle_diagnose(args):
    err = check_file_exists(args.file)
    if err: 
        return err
    trace = parse_trace_file(args.file)
    return analyze_trace(trace) if isinstance(trace, Trace) else trace

def handle_visualize(args):
    err = check_file_exists(args.file)
    if err: 
        return err
    trace = parse_trace_file(args.file)
    return generate_mermaid_gantt(trace) if isinstance(trace, Trace) else trace

def handle_schema(args):
    """Dynamically generates a JSON representation of our Data Contracts for the AI."""
    def extract_fields(dc):
        return {f.name: str(f.type).replace("typing.", "") for f in dataclasses.fields(dc)}
    
    schema = {
        "Span": extract_fields(Span),
        "DiagnosticReport": extract_fields(DiagnosticReport),
        "PreflightReport": extract_fields(PreflightReport)
    }
    return {"status": "ok", "schema": schema}

def main():
    parser = argparse.ArgumentParser(description="FastCI Agent CLI - Enterprise CI Optimization Tool")
    parser.add_argument("-v", "--verbose", action="store_true", help="Enable debug logging")
    subparsers = parser.add_subparsers(dest="command", required=True)

    sp_preflight = subparsers.add_parser("preflight", help="Run Phase 0 checks")
    sp_preflight.set_defaults(func=handle_preflight)

    sp_parse = subparsers.add_parser("parse", help="Parse trace.jsonl into JSON summary")
    sp_parse.add_argument("file", type=str)
    sp_parse.set_defaults(func=handle_parse)

    sp_diag = subparsers.add_parser("diagnose", help="Run diagnostics on trace")
    sp_diag.add_argument("file", type=str)
    sp_diag.set_defaults(func=handle_diagnose)

    sp_viz = subparsers.add_parser("visualize", help="Generate Mermaid.js chart")
    sp_viz.add_argument("file", type=str)
    sp_viz.set_defaults(func=handle_visualize)

    sp_schema = subparsers.add_parser("schema", help="Output JSON schemas for AI understanding")
    sp_schema.set_defaults(func=handle_schema)

    args = parser.parse_args()
    setup_logging(args.verbose)

    try:
        result = args.func(args)

        output_dict = to_dict(result) if dataclasses.is_dataclass(result) else result
        print(json.dumps(output_dict, indent=2))

        has_error = isinstance(result, ErrorPayload) or output_dict.get("status") == "error"
        sys.exit(2 if has_error else 0)
        
    except Exception as e:
        logger.error(f"CLI failed: {e}", exc_info=args.verbose)
        print(json.dumps({"status": "error", "error_type": "CLIException", "message": str(e)}, indent=2))
        sys.exit(1)

if __name__ == "__main__":
    main()