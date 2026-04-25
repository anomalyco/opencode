import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Union, Optional, Any, Dict, Tuple

from .models import Span, Trace, ErrorPayload

logger = logging.getLogger(__name__)

def extract_ids(data: Dict, line_num: int) -> Tuple[str, str]:
    """Handles flexible ID extraction from different OTEL JSON flavors."""
    ctx = data.get("context", {})
    span_id = ctx.get("span_id") or data.get("spanId") or f"gen-{line_num}"
    trace_id = ctx.get("trace_id") or data.get("traceId") or "unknown"
    return span_id, trace_id

def parse_time(value: Any) -> Optional[float]:
    """Parses ISO 8601 timestamps to Unix seconds."""
    if not isinstance(value, str) or not value:
        return None
        
    try:
        iso_str = value.replace('Z', '+00:00')
        if '.' in iso_str:
            base, offset = iso_str.split('.')
            # Keep only 6 digits of sub-seconds (microseconds)
            iso_str = f"{base}.{offset[:6]}{offset[6:] if '+' not in offset else '+' + offset.split('+')[-1]}"

        return datetime.fromisoformat(iso_str).timestamp()
    except Exception as e:
        logger.debug(f"Failed to parse timestamp {value}: {e}")
        return None

def normalize_time(data: Dict) -> Tuple[float, Optional[float]]:
    """Converts nanoseconds from various OTEL formats to Unix seconds."""
    start = data.get("start_time") or data.get("startTimeUnixNano")
    end = data.get("end_time") or data.get("endTimeUnixNano")
    return parse_time(start), parse_time(end)

def normalize_status(data: Dict) -> str:
    """Maps various status formats (numeric/string) to a unified OK/ERROR/UNSET."""
    status_obj = data.get("status", {})
    raw_status = status_obj.get("status_code") or status_obj.get("code")
    
    if raw_status in [1, "STATUS_CODE_OK", "OK"]: return "OK"
    if raw_status in [2, "STATUS_CODE_ERROR", "ERROR"]: return "ERROR"
    return "UNSET"

def map_line_to_span(line: str, line_num: int, default_trace_id: str) -> Optional[Span]:
    """Transforms a single JSON line into a Span object."""
    try:
        data = json.loads(line)
        if not isinstance(data, dict): return None
        
        span_id, trace_id = extract_ids(data, line_num)
        start, end = normalize_time(data)
        status = normalize_status(data)
        
        return Span(
            span_id=span_id,
            trace_id=trace_id if trace_id != "unknown" else default_trace_id,
            name=data.get("name", "unnamed_span"),
            start_time=start or 0.0,
            end_time=end,
            status=status,
            parent_span_id=data.get("parent_id") or data.get("parentSpanId"),
            attributes=data.get("attributes", {})
        )
    except (json.JSONDecodeError, TypeError, ValueError) as e:
        logger.warning(f"Line {line_num}: Failed to decode JSON. Skipping. Error: {e}")
        return None

def parse_trace_file(file_path: Union[str, Path]) -> Union[Trace, ErrorPayload]:
    """Reads a FastCI OpenTelemetry JSONL file and normalizes it."""
    path = Path(file_path)
    if not path.exists():
        return ErrorPayload(
            status="error",
            error_type="FileNotFound",
            message=f"Trace file not found at {path}",
            suggestion="Ensure the trace artifact is downloaded to the correct path."
        )

    spans: List[Span] = []
    global_trace_id = "unknown"

    try:
        with path.open('r', encoding='utf-8') as f:
            for i, line in enumerate(f, 1):
                clean_line = line.strip()
                if not clean_line: continue
                
                span = map_line_to_span(clean_line, i, global_trace_id)
                if span:
                    if global_trace_id == "unknown" and span.trace_id != "unknown":
                        global_trace_id = span.trace_id
                    spans.append(span)
                    
        return Trace(trace_id=global_trace_id, spans=spans)
        
    except Exception as e:
        logger.error(f"Parser failure: {e}")
        return ErrorPayload(
            status="error",
            error_type="ParserException",
            message="An unexpected error occurred while parsing the trace file.",
            suggestion="Check logs for details or verify the JSONL format."
        )