import type { DatabaseMigration } from "./migration"

export const migrations = (
  await Promise.all([
    import("./migration/20260127222353_familiar_lady_ursula"),
    import("./migration/20260211171708_add_project_commands"),
    import("./migration/20260213144116_wakeful_the_professor"),
    import("./migration/20260225215848_workspace"),
    import("./migration/20260227213759_add_session_workspace_id"),
    import("./migration/20260228203230_blue_harpoon"),
    import("./migration/20260303231226_add_workspace_fields"),
    import("./migration/20260309230000_move_org_to_state"),
    import("./migration/20260312043431_session_message_cursor"),
    import("./migration/20260323234822_events"),
    import("./migration/20260410174513_workspace-name"),
    import("./migration/20260413175956_chief_energizer"),
    import("./migration/20260423070820_add_icon_url_override"),
    import("./migration/20260427172553_slow_nightmare"),
    import("./migration/20260428004200_add_session_path"),
    import("./migration/20260501142318_next_venus"),
    import("./migration/20260504145000_add_sync_owner"),
    import("./migration/20260507164347_add_workspace_time"),
    import("./migration/20260510033149_session_usage"),
    import("./migration/20260511000411_data_migration_state"),
    import("./migration/20260511173437_session-metadata"),
    import("./migration/20260601010001_normalize_storage_paths"),
  ])
).map((module) => module.default) satisfies DatabaseMigration.Migration[]
