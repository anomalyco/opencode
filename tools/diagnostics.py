import logging
import hashlib
from typing import List, Dict, Tuple, Union

from .models import Trace, Span, DiagnosticReport, ErrorPayload, CacheEfficiencyReport

logger = logging.getLogger(__name__)

def validate_spans(spans: List[Span]) -> Tuple[List[Span], List[Span], List[str]]:
    """Validates spans for missing IDs, duplicates, and populates warnings for any issues found."""
    warnings: List[str] = []
    valid_id_spans: List[Span] = []
    seen_ids = set()

    for s in spans:
        if not s.span_id:
            warnings.append(f"Skipped span with missing ID: '{s.name}'")
            continue
        if s.span_id in seen_ids:
            warnings.append(f"Duplicate span ID detected and skipped: {s.span_id}")
            continue
            
        seen_ids.add(s.span_id)
        valid_id_spans.append(s)

    completed_spans = [s for s in valid_id_spans if s.start_time is not None and s.end_time is not None]
    return valid_id_spans, completed_spans, warnings

def calculate_topology_hash(spans: List[Span]) -> str:
    """Generates a fingerprint (AST Hash) representing the trace topology for quick comparisons."""
    sorted_spans = sorted(spans, key=lambda s: s.start_time or 0.0)
    topology_string = "-".join([s.name.strip() for s in sorted_spans])
    return hashlib.sha256(topology_string.encode('utf-8')).hexdigest()[:8]

def detect_anomalies(spans: List[Span]) -> Tuple[List[Dict], List[Dict], List[Dict]]:
    """Detecs OOM, silent failures, and zombie processes."""
    oom_spans = []
    silent_failures = []
    zombies = []
    
    for s in spans:
        if s.end_time is None:
            zombies.append({"name": s.name, "span_id": s.span_id})
            continue

        attr = s.attributes
        exit_code = attr.get("exit_code") if attr.get("exit_code") is not None else attr.get("exitCode")
        error_msg = str(attr.get("error.message")).lower() if attr.get("error.message") is not None else ""
        
        if exit_code == 137 or "out of memory" in error_msg or "oom" in error_msg:
            oom_spans.append({"name": s.name, "span_id": s.span_id, "exit_code": 137})
        elif s.status == "ERROR" or (exit_code is not None and exit_code != 0):
            silent_failures.append({
                "name": s.name, 
                "span_id": s.span_id, 
                "exit_code": exit_code,
                "error_msg": attr.get("error.message", "Unknown failure")
            })
            
    return oom_spans, silent_failures, zombies

def analyze_performance(valid_spans: List[Span], completed_spans: List[Span]) -> Tuple[List[Dict], List[Dict]]:
    """Detects bottlenecks and missing instrumentation (Opaque Spans running > 60s)."""
    children_map: Dict[str, List[str]] = {s.span_id: [] for s in valid_spans}
    for s in valid_spans:
        if s.parent_span_id and s.parent_span_id in children_map:
            children_map[s.parent_span_id].append(s.span_id)

    sorted_completed = sorted(completed_spans, key=lambda x: x.duration_ms or 0.0, reverse=True)
    top_bottlenecks = [
        {"name": s.name, "duration_ms": s.duration_ms, "span_id": s.span_id}
        for s in sorted_completed[:5]
    ]

    missing_inst = []
    for s in completed_spans:
        dur = s.duration_ms or 0.0
        if not children_map.get(s.span_id) and dur > 60000:
            missing_inst.append({"name": s.name, "duration_ms": dur, "span_id": s.span_id})

    return top_bottlenecks, missing_inst

def calculate_timing(completed_spans: List[Span]) -> Tuple[float, float]:
    """Calculates total wall-clock time and concurrency score."""
    start_times = [s.start_time for s in completed_spans if s.start_time is not None]
    end_times = [s.end_time for s in completed_spans if s.end_time is not None]
    
    if not start_times or not end_times:
        return 0.0, 1.0
        
    wall_clock_ms = max(0.0, (max(end_times) - min(start_times)) * 1000)
    total_compute_ms = sum((s.duration_ms or 0.0) for s in completed_spans)
    
    concurrency_score = 1.0
    # Use threshold to avoid extreme ratios on tiny traces
    if wall_clock_ms > 10.0:
        concurrency_score = round(total_compute_ms / wall_clock_ms, 2)
        
    return wall_clock_ms, concurrency_score

def analyze_finops(completed_spans: List[Span]) -> CacheEfficiencyReport:
    """Analyzes resource savings and cache usage."""
    cache_keywords = ["cache", "restore", "save", "download", "pull"]
    cache_spans = [s for s in completed_spans if any(kw in s.name.lower() for kw in cache_keywords)]
    cache_duration = sum((s.duration_ms or 0.0) for s in cache_spans)
    
    # Heuristic: $0.005 saved per second of network transfer skipped
    est_savings = (cache_duration / 1000.0) * 0.005
    
    return CacheEfficiencyReport(
        total_cache_spans=len(cache_spans),
        cache_duration_ms=cache_duration,
        estimated_savings_usd=round(est_savings, 4)
    )

def analyze_trace(trace: Trace) -> Union[DiagnosticReport, ErrorPayload]:
    """
    Analyzes a parsed Trace object and generates actionable insights for the AI Agent.
    Implements robust time calculations, AST hashing, and FinOps metrics.
    """
    if not trace.spans:
        return ErrorPayload(
            status="error",
            error_type="EmptyTrace",
            message="The provided trace contains no spans.",
            suggestion="Verify the trace generation in FastCI."
        )

    valid_spans, completed_spans, warnings = validate_spans(trace.spans)
    
    oom_spans, silent_failures, zombies = detect_anomalies(valid_spans)
    top_bottlenecks, missing_inst = analyze_performance(valid_spans, completed_spans)
    wall_clock_ms, concurrency_score = calculate_timing(completed_spans)
    cache_report = analyze_finops(completed_spans)
    topology_hash = calculate_topology_hash(valid_spans)

    return DiagnosticReport(
        top_bottlenecks=top_bottlenecks,
        silent_failures=silent_failures,
        zombie_spans=zombies,
        oom_spans=oom_spans,
        missing_instrumentation=missing_inst,
        concurrency_score=concurrency_score,
        total_duration_ms=wall_clock_ms,
        topology_hash=topology_hash,
        cache_report=cache_report,
        warnings=warnings
    )