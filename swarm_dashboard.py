import os
import sys
import time
import sqlite3
import json
import requests
import subprocess
import re
from datetime import datetime, timedelta
from rich.console import Console
from rich.layout import Layout
from rich.table import Table
from rich.panel import Panel
from rich.live import Live
from rich.text import Text
from rich import box

# Configuration
from swarm.path_resolver import get_db_path

MODEL_DB = get_db_path("model_performance.db")
PROVIDER_DB = get_db_path("provider_status.db")
COST_DB = get_db_path("cost_comparisons.db")
SWARM_STATE_DB = get_db_path("swarm_state.db", preferred_dir="state")

DEPRECATED_PATHS = []
for db_name, pref in [("model_performance.db", "metrics"), ("provider_status.db", "metrics"), ("cost_comparisons.db", "metrics"), ("decomposition_outcomes.db", "metrics"), ("swarm_state.db", "state")]:
    path = get_db_path(db_name, preferred_dir=pref)
    if pref not in path:
        DEPRECATED_PATHS.append(db_name)

def get_current_repository():
    """Detect current git repository owner and name."""
    try:
        # Get repo root
        repo_root = subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], 
                                          stderr=subprocess.DEVNULL).decode().strip()
        # Get remote URL
        try:
            remote_url = subprocess.check_output(['git', 'remote', 'get-url', 'origin'], 
                                               cwd=repo_root, stderr=subprocess.DEVNULL).decode().strip()
        except:
            # Fallback: Check config for specific owner/repo if origin not set
            return "local", os.path.basename(repo_root)

        # Parse GitHub URL (handle both SSH and HTTPS)
        # Example: https://github.com/owner/repo.git or git@github.com:owner/repo.git
        match = re.search(r'github\.com[:/]([^/]+)/([^/.]+)', remote_url)
        if match:
            return match.group(1), match.group(2)
        
        return "origin", os.path.basename(repo_root)
    except:
        pass
    return None, None

# GitHub Config (Fallback to requests if gh CLI not available)
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN") 
# Try to load from opencode.jsonc if env var not set
if not GITHUB_TOKEN:
    try:
        with open(os.path.expanduser("~/.config/opencode/opencode.jsonc"), "r") as f:
            # Simple manual parsing to avoid strict jsonc issues if comments exist
            content = f.read()
            # Very naive extraction, assuming the structure is consistent
            import re
            match = re.search(r'"GITHUB_PERSONAL_ACCESS_TOKEN":\s*"([^"]+)"', content)
            if match:
                GITHUB_TOKEN = match.group(1)
    except Exception as e:
        pass

console = Console()

def get_db_connection(db_path):
    if not os.path.exists(db_path):
        return None
    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        return conn
    except Exception:
        return None

def fetch_model_history():
    """Fetch the last 15 task outcomes and return as a rich Panel."""
    table = Table(box=box.SIMPLE, expand=True)
    table.add_column("Time", style="cyan")
    table.add_column("Model", style="magenta")
    table.add_column("Task", style="blue")
    table.add_column("Status")
    table.add_column("Cost", justify="right")

    conn = get_db_connection(MODEL_DB)
    if conn:
        try:
            cur = conn.cursor()
            cur.execute("""
                SELECT timestamp, model, task_type, success, cost_usd 
                FROM task_outcomes 
                ORDER BY timestamp DESC 
                LIMIT 15
            """)
            rows = cur.fetchall()
            
            for row in rows:
                # Format timestamp to HH:MM:SS
                try:
                    ts = datetime.fromisoformat(row['timestamp']).strftime("%H:%M:%S")
                except (ValueError, TypeError):
                    # Fallback for non-ISO formats
                    ts = row['timestamp'].split('T')[-1][:8] if 'T' in row['timestamp'] else row['timestamp']
                
                # Shorten model name (remove provider prefix)
                model_display = row['model'].split('/')[-1]
                
                # Map success to color-coded status
                status = "[green]SUCCESS[/green]" if row['success'] else "[red]FAILED[/red]"
                
                # Format cost
                cost = f"${row['cost_usd']:.4f}" if row['cost_usd'] is not None else "$0.0000"
                
                table.add_row(ts, model_display, row['task_type'], status, cost)
                
        except Exception as e:
            table.add_row("Error", str(e), "", "", "")
        finally:
            conn.close()
    
    if not table.rows:
        table.add_row("No history available", "-", "-", "-", "-")

    return Panel(table, title="Recent Model Activity", border_style="cyan")

def fetch_system_health():
    """Panel 1: System Health"""
    active_workers = 0
    # Query swarm_state.db if it exists
    conn = get_db_connection(SWARM_STATE_DB)
    if conn:
        try:
            cur = conn.cursor()
            cur.execute("SELECT COUNT(*) FROM active_workers WHERE status='running'")
            active_workers = cur.fetchone()[0]
        except:
            pass
        conn.close()

    # Query provider_status.db for circuit breakers
    breakers_down = 0
    conn = get_db_connection(PROVIDER_DB)
    if conn:
        try:
            cur = conn.cursor()
            cur.execute("SELECT COUNT(*) FROM provider_status WHERE consecutive_failures >= 5")
            breakers_down = cur.fetchone()[0]
        except:
            pass
        conn.close()

    # Query model_performance.db for total tasks
    total_tasks = 0
    recent_errors = 0
    conn = get_db_connection(MODEL_DB)
    if conn:
        try:
            cur = conn.cursor()
            cur.execute("SELECT COUNT(*) FROM task_outcomes")
            total_tasks = cur.fetchone()[0]
            
            # Errors in last 24h
            yesterday = (datetime.now() - timedelta(days=1)).isoformat()
            cur.execute("SELECT COUNT(*) FROM task_outcomes WHERE success=0 AND timestamp > ?", (yesterday,))
            recent_errors = cur.fetchone()[0]
        except:
            pass
        conn.close()

    owner, repo = get_current_repository()
    repo_name = f"{owner}/{repo}" if repo else "Not in Git Repo"

    table = Table(show_header=False, box=None)
    table.add_row("Monitored Repo", f"[magenta]{repo_name}[/magenta]")
    if DEPRECATED_PATHS:
        table.add_row("Path Warning", f"[yellow]Deprecated paths in use: {', '.join(DEPRECATED_PATHS)}[/yellow]")
    table.add_row("Active Workers", str(active_workers))
    table.add_row("Circuit Breakers Down", f"[red]{breakers_down}[/red]" if breakers_down > 0 else "[green]0[/green]")
    table.add_row("Total Tasks", str(total_tasks))
    table.add_row("Recent Errors (24h)", f"[red]{recent_errors}[/red]" if recent_errors > 0 else "[green]0[/green]")
    
    return Panel(table, title="System Health", border_style="blue")

def fetch_model_performance():
    """Panel 2: Model Performance"""
    table = Table(title="Last 24h Performance", box=box.SIMPLE)
    table.add_column("Model")
    table.add_column("Success Rate")
    table.add_column("Avg Cost")
    table.add_column("Avg Latency")

    conn = get_db_connection(MODEL_DB)
    if conn:
        try:
            yesterday = (datetime.now() - timedelta(days=1)).isoformat()
            cur = conn.cursor()
            query = """
                SELECT model, 
                       AVG(success) * 100 as success_rate,
                       AVG(cost_usd) as avg_cost,
                       AVG(duration_ms) as avg_duration
                FROM task_outcomes
                WHERE timestamp > ?
                GROUP BY model
                ORDER BY success_rate DESC
            """
            cur.execute(query, (yesterday,))
            rows = cur.fetchall()
            
            for row in rows:
                success_rate = row['success_rate']
                color = "green" if success_rate >= 90 else "yellow" if success_rate >= 70 else "red"
                table.add_row(
                    row['model'].split('/')[-1], # Shorten model name
                    f"[{color}]{success_rate:.1f}%[/{color}]",
                    f"${row['avg_cost']:.4f}",
                    f"{row['avg_duration']:.0f}ms"
                )
        except Exception as e:
            table.add_row("Error", str(e))
        conn.close()
    else:
        table.add_row("No Data", "")

    return Panel(table, title="Model Performance", border_style="green")

def fetch_cost_tracking():
    """Panel 3: Cost Tracking"""
    table = Table(box=box.SIMPLE)
    table.add_column("Provider")
    table.add_column("Daily Spend")
    
    conn = get_db_connection(MODEL_DB) # Using model db for aggregate cost if provider db not populated fully
    if conn:
        try:
            today = datetime.now().strftime("%Y-%m-%d")
            cur = conn.cursor()
            # Simple regex-like extraction for provider
            query = """
                SELECT SUBSTR(model, 1, INSTR(model, '/') - 1) as provider,
                       SUM(cost_usd) as total_cost
                FROM task_outcomes
                WHERE timestamp LIKE ?
                GROUP BY provider
            """
            cur.execute(query, (f"{today}%",))
            rows = cur.fetchall()
            
            total_daily = 0
            for row in rows:
                cost = row['total_cost'] or 0
                total_daily += cost
                table.add_row(row['provider'], f"${cost:.4f}")
            
            table.add_section()
            table.add_row("[bold]TOTAL[/bold]", f"[bold]${total_daily:.4f}[/bold]")
            
            # Budget alert
            if total_daily > 10.0:
                 return Panel(table, title="Cost Tracking (BUDGET EXCEEDED)", border_style="red")
        except:
            pass
        conn.close()

    return Panel(table, title="Cost Tracking (Today)", border_style="yellow")

def fetch_github_activity():
    """Panel 4: GitHub Activity"""
    table = Table(show_header=False, box=None)
    
    owner, repo = get_current_repository()
    if not owner or not repo:
        return Panel("Not in a GitHub repository", title="GitHub Activity", border_style="white")
    
    repo_full = f"{owner}/{repo}"
    
    if not GITHUB_TOKEN:
        return Panel("GitHub Token not found", title=f"GitHub: {repo_full}", border_style="white")

    try:
        headers = {"Authorization": f"token {GITHUB_TOKEN}", "Accept": "application/vnd.github.v3+json"}
        # Fetch user's recent events or specific repo events
        url = f"https://api.github.com/repos/{repo_full}/events?per_page=5"
        
        resp = requests.get(url, headers=headers, timeout=2)
        if resp.status_code == 200:
            events = resp.json()
            if not events:
                table.add_row("", "No recent events", "")
            for event in events:
                etype = event['type']
                actor = event['actor']['login']
                created_at = event['created_at'].split('T')[1][:5]
                
                if etype == "PushEvent":
                    msg = f"Push to {event['payload']['ref'].split('/')[-1]}"
                    table.add_row(created_at, f"[blue]{actor}[/blue]", msg)
                elif etype == "PullRequestEvent":
                    action = event['payload']['action']
                    pr_num = event['payload']['number']
                    table.add_row(created_at, f"[green]{actor}[/green]", f"PR #{pr_num} {action}")
                elif etype == "IssuesEvent":
                    action = event['payload']['action']
                    issue_num = event['payload']['issue']['number']
                    table.add_row(created_at, f"[yellow]{actor}[/yellow]", f"Issue #{issue_num} {action}")
                else:
                    table.add_row(created_at, f"[white]{actor}[/white]", etype.replace("Event", ""))
        elif resp.status_code == 404:
            table.add_row("Status", "Repo Not Found (or Private)")
        elif resp.status_code == 401:
            table.add_row("Status", "Unauthorized (Invalid Token)")
        else:
            table.add_row("Status", f"API {resp.status_code}")

    except Exception as e:
        table.add_row("Error", "Connection Failed")

    return Panel(table, title=f"GitHub: {repo_full}", border_style="magenta")


def make_layout():
    layout = Layout()
    layout.split_column(
        Layout(name="top"),
        Layout(name="bottom")
    )
    layout["top"].split_row(
        Layout(name="health"),
        Layout(name="performance")
    )
    layout["bottom"].split_row(
        Layout(name="cost"),
        Layout(name="history"),
        Layout(name="github")
    )
    return layout

def update_layout(layout):
    layout["health"].update(fetch_system_health())
    layout["performance"].update(fetch_model_performance())
    layout["cost"].update(fetch_cost_tracking())
    layout["history"].update(fetch_model_history())
    layout["github"].update(fetch_github_activity())

def run_dashboard():
    layout = make_layout()
    with Live(layout, refresh_per_second=1, screen=True) as live:
        while True:
            update_layout(layout)
            time.sleep(5)

if __name__ == "__main__":
    try:
        run_dashboard()
    except KeyboardInterrupt:
        console.print("[bold red]Dashboard stopped[/bold red]")
