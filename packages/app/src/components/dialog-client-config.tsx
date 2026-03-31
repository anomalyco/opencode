import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { TextField } from "@opencode-ai/ui/text-field"
import { Select } from "@opencode-ai/ui/select"
import { RadioGroup } from "@opencode-ai/ui/radio-group"
import { createEffect, createMemo, createResource, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"

const ACTIVITE_OPTIONS = ["Service", "Négoce", "Mixte"] as const
type Activite = (typeof ACTIVITE_OPTIONS)[number]

const PRECISION_OPTIONS = [
  "Conseil",
  "Formation",
  "Commerce de gros",
  "Commerce de détail",
  "E-commerce",
  "Restauration",
  "BTP",
  "Immobilier",
  "Transport",
  "Autre",
] as const

const TVA_OPTIONS = ["20%", "10%", "5.5%", "Mixte", "Non applicable"] as const
type RegimeTVA = (typeof TVA_OPTIONS)[number]

const TVA_DECLARATIF_OPTIONS = ["Mensuel", "Trimestriel"] as const
type RegimeDeclaratif = (typeof TVA_DECLARATIF_OPTIONS)[number]

const SALARIES_OPTIONS = ["Oui", "Non"] as const
type Salaries = (typeof SALARIES_OPTIONS)[number]

const REVENUS_OPTIONS = ["Facturation ponctuelle", "Abonnement", "Mixte"] as const
type NatureRevenus = (typeof REVENUS_OPTIONS)[number]

export type ClientConfig = {
  activite: Activite | ""
  precisionActivite: string
  regimeTVA: RegimeTVA | ""
  regimeDeclaratifTVA: RegimeDeclaratif | ""
  presenceSalaries: Salaries | ""
  natureRevenus: NatureRevenus | ""
  reglesSpecifiques: string
}

const EMPTY_CONFIG: ClientConfig = {
  activite: "",
  precisionActivite: "",
  regimeTVA: "",
  regimeDeclaratifTVA: "",
  presenceSalaries: "",
  natureRevenus: "",
  reglesSpecifiques: "",
}

function configPath(directory: string) {
  return `${directory.replace(/\/+$/, "")}/client_config.json`
}

export function DialogClientConfig(props: { directory: string; onDone?: () => void }) {
  const dialog = useDialog()
  const sdk = useGlobalSDK()

  const [existing] = createResource(async () => {
    try {
      const res = await sdk.client.file.read({ path: configPath(props.directory) })
      if (res.data && res.data.type === "text" && res.data.content) {
        return JSON.parse(res.data.content) as ClientConfig
      }
    } catch {
      // file doesn't exist yet — that's fine
    }
    return null
  })

  const [store, setStore] = createStore<ClientConfig & { saving: boolean; error: string }>({
    ...EMPTY_CONFIG,
    saving: false,
    error: "",
  })

  // Populate store when existing config loads
  createEffect(() => {
    const data = existing()
    if (data) {
      setStore({
        activite: data.activite || "",
        precisionActivite: data.precisionActivite || "",
        regimeTVA: data.regimeTVA || "",
        regimeDeclaratifTVA: data.regimeDeclaratifTVA || "",
        presenceSalaries: data.presenceSalaries || "",
        natureRevenus: data.natureRevenus || "",
        reglesSpecifiques: data.reglesSpecifiques || "",
        saving: false,
        error: "",
      })
    }
  })

  const isValid = createMemo(() => {
    return store.activite !== "" && store.regimeTVA !== "" && store.presenceSalaries !== "" && store.natureRevenus !== ""
  })

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault()
    if (!isValid()) return

    setStore({ saving: true, error: "" })

    const config: ClientConfig = {
      activite: store.activite,
      precisionActivite: store.precisionActivite,
      regimeTVA: store.regimeTVA,
      regimeDeclaratifTVA: store.regimeDeclaratifTVA,
      presenceSalaries: store.presenceSalaries,
      natureRevenus: store.natureRevenus,
      reglesSpecifiques: store.reglesSpecifiques,
    }

    const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" })

    try {
      const url = new URL("/file/upload", sdk.url)
      url.searchParams.set("path", configPath(props.directory))
      const res = await fetch(url.toString(), { method: "POST", body: blob })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Échec de la sauvegarde"
      setStore({ saving: false, error: msg })
      return
    }

    setStore("saving", false)
    props.onDone?.()
    dialog.close()
  }

  return (
    <Dialog title="Paramétrage du client" class="w-full max-w-[560px] mx-auto">
      <form onSubmit={handleSubmit} class="flex flex-col gap-5 p-6 pt-0 max-h-[70vh] overflow-y-auto">
        {/* 1-A. Activite principale */}
        <div class="flex flex-col gap-2">
          <label class="text-12-medium text-text-weak">
            Activité principale <span class="text-text-danger">*</span>
          </label>
          <RadioGroup
            options={[...ACTIVITE_OPTIONS]}
            current={store.activite || undefined}
            onSelect={(v) => setStore("activite", (v ?? "") as Activite | "")}
          />
        </div>

        {/* 1-B. Precision activite (cosmetic) */}
        <div class="flex flex-col gap-2">
          <label class="text-12-medium text-text-weak">Précision activité</label>
          <Select
            options={[...PRECISION_OPTIONS]}
            current={store.precisionActivite || undefined}
            placeholder="Sélectionner..."
            onSelect={(v) => setStore("precisionActivite", v ?? "")}
            size="normal"
          />
        </div>

        {/* 2-A. Regime TVA */}
        <div class="flex flex-col gap-2">
          <label class="text-12-medium text-text-weak">
            Régime TVA <span class="text-text-danger">*</span>
          </label>
          <RadioGroup
            options={[...TVA_OPTIONS]}
            current={store.regimeTVA || undefined}
            onSelect={(v) => setStore("regimeTVA", (v ?? "") as RegimeTVA | "")}
            size="small"
          />
        </div>

        {/* 2-B. Regime declaratif TVA */}
        <div class="flex flex-col gap-2">
          <label class="text-12-medium text-text-weak">Régime déclaratif TVA</label>
          <RadioGroup
            options={[...TVA_DECLARATIF_OPTIONS]}
            current={store.regimeDeclaratifTVA || undefined}
            onSelect={(v) => setStore("regimeDeclaratifTVA", (v ?? "") as RegimeDeclaratif | "")}
          />
        </div>

        {/* 3. Presence de salaries */}
        <div class="flex flex-col gap-2">
          <label class="text-12-medium text-text-weak">
            Présence de salariés <span class="text-text-danger">*</span>
          </label>
          <RadioGroup
            options={[...SALARIES_OPTIONS]}
            current={store.presenceSalaries || undefined}
            onSelect={(v) => setStore("presenceSalaries", (v ?? "") as Salaries | "")}
          />
        </div>

        {/* 4. Nature des revenus */}
        <div class="flex flex-col gap-2">
          <label class="text-12-medium text-text-weak">
            Nature des revenus <span class="text-text-danger">*</span>
          </label>
          <RadioGroup
            options={[...REVENUS_OPTIONS]}
            current={store.natureRevenus || undefined}
            onSelect={(v) => setStore("natureRevenus", (v ?? "") as NatureRevenus | "")}
            size="small"
          />
        </div>

        {/* 5. Regles specifiques */}
        <TextField
          multiline
          label="Règles spécifiques du dossier"
          placeholder='ex: "Stripe = CA", "Metro = achats"'
          value={store.reglesSpecifiques}
          onChange={(v: string) => setStore("reglesSpecifiques", v)}
          spellcheck={false}
          class="max-h-20 w-full overflow-y-auto text-xs"
        />

        <Show when={store.error}>
          <p class="text-12-regular text-text-danger">{store.error}</p>
        </Show>

        <div class="flex justify-end gap-2 pt-2 sticky bottom-0 bg-background-base pb-1">
          <Button type="button" variant="ghost" size="large" onClick={() => dialog.close()}>
            Annuler
          </Button>
          <Button type="submit" variant="primary" size="large" disabled={!isValid() || store.saving}>
            {store.saving ? "Sauvegarde..." : "Enregistrer"}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
