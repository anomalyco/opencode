import type { DatabaseMigration } from "./migration"
import m00 from "./migration/20260127222353_familiar_lady_ursula"
import m01 from "./migration/20260211171708_add_project_commands"
import m02 from "./migration/20260213144116_wakeful_the_professor"
import m03 from "./migration/20260225215848_workspace"
import m04 from "./migration/20260227213759_add_session_workspace_id"
import m05 from "./migration/20260228203230_blue_harpoon"
import m06 from "./migration/20260303231226_add_workspace_fields"
import m07 from "./migration/20260309230000_move_org_to_state"
import m08 from "./migration/20260312043431_session_message_cursor"
import m09 from "./migration/20260323234822_events"
import m10 from "./migration/20260410174513_workspace-name"
import m11 from "./migration/20260413175956_chief_energizer"
import m12 from "./migration/20260423070820_add_icon_url_override"
import m13 from "./migration/20260427172553_slow_nightmare"
import m14 from "./migration/20260428004200_add_session_path"
import m15 from "./migration/20260501142318_next_venus"
import m16 from "./migration/20260504145000_add_sync_owner"
import m17 from "./migration/20260507164347_add_workspace_time"
import m18 from "./migration/20260510033149_session_usage"
import m19 from "./migration/20260511000411_data_migration_state"
import m20 from "./migration/20260511173437_session-metadata"
import m21 from "./migration/20260601010001_normalize_storage_paths"
import m22 from "./migration/20260601202201_amazing_prowler"
import m23 from "./migration/20260602002951_lowly_union_jack"
import m24 from "./migration/20260602182828_add_project_directories"
import m25 from "./migration/20260603001617_session_message_projection_indexes"
import m26 from "./migration/20260603040000_session_message_projection_order"
import m27 from "./migration/20260603141458_session_input_inbox"
import m28 from "./migration/20260603160727_jittery_ezekiel_stane"
import m29 from "./migration/20260604172448_event_sourced_session_input"
import m30 from "./migration/20260605003541_add_session_context_snapshot"
import m31 from "./migration/20260605042240_add_context_epoch_agent"
import m32 from "./migration/20260611035744_credential"
import m33 from "./migration/20260611192811_lush_chimera"
import m34 from "./migration/20260612174303_project_dir_strategy"
import m35 from "./migration/20260622142730_simplify_session_context_epoch"
import m36 from "./migration/20260622170816_reset_v2_session_state"
import m37 from "./migration/20260622202450_simplify_session_input"
import m38 from "./migration/20260804233008_loose_psylocke"
import m39 from "./migration/20260805200742_import_legacy_credentials"
import m40 from "./migration/20260808023530_workspace_domain"
import m41 from "./migration/20260811161259_execution_claim_attempts"

export const migrations = [
  m00,
  m01,
  m02,
  m03,
  m04,
  m05,
  m06,
  m07,
  m08,
  m09,
  m10,
  m11,
  m12,
  m13,
  m14,
  m15,
  m16,
  m17,
  m18,
  m19,
  m20,
  m21,
  m22,
  m23,
  m24,
  m25,
  m26,
  m27,
  m28,
  m29,
  m30,
  m31,
  m32,
  m33,
  m34,
  m35,
  m36,
  m37,
  m38,
  m39,
  m40,
  m41,
] satisfies DatabaseMigration.Migration[]
