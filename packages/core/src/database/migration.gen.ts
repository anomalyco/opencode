import type { DatabaseMigration } from "./migration.js"
import m00 from "./migration/20260127222353_familiar_lady_ursula.js"
import m01 from "./migration/20260211171708_add_project_commands.js"
import m02 from "./migration/20260213144116_wakeful_the_professor.js"
import m03 from "./migration/20260225215848_workspace.js"
import m04 from "./migration/20260227213759_add_session_workspace_id.js"
import m05 from "./migration/20260228203230_blue_harpoon.js"
import m06 from "./migration/20260303231226_add_workspace_fields.js"
import m07 from "./migration/20260309230000_move_org_to_state.js"
import m08 from "./migration/20260312043431_session_message_cursor.js"
import m09 from "./migration/20260323234822_events.js"
import m10 from "./migration/20260410174513_workspace-name.js"
import m11 from "./migration/20260413175956_chief_energizer.js"
import m12 from "./migration/20260423070820_add_icon_url_override.js"
import m13 from "./migration/20260427172553_slow_nightmare.js"
import m14 from "./migration/20260428004200_add_session_path.js"
import m15 from "./migration/20260501142318_next_venus.js"
import m16 from "./migration/20260504145000_add_sync_owner.js"
import m17 from "./migration/20260507164347_add_workspace_time.js"
import m18 from "./migration/20260510033149_session_usage.js"
import m19 from "./migration/20260511000411_data_migration_state.js"
import m20 from "./migration/20260511173437_session-metadata.js"
import m21 from "./migration/20260601010001_normalize_storage_paths.js"
import m22 from "./migration/20260601202201_amazing_prowler.js"
import m23 from "./migration/20260602002951_lowly_union_jack.js"
import m24 from "./migration/20260602182828_add_project_directories.js"
import m25 from "./migration/20260603001617_session_message_projection_indexes.js"
import m26 from "./migration/20260603040000_session_message_projection_order.js"
import m27 from "./migration/20260603141458_session_input_inbox.js"
import m28 from "./migration/20260603160727_jittery_ezekiel_stane.js"
import m29 from "./migration/20260604172448_event_sourced_session_input.js"
import m30 from "./migration/20260605003541_add_session_context_snapshot.js"
import m31 from "./migration/20260605042240_add_context_epoch_agent.js"
import m32 from "./migration/20260611035744_credential.js"
import m33 from "./migration/20260611192811_lush_chimera.js"
import m34 from "./migration/20260612174303_project_dir_strategy.js"
import m35 from "./migration/20260622142730_simplify_session_context_epoch.js"
import m36 from "./migration/20260622170816_reset_v2_session_state.js"
import m37 from "./migration/20260622202450_simplify_session_input.js"
import m38 from "./migration/20260804233008_loose_psylocke.js"
import m39 from "./migration/20260805200742_import_legacy_credentials.js"
import m40 from "./migration/20260808023530_workspace_domain.js"
import m41 from "./migration/20260811161259_execution_claim_attempts.js"
import m42 from "./migration/20260812181746_session_inbox.js"
import m43 from "./migration/20260812213948_worktree.js"
import m44 from "./migration/20260819222447_session_viewed_state.js"
import m45 from "./migration/20260823191254_nullable_workspace_binding.js"
import m46 from "./migration/20260910120000_clear_v1_session_permission.js"
import m47 from "./migration/20260923013825_project_time_active.js"
import m48 from "./migration/20261007190000_azure_cli_external_credential.js"
import m49 from "./migration/20261010180456_project_time_archived.js"
import m50 from "./migration/20261024002554_session_allowance.js"
import m51 from "./migration/20261024175301_drop_session_allowance.js"
import m52 from "./migration/20261025123711_blob.js"

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
    import("./migration/20260601202201_amazing_prowler"),
    import("./migration/20260602002951_lowly_union_jack"),
    import("./migration/20260602182828_add_project_directories"),
    import("./migration/20260603001617_session_message_projection_indexes"),
    import("./migration/20260603040000_session_message_projection_order"),
    import("./migration/20260603141458_session_input_inbox"),
    import("./migration/20260603160727_jittery_ezekiel_stane"),
    import("./migration/20260604172448_event_sourced_session_input"),
    import("./migration/20260605003541_add_session_context_snapshot"),
    import("./migration/20260605042240_add_context_epoch_agent"),
    import("./migration/20260611035744_credential"),
    import("./migration/20260611192811_lush_chimera"),
    import("./migration/20260612174303_project_dir_strategy"),
    import("./migration/20260622142730_simplify_session_context_epoch"),
    import("./migration/20260622170816_reset_v2_session_state"),
    import("./migration/20260622202450_simplify_session_input"),
    import("./migration/20260804162041_session_directory_time_updated_index"),
  ])
).map((module) => module.default) satisfies DatabaseMigration.Migration[]
