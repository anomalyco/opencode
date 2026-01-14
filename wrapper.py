import subprocess
import os

log_file = "/tmp/amazon-mcp-wrapper.log"

with open(log_file, "w") as f:
    f.write("Starting wrapper script...\n")

try:
    # Get the absolute path to the server script
    script_path = os.path.abspath("mcps/amazon-mcp/server_v2.py")
    
    # Get the absolute path to the python executable
    python_path = "/home/regal-artifex/playground/amazon-mcp-server/.venv/bin/python"

    process = subprocess.Popen(
        [python_path, "-u", script_path],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    stdout, stderr = process.communicate()

    with open(log_file, "a") as f:
        f.write("--- STDOUT ---\n")
        f.write(stdout)
        f.write("\n--- STDERR ---\n")
        f.write(stderr)
        f.write("\n")

except Exception as e:
    with open(log_file, "a") as f:
        f.write(f"Error in wrapper script: {e}\n")
