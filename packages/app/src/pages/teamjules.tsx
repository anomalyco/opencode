import { createSignal, For, Show, onMount } from "solid-js"
import { useSDK } from "@/context/sdk"

export function TeamJulesPage() {
  const sdk = useSDK()
  const [tasks, setTasks] = createSignal<any[]>([])
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)

  const [showCreate, setShowCreate] = createSignal(false)
  const [repo, setRepo] = createSignal("")
  const [prompt, setPrompt] = createSignal("")
  const [branch, setBranch] = createSignal("main")

  const fetchTasks = async () => {
    setLoading(true)
    setError(null)
    try {
      const client = sdk().client
      const response = await client.v2.teamjules.list({})
      const data: any[] = Array.isArray(response) ? response : Array.isArray((response as any).data) ? (response as any).data : []
      setTasks(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch tasks")
    } finally {
      setLoading(false)
    }
  }

  onMount(fetchTasks)

  const createTask = async () => {
    if (!repo() || !prompt()) return
    try {
      const client = sdk().client
      await client.v2.teamjules.create({
        repo: repo(),
        prompt: prompt(),
        branch: branch(),
        type: "manual",
      })
      setShowCreate(false)
      setRepo("")
      setPrompt("")
      setBranch("main")
      await fetchTasks()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task")
    }
  }

  const cancelTask = async (id: string) => {
    try {
      const client = sdk().client
      await client.v2.teamjules.cancel({ taskID: id })
      await fetchTasks()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel task")
    }
  }

  const retryTask = async (id: string) => {
    try {
      const client = sdk().client
      await client.v2.teamjules.retry({ taskID: id })
      await fetchTasks()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to retry task")
    }
  }

  const statusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "text-green-500"
      case "failed":
        return "text-red-500"
      case "running":
        return "text-blue-500"
      case "pending":
        return "text-yellow-500"
      default:
        return "text-gray-500"
    }
  }

  return (
    <div class="p-4 max-w-4xl mx-auto">
      <div class="flex justify-between items-center mb-6">
        <h1 class="text-2xl font-bold">TeamJules Tasks</h1>
        <button
          class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          onClick={() => setShowCreate(true)}
        >
          New Task
        </button>
      </div>

      <Show when={error()}>
        <div class="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
          {error()}
        </div>
      </Show>

      <Show when={showCreate()}>
        <div class="mb-6 p-4 bg-gray-50 border rounded">
          <h2 class="text-lg font-semibold mb-3">Create New Task</h2>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium mb-1">Repository (owner/repo)</label>
              <input
                type="text"
                class="w-full p-2 border rounded"
                value={repo()}
                onInput={(e) => setRepo(e.currentTarget.value)}
                placeholder="e.g., owner/repo"
              />
            </div>
            <div>
              <label class="block text-sm font-medium mb-1">Branch</label>
              <input
                type="text"
                class="w-full p-2 border rounded"
                value={branch()}
                onInput={(e) => setBranch(e.currentTarget.value)}
              />
            </div>
            <div class="col-span-2">
              <label class="block text-sm font-medium mb-1">Prompt</label>
              <textarea
                class="w-full p-2 border rounded h-24"
                value={prompt()}
                onInput={(e) => setPrompt(e.currentTarget.value)}
                placeholder="Describe the coding task..."
              />
            </div>
          </div>
          <div class="flex gap-2 mt-4">
            <button
              class="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
              onClick={createTask}
            >
              Submit
            </button>
            <button
              class="px-4 py-2 bg-gray-300 text-gray-700 rounded hover:bg-gray-400"
              onClick={() => setShowCreate(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      </Show>

      <Show when={loading()}>
        <div class="text-center py-8 text-gray-500">Loading tasks...</div>
      </Show>

      <Show when={!loading() && tasks().length === 0}>
        <div class="text-center py-8 text-gray-500">No tasks yet. Create one to get started!</div>
      </Show>

      <Show when={tasks().length > 0}>
        <div class="space-y-3">
          <For each={tasks()}>
            {(task) => (
              <div class="p-4 border rounded hover:bg-gray-50">
                <div class="flex justify-between items-start">
                  <div>
                    <div class="font-mono text-sm text-gray-500">{task.id}</div>
                    <div class="font-medium mt-1">{task.prompt?.slice(0, 100)}</div>
                    <div class="text-sm text-gray-600 mt-1">
                      {task.repo} &bull; {task.branch}
                    </div>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class={`font-medium ${statusColor(task.status)}`}>{task.status}</span>
                    <Show when={task.status === "pending" || task.status === "running"}>
                      <button
                        class="text-sm text-red-600 hover:text-red-800"
                        onClick={() => cancelTask(task.id)}
                      >
                        Cancel
                      </button>
                    </Show>
                    <Show when={task.status === "failed"}>
                      <button
                        class="text-sm text-blue-600 hover:text-blue-800"
                        onClick={() => retryTask(task.id)}
                      >
                        Retry
                      </button>
                    </Show>
                  </div>
                </div>
                <Show when={task.result?.pr_url}>
                  <div class="mt-2">
                    <a
                      href={task.result.pr_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="text-sm text-blue-600 hover:underline"
                    >
                      View Pull Request &rarr;
                    </a>
                  </div>
                </Show>
                <Show when={task.result?.error}>
                  <div class="mt-2 text-xs text-red-600 bg-red-50 p-2 rounded">
                    Error: {task.result.error}
                  </div>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
