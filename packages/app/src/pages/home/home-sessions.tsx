import type { HomeScrollController } from "./home-scroll-controller"
import type { HomeSessionSearchController } from "./home-session-search-controller"
import type { HomeSessionsController } from "./home-sessions-controller"
import { HomeSessionsView } from "./home-sessions-view"

export function HomeSessions(props: {
  sessions: HomeSessionsController
  search: HomeSessionSearchController
  scroll: HomeScrollController
}) {
  return (
    <HomeSessionsView
      language={props.sessions.language}
      groups={props.sessions.groups}
      loading={props.sessions.loading}
      showProjectName={props.sessions.showProjectName}
      server={props.sessions.server}
      canCreateSession={props.sessions.canCreateSession}
      searchValue={props.search.value}
      searchPlaceholder={props.search.placeholder}
      searchOpen={props.search.open}
      searchLoading={props.search.loading}
      searchResults={props.search.results}
      searchActive={props.search.active}
      searchNoResultsLabel={props.search.noResultsLabel}
      titleOpacity={props.scroll.titleOpacity}
      isOpenTab={props.sessions.hasOpenTab}
      onCreateSession={props.sessions.createSession}
      onOpenSession={props.sessions.openSession}
      onArchiveSession={props.sessions.archiveSession}
      onSetHoverTarget={props.scroll.setHoverTarget}
      onSetThumbTrack={props.scroll.setThumbTrack}
      onSetContent={props.scroll.setContent}
      onSetHeader={props.scroll.setHeader}
      onWheel={props.scroll.containWheel}
      onSetSearchRoot={props.search.setRoot}
      onSetSearchInput={props.search.setInput}
      onSetSearchList={props.search.setList}
      onSearchFocus={props.search.focus}
      onSearchInput={props.search.input}
      onSearchClose={props.search.close}
      onSearchMove={props.search.move}
      onSearchSelectActive={props.search.selectActive}
      onSearchHighlight={props.search.highlight}
      onSearchSelect={props.search.select}
    />
  )
}
