import { Button } from "../../ui/button"
import { useApi } from "../components/context-api"
import { createSignal, createResource, For, Show } from "solid-js"
import style from "./keys.module.css"

export default function Keys() {
  const api = useApi()
  const [isCreating, setIsCreating] = createSignal(false)
  const [showCreateForm, setShowCreateForm] = createSignal(false)
  const [keyName, setKeyName] = createSignal("")

  const [keysData, { refetch }] = createResource(async () => {
    const response = await api.keys.$get()
    return response.json()
  })

  const handleCreateKey = async () => {
    if (!keyName().trim()) return

    try {
      setIsCreating(true)
      await api.keys.$post({
        json: { name: keyName().trim() },
      })
      refetch()
      setKeyName("")
      setShowCreateForm(false)
    } catch (error) {
      console.error("Failed to create API key:", error)
    } finally {
      setIsCreating(false)
    }
  }

  const handleDeleteKey = async (keyId: string) => {
    if (!confirm("Are you sure you want to delete this API key? This action cannot be undone.")) {
      return
    }

    try {
      await api.keys[":id"].$delete({
        param: { id: keyId },
      })
      refetch()
    } catch (error) {
      console.error("Failed to delete API key:", error)
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString()
  }

  const formatKey = (key: string) => {
    if (key.length <= 11) return key
    return `${key.slice(0, 7)}...${key.slice(-4)}`
  }

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch (error) {
      console.error("Failed to copy to clipboard:", error)
    }
  }

  return (
    <>
      <div data-component="title-bar">
        <div data-slot="left">
          <h1>API Keys</h1>
        </div>
      </div>
      <div class={style.root} data-max-width data-max-width-64>
        <div data-slot="keys-info">
          <div data-slot="actions">
            <div data-slot="header">
              <h2>API Keys</h2>
              <p>Manage your API keys to access the OpenCode gateway.</p>
            </div>
            <Show
              when={!showCreateForm()}
              fallback={
                <div data-slot="create-form">
                  <input
                    data-component="input"
                    type="text"
                    placeholder="Enter key name"
                    value={keyName()}
                    onInput={(e) => setKeyName(e.currentTarget.value)}
                    onKeyPress={(e) => e.key === "Enter" && handleCreateKey()}
                  />
                  <div data-slot="form-actions">
                    <Button color="primary" disabled={isCreating() || !keyName().trim()} onClick={handleCreateKey}>
                      {isCreating() ? "Creating..." : "Create"}
                    </Button>
                    <Button
                      color="ghost"
                      onClick={() => {
                        setShowCreateForm(false)
                        setKeyName("")
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              }
            >
              <Button color="primary" onClick={() => setShowCreateForm(true)}>
                Create API Key
              </Button>
            </Show>
          </div>

          <div data-slot="key-list">
            <For
              each={keysData()?.keys}
              fallback={
                <div data-slot="empty-state">
                  <p>Create an API key to access opencode gateway</p>
                </div>
              }
            >
              {(key) => (
                <div data-slot="key-item">
                  <div data-slot="key-info">
                    <div data-slot="key-name">{key.name}</div>
                    <div data-slot="key-value">{formatKey(key.key)}</div>
                    <div data-slot="key-meta">
                      Created: {formatDate(key.timeCreated)}
                      {key.timeUsed && ` • Last used: ${formatDate(key.timeUsed)}`}
                    </div>
                  </div>
                  <div data-slot="key-actions">
                    <Button color="ghost" onClick={() => copyToClipboard(key.key)} title="Copy API key">
                      Copy
                    </Button>
                    <Button color="ghost" onClick={() => handleDeleteKey(key.id)} title="Delete API key">
                      Delete
                    </Button>
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
    </>
  )
}
