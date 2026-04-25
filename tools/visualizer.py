import logging
import re
from typing import Union, Dict, Any, List

from .models import Trace, Span, ErrorPayload

logger = logging.getLogger(__name__)

def sanitize_string(text: str, is_id: bool = False) -> str:
    """Removes or replaces characters that could break Mermaid syntax."""
    if not text:
        return "unnamed"
    if is_id:
        # Keep only alphanumeric and underscores
        return re.sub(r'[^a-zA-Z0-9_]', '_', str(text))
    # Remove colons, commas, quotes, brackets, and parentheses
    return re.sub(r'[:,"\'\(\)\[\]{}]', ' ', str(text)).strip() or "unnamed_task"

def apply_semantic_zooming(spans: List[Span], max_spans: int = 50) -> List[Span]:
    """Protects the rendering engine by filtering down to the longest and most critical spans."""
    if len(spans) <= max_spans:
        return sorted(spans, key=lambda x: x.start_time or 0.0)
        
    logger.warning(f"Trace too large ({len(spans)} spans). Truncating to top {max_spans} critical spans.")
    critical_spans = sorted(spans, key=lambda x: x.duration_ms or 0.0, reverse=True)[:max_spans]
    return sorted(critical_spans, key=lambda x: x.start_time or 0.0)

def format_mermaid_line(span: Span, index: int, min_start_sec: float) -> str:
    """Formats a single span into a Mermaid Gantt line."""
    safe_name = sanitize_string(span.name, is_id=False)
    safe_id = f"task_{index}_{sanitize_string(span.span_id, is_id=True)}"
    
    start_ms = int(((span.start_time or 0.0) - min_start_sec) * 1000)
    end_ms = int(((span.end_time or 0.0) - min_start_sec) * 1000)
    
    # Ensure duration is at least 1ms to render properly in Mermaid
    if end_ms <= start_ms:
        end_ms = start_ms + 1
        
    # Mermaid syntax: Task Name : [status,] id, start, end
    status_tag = "crit, " if span.status == "ERROR" else ""
    return f"    {safe_name} :{status_tag}{safe_id}, {start_ms}, {end_ms}"

def generate_mermaid_gantt(trace: Trace) -> Union[Dict[str, Any], ErrorPayload]:
    """Transforms a Trace object into a Mermaid.js Gantt chart string."""
    if not trace.spans:
        return ErrorPayload(
            status="error",
            error_type="EmptyTrace",
            message="Cannot visualize an empty trace.",
            suggestion="Provide a valid parsed trace with populated spans."
        )

    valid_spans = [s for s in trace.spans if s.end_time is not None and s.start_time is not None]
    if not valid_spans:
        return ErrorPayload(
            status="error",
            error_type="NoValidSpans",
            message="No spans with valid start and end times found.",
            suggestion="Check if the pipeline crashed before completing any steps."
        )

    rendered_spans = apply_semantic_zooming(valid_spans)
    min_start_sec = rendered_spans[0].start_time

    mermaid_lines = [
        "```mermaid",
        "gantt",
        "    title FastCI Pipeline Execution Trace",
        "    dateFormat x",
        "    axisFormat %M:%S",
        "    section Execution Steps"
    ]
    
    for idx, span in enumerate(rendered_spans):
        mermaid_lines.append(format_mermaid_line(span, idx, min_start_sec))

    mermaid_lines.append("```")

    return {
        "status": "ok",
        "mermaid_syntax": "\n".join(mermaid_lines),
        "span_count": len(rendered_spans),
        "original_span_count": len(valid_spans)
    }