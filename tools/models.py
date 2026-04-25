import dataclasses
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Any

# ---------------------------------------------------------
# 1. OpenTelemetry Trace Models
# ---------------------------------------------------------
@dataclass
class Span:
    """Represents a single step or job in the CI pipeline."""
    span_id: str
    trace_id: str
    name: str
    start_time: float
    end_time: Optional[float]
    status: str
    parent_span_id: Optional[str] = None
    attributes: Dict[str, Any] = field(default_factory=dict)
    
    def __post_init__(self):
        """Validate state immediately after initialization."""
        if self.end_time is not None and self.start_time is not None:
            if self.end_time < self.start_time:
                self.end_time = self.start_time

    @property
    def duration_ms(self) -> Optional[float]:
        """Returns the duration in milliseconds, or None if zombie."""
        if self.end_time is not None and self.start_time is not None:
            return (self.end_time - self.start_time) * 1000
        return None

@dataclass
class Trace:
    """Represents the entire CI run."""
    trace_id: str
    spans: List[Span] = field(default_factory=list)

# ---------------------------------------------------------
# 2. Phase 0 & FinOps Models
# ---------------------------------------------------------
@dataclass
class PreflightReport:
    """Result of the Phase 0 environment and auth checks."""
    status: str
    checks_passed: bool
    reason: Optional[str] = None
    tech_stacks: List[str] = field(default_factory=list)
    is_monorepo: bool = False
    active_agent_branches: List[str] = field(default_factory=list)

@dataclass
class CacheEfficiencyReport:
    """FinOps analytics for cache hit/miss estimation."""
    total_cache_spans: int = 0
    cache_duration_ms: float = 0.0
    estimated_savings_usd: float = 0.0

# ---------------------------------------------------------
# 3. Phase 2: Diagnostic Models
# ---------------------------------------------------------
@dataclass
class DiagnosticReport:
    """The summarized findings provided to the AI Agent."""
    top_bottlenecks: List[Dict[str, Any]] = field(default_factory=list)
    silent_failures: List[Dict[str, Any]] = field(default_factory=list)
    zombie_spans: List[Dict[str, Any]] = field(default_factory=list)
    oom_spans: List[Dict[str, Any]] = field(default_factory=list)
    missing_instrumentation: List[Dict[str, Any]] = field(default_factory=list)
    concurrency_score: float = 0.0
    total_duration_ms: float = 0.0
    topology_hash: str = ""
    cache_report: Optional[CacheEfficiencyReport] = None
    warnings: List[str] = field(default_factory=list)

# ---------------------------------------------------------
# 4. Error Handling Model
# ---------------------------------------------------------
@dataclass
class ErrorPayload:
    """Structured error for Graceful Degradation."""
    status: str = "error"
    error_type: str = "UnknownError"
    message: str = ""
    suggestion: str = "Halt execution and report to the DevOps team."

# ---------------------------------------------------------
# Helper function for JSON serialization
# ---------------------------------------------------------
def to_dict(obj: Any) -> Any:
    """Recursively converts dataclasses and primitives to dicts for JSON output."""
    if dataclasses.is_dataclass(obj):
        result = {}
        for f in dataclasses.fields(obj):
            result[f.name] = to_dict(getattr(obj, f.name))
        
        if isinstance(obj, Span):
            result["duration_ms"] = obj.duration_ms
            
        return result
        
    elif isinstance(obj, list):
        return [to_dict(item) for item in obj]
    elif isinstance(obj, dict):
        return {key: to_dict(value) for key, value in obj.items()}
    else:
        return obj