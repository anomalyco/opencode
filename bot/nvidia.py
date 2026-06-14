"""
NVIDIA GPU utilities for getting GPU information.
"""
import asyncio
import re
from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class GPUInfo:
    """Information about a single GPU."""
    id: int
    name: str
    utilization: int  # percentage
    temperature: int  # Celsius
    perf_state: str  # P0-P8
    power_usage: int  # Watts
    power_cap: int  # Watts
    memory_used: int  # MiB
    memory_total: int  # MiB

    @property
    def memory_percent(self) -> int:
        """Calculate memory usage percentage."""
        if self.memory_total == 0:
            return 0
        return int(self.memory_used * 100 / self.memory_total)


@dataclass
class NvidiaInfo:
    """Complete NVIDIA information."""
    smi_version: str
    driver_version: str
    cuda_version: str
    gpus: List[GPUInfo] = field(default_factory=list)

    @property
    def gpu_count(self) -> int:
        return len(self.gpus)


async def run_nvidia_smi(timeout: int = 30, path: str = "nvidia-smi") -> bytes:
    """
    Execute nvidia-smi command and return raw output.

    Args:
        timeout: Timeout in seconds
        path: Path to nvidia-smi executable

    Returns:
        Raw bytes output from nvidia-smi

    Raises:
        FileNotFoundError: If nvidia-smi not found
        asyncio.TimeoutError: If command times out
        subprocess.SubprocessError: On other errors
    """
    try:
        process = await asyncio.create_subprocess_exec(
            path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _stderr = await asyncio.wait_for(
            process.communicate(),
            timeout=timeout,
        )

        if process.returncode != 0:
            raise subprocess.SubprocessError(
                f"nvidia-smi returned non-zero exit code: {process.returncode}",
            )

        return stdout
    except FileNotFoundError:
        raise FileNotFoundError(
            "nvidia-smi not found. Install NVIDIA drivers."
        )


# Regex patterns for parsing
_VERSION_LINE_RE = re.compile(
    r"NVIDIA-SMI\s+(\S+)\s+Driver Version:\s+(\S+)\s+CUDA Version:\s+(\S+)"
)

_GPU_HEADER_RE = re.compile(
    r"\|\s+(\d+)\s+(NVIDIA\s+\S+(?:\s+\S+)*?)\s+(On|Off)"
)

# Stats line: "50%   56C    P2            111W /  300W |   11248MiB /  24576MiB |      0%      Default"
_STATS_LINE_RE = re.compile(
    r"(\d+)%\s+(\d+)C\s+(P\d)\s+(\d+)W\s+/\s+(\d+)W\s+\|\s+(\d+)MiB\s+/\s+(\d+)MiB\s+\|\s+(\d+)%\s+(\S+)"
)


def parse_nvidia_smi(raw_output: bytes) -> NvidiaInfo:
    """
    Parse nvidia-smi output into NvidiaInfo structure.

    Args:
        raw_output: Raw bytes output from nvidia-smi

    Returns:
        Parsed NvidiaInfo structure

    Raises:
        ValueError: If output cannot be parsed
    """
    text = raw_output.decode("utf-8", errors="replace")
    lines = text.strip().split("\n")

    smi_version = "unknown"
    driver_version = "unknown"
    cuda_version = "unknown"
    gpus = []

    current_gpu = None

    for line in lines:
        line = line.strip()

        # Parse version line: "NVIDIA-SMI 595.58.03  Driver Version: 595.58.03  CUDA Version: 13.2"
        version_match = _VERSION_LINE_RE.search(line)
        if version_match:
            smi_version = version_match.group(1)
            driver_version = version_match.group(2)
            cuda_version = version_match.group(3)
            continue

        # Parse GPU header line: "|   0  NVIDIA GeForce RTX 3090        Off |"
        gpu_header_match = _GPU_HEADER_RE.search(line)
        if gpu_header_match:
            gpu_id = int(gpu_header_match.group(1))
            gpu_name = gpu_header_match.group(2).strip()
            current_gpu = GPUInfo(
                id=gpu_id,
                name=gpu_name,
                utilization=0,
                temperature=0,
                perf_state="",
                power_usage=0,
                power_cap=0,
                memory_used=0,
                memory_total=0,
            )
            gpus.append(current_gpu)
            continue

        # Parse stats line: "50%   56C    P2            111W /  300W |   11248MiB /  24576MiB |      0%      Default"
        # Groups: (1)util%, (2)tempC, (3)perf, (4)powerW, (5)capW, (6)memUsed, (7)memTotal, (8)utilAfterPipe, (9)mode
        if current_gpu and _STATS_LINE_RE.search(line):
            match = _STATS_LINE_RE.search(line)
            if match:
                current_gpu.utilization = int(match.group(1))
                current_gpu.temperature = int(match.group(2))
                current_gpu.perf_state = match.group(3)
                current_gpu.power_usage = int(match.group(4))
                current_gpu.power_cap = int(match.group(5))
                current_gpu.memory_used = int(match.group(6))
                current_gpu.memory_total = int(match.group(7))
                current_gpu = None

    return NvidiaInfo(
        smi_version=smi_version,
        driver_version=driver_version,
        cuda_version=cuda_version,
        gpus=gpus,
    )


def format_for_vk(info: NvidiaInfo) -> str:
    """
    Format NvidiaInfo as concise text suitable for VK message.
    Only includes essential information.

    Args:
        info: Parsed NvidiaInfo structure

    Returns:
        Formatted text string
    """
    lines = [
        f"🖥️  NVIDIA {info.gpu_count}x GPU",
        f"Driver: {info.driver_version} | CUDA: {info.cuda_version}",
        "─" * 40,
    ]

    for gpu in info.gpus:
        lines.append(
            f"GPU {gpu.id}: {gpu.name}"
        )
        lines.append(
            f"  {gpu.utilization}%  {gpu.temperature}C  {gpu.perf_state}  "
            f"{gpu.power_usage}W/{gpu.power_cap}W  "
            f"{gpu.memory_used}/{gpu.memory_total}MiB ({gpu.memory_percent}%)"
        )

    return "\n".join(lines)


def format_gpu_simple(info: NvidiaInfo) -> str:
    """
    Format GPU info as simple one-line per GPU (nvidia-smi style).

    Args:
        info: Parsed NvidiaInfo structure

    Returns:
        Formatted text string with one line per GPU
    """
    lines = []
    for gpu in info.gpus:
        lines.append(
            f"{gpu.utilization}%   {gpu.temperature}C    {gpu.perf_state}             "
            f"{gpu.power_usage}W /  {gpu.power_cap}W |   {gpu.memory_used}MiB /  "
            f"{gpu.memory_total}MiB |      {gpu.memory_percent}%      Default"
        )
    return "\n".join(lines)


async def get_gpu_simple_message(timeout: int = 30) -> tuple[Optional[str], Optional[str]]:
    """
    Get GPU information in simple format for VK message.

    Args:
        timeout: Timeout in seconds

    Returns:
        Tuple of (message_text, error_text) - one will be None
    """
    try:
        raw_output = await run_nvidia_smi(timeout=timeout)
        info = parse_nvidia_smi(raw_output)
        message = format_gpu_simple(info)
        return message, None
    except FileNotFoundError:
        return None, "nvidia-smi not found. Install NVIDIA drivers."
    except asyncio.TimeoutError:
        return None, "nvidia-smi timed out. GPU driver may have issues."
    except Exception as e:
        return None, f"Error: {str(e)[:2000]}"


async def get_gpu_info_vk_message(timeout: int = 30) -> tuple[Optional[str], Optional[str]]:
    """
    Get GPU information and format as VK message.

    Convenience function that runs nvidia-smi, parses, and formats output.

    Args:
        timeout: Timeout in seconds

    Returns:
        Tuple of (message_text, error_text) - one will be None
    """
    try:
        raw_output = await run_nvidia_smi(timeout=timeout)
        info = parse_nvidia_smi(raw_output)
        message = format_for_vk(info)
        return message, None
    except FileNotFoundError:
        return None, "nvidia-smi not found. Install NVIDIA drivers."
    except asyncio.TimeoutError:
        return None, "nvidia-smi timed out. GPU driver may have issues."
    except Exception as e:
        return None, f"Error: {str(e)[:2000]}"
