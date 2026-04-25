import logging
import subprocess
from pathlib import Path
from typing import Tuple, List

from .models import PreflightReport

logger = logging.getLogger(__name__)

def run_command(cmd: List[str]) -> Tuple[int, str, str]:
    """Helper to run shell commands safely and capture output."""
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=False)
        return result.returncode, result.stdout.strip(), result.stderr.strip()
    except FileNotFoundError:
        logger.debug(f"Executable not found for command: {cmd[0]}")
        return -1, "", f"Executable '{cmd[0]}' not found in PATH."
    except Exception as e:
        logger.debug(f"Command failed: {cmd}. Error: {e}")
        return -1, "", str(e)

def check_git_status() -> Tuple[bool, str]:
    """Checks if the Git working directory is clean and initialized."""
    code, stdout, stderr = run_command(["git", "status", "--porcelain"])
    if code != 0:
        return False, "Not a Git repository or Git is not installed."
    if stdout:
        return False, "Working directory is not clean. Commit or stash your changes."
    return True, "Git status is clean."

def check_gh_auth() -> Tuple[bool, str]:
    """Checks if the GitHub CLI is authenticated."""
    code, stdout, stderr = run_command(["gh", "auth", "status"])
    if code != 0:
        return False, "GitHub CLI (gh) is not authenticated. Run 'gh auth login'."
    return True, "GitHub CLI is authenticated."

def check_concurrency_lock() -> List[str]:
    """Checks for active (remote) agent branches to prevent collisions."""
    code, stdout, _ = run_command(["git", "ls-remote", "--heads", "origin", "refs/heads/fastci-agent/*"])
    if code != 0 or not stdout:
        return []
    
    branches = [line.split('/')[-1] for line in stdout.split('\n') if line.strip()]
    return branches

def discover_workspace() -> Tuple[List[str], bool]:
    """Identifies all tech stacks and checks if it's a Monorepo."""
    manifest_map = {
        "package.json": "nodejs",
        "pyproject.toml": "python",
        "requirements.txt": "python",
        "go.mod": "go",
        "pom.xml": "java",
        "cargo.toml": "rust",
        "Dockerfile": "docker"
    }
    
    detected_stacks = sorted(list({
        stack for file, stack in manifest_map.items() if Path(file).exists()
    }))

    monorepo_markers = ["pnpm-workspace.yaml", "lerna.json", "nx.json", "turbo.json"]
    common_folders = {"apps", "packages", "services"}
    
    is_monorepo = (
        any(Path(m).exists() for m in monorepo_markers) or 
        any(Path(d).is_dir() for d in common_folders)
    )

    return (detected_stacks if detected_stacks else ["unknown"], is_monorepo)

def execute_preflight() -> PreflightReport:
    """Orchestrates all Phase 0 checks and returns a standardized report."""
    try:
        git_ok, git_msg = check_git_status()
        if not git_ok:
            return PreflightReport(status="error", checks_passed=False, reason=git_msg)

        auth_ok, auth_msg = check_gh_auth()
        if not auth_ok:
            return PreflightReport(status="error", checks_passed=False, reason=auth_msg)

        active_branches = check_concurrency_lock()
        if active_branches:
            msg = f"Concurrency conflict: Found active agent branches: {', '.join(active_branches)}"
            return PreflightReport(
                status="error", 
                checks_passed=False, 
                reason=msg, 
                active_agent_branches=active_branches
            )

        stacks, is_monorepo = discover_workspace()

        return PreflightReport(
            status="ok",
            checks_passed=True,
            tech_stacks=stacks,
            is_monorepo=is_monorepo
        )

    except Exception as e:
        logger.error(f"Preflight execution failed: {e}")
        return PreflightReport(
            status="error",
            checks_passed=False,
            reason=f"Unexpected error during preflight: {str(e)}"
        )