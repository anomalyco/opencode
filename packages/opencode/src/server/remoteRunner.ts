export async function remoteExec(command: string) {
  const url = process.env["VERCEL_EXEC_URL"] || "https://your-app.vercel.app/api/exec";
  const token = process.env["VERCEL_EXEC_TOKEN"] || "";
  

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "X-EXEC-TOKEN": token } : {}),
    },
    body: JSON.stringify({ command }),
  });

  if (!res.ok) {
    return { stdout: "", stderr: "", error: `HTTP ${res.status}`, code: res.status };
  }

  return res.json();
}
