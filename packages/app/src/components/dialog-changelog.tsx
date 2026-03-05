import { createResource, Suspense, ErrorBoundary, Show } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { DataProvider } from "@opencode-ai/ui/context"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { fetchReleases } from "@/api/releases"
import { ReleaseList } from "@/components/release-list"

export function DialogChangelog() {
  const language = useLanguage()
  const platform = usePlatform()
  const [data] = createResource(() => fetchReleases(platform))

  return (
    <Dialog size="x-large" transition title="Changelog">
      <DataProvider data={{ session: [], session_status: {}, session_diff: {}, message: {}, part: {} }} directory="">
        <div class="flex-1 min-h-0 flex flex-col">
          <ErrorBoundary
            fallback={(e) => (
              <p class="text-text-weak p-6">
                {e instanceof Error ? e.message : "Failed to load changelog"}
              </p>
            )}
          >
            <Suspense fallback={<p class="text-text-weak p-6">{language.t("common.loading")}...</p>}>
              <Show
                when={(data()?.releases.length ?? 0) > 0}
                fallback={<p class="text-text-weak p-6">{language.t("common.noReleasesFound")}</p>}
              >
                <ReleaseList
                  releases={data()!.releases}
                  hasMore={false}
                  loadingMore={false}
                  onLoadMore={() => {}}
                />
              </Show>
            </Suspense>
          </ErrorBoundary>
        </div>
      </DataProvider>
    </Dialog>
  )
}
