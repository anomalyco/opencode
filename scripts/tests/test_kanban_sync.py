import importlib.util
import io
import pathlib
import unittest
from contextlib import redirect_stdout, redirect_stderr
from datetime import datetime, timezone
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location(
    "kanban_sync",
    pathlib.Path(__file__).parents[1] / "kanban-sync.py",
)
kanban_sync = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(kanban_sync)


def roadmap_body(newline="\n"):
    return newline.join([
        "## Contexto",
        "contexto",
        "## Hallazgo y evidencia",
        "evidencia",
        "## Decisión acordada",
        "decisión",
        "## Plan aprobado",
        "plan",
        "## Criterios de aceptación",
        "criterios",
        "## Plan de verificación",
        "verificación",
        "## Riesgos y recuperación",
        "riesgos",
    ])


def item(item_type="DraftIssue", body=None):
    result = {
        "type": item_type,
        "status": "Roadmap",
        "id": "content-id",
        "title": "Preserve body",
        "body": roadmap_body() if body is None else body,
        "tipo": "Bug",
        "area": "Infra",
        "labels": [],
        "project_created_at": "2026-08-07T12:12:08Z",
        "started": "2026-08-07",
        "started_exact": "2026-08-07T12:12:08Z",
        "completed": None,
        "completed_exact": None,
        "status_updated_at": "2026-08-07T12:00:00Z",
    }
    if item_type == "Issue":
        result["number"] = 75
    return result


class RoadmapToExecutingTests(unittest.TestCase):
    def test_converts_draft_without_replacing_body(self):
        draft = item()
        issue = item("Issue")
        current = item("Issue")
        current.update(status="Ejecutando", started="2026-08-07", started_exact="2026-08-07T12:12:08Z")
        with (
            patch.object(kanban_sync, "get_item_content", side_effect=[draft, current]),
            patch.object(kanban_sync, "convert_to_issue", return_value={"data": {}}) as convert,
            patch.object(kanban_sync, "wait_for_issue", return_value=issue),
            patch.object(kanban_sync, "update_issue") as update,
            patch.object(kanban_sync, "add_labels", return_value={"data": {}}) as add_labels,
            patch.object(kanban_sync, "set_field", return_value={"data": {}}) as set_field,
            patch.object(
                kanban_sync,
                "ensure_temporal_pair",
                return_value=("2026-08-07", "2026-08-07T12:12:08Z"),
            ),
        ):
            result = kanban_sync.cmd_move("item-id", "Roadmap", "Ejecutando")

        self.assertEqual(result, 0)
        convert.assert_called_once_with("item-id")
        update.assert_not_called()
        add_labels.assert_called_once_with("content-id", ["bug", "infra"])
        set_field.assert_called_once_with(
            "item-id",
            kanban_sync.FIELDS["Status"],
            kanban_sync.STATUS["Ejecutando"],
        )

    def test_normalizes_line_endings_without_changing_content(self):
        draft = item(body=roadmap_body("\r\n"))
        issue = item("Issue", roadmap_body("\n"))
        current = item("Issue", roadmap_body("\n"))
        current.update(status="Ejecutando", started="2026-08-07", started_exact="2026-08-07T12:12:08Z")
        with (
            patch.object(kanban_sync, "get_item_content", side_effect=[draft, current]),
            patch.object(kanban_sync, "convert_to_issue", return_value={"data": {}}),
            patch.object(kanban_sync, "wait_for_issue", return_value=issue),
            patch.object(kanban_sync, "add_labels", return_value={"data": {}}),
            patch.object(kanban_sync, "set_field", return_value={"data": {}}),
            patch.object(
                kanban_sync,
                "ensure_temporal_pair",
                return_value=("2026-08-07", "2026-08-07T12:12:08Z"),
            ),
        ):
            result = kanban_sync.cmd_move("item-id", "Roadmap", "Ejecutando")

        self.assertEqual(result, 0)

    def test_rejects_incomplete_roadmap_body_before_conversion(self):
        with (
            patch.object(kanban_sync, "get_item_content", return_value=item(body="## Contexto\nOnly")),
            patch.object(kanban_sync, "convert_to_issue") as convert,
            patch.object(kanban_sync, "set_field") as set_field,
        ):
            result = kanban_sync.cmd_move("item-id", "Roadmap", "Ejecutando")

        self.assertEqual(result, 1)
        convert.assert_not_called()
        set_field.assert_not_called()

    def test_rejects_missing_classification_before_conversion(self):
        unclassified = item()
        unclassified["tipo"] = None
        with (
            patch.object(kanban_sync, "get_item_content", return_value=unclassified),
            patch.object(kanban_sync, "convert_to_issue") as convert,
            patch.object(kanban_sync, "set_field") as set_field,
        ):
            result = kanban_sync.cmd_move("item-id", "Roadmap", "Ejecutando")

        self.assertEqual(result, 1)
        convert.assert_not_called()
        set_field.assert_not_called()

    def test_conversion_failure_keeps_status_in_roadmap(self):
        with (
            patch.object(kanban_sync, "get_item_content", return_value=item()),
            patch.object(kanban_sync, "convert_to_issue", return_value=None),
            patch.object(kanban_sync, "set_field") as set_field,
        ):
            result = kanban_sync.cmd_move("item-id", "Roadmap", "Ejecutando")

        self.assertEqual(result, 1)
        set_field.assert_not_called()

    def test_detects_body_loss_and_keeps_status_in_roadmap(self):
        changed = item("Issue", roadmap_body() + "\nchanged")
        restored = item("Issue")
        with (
            patch.object(kanban_sync, "get_item_content", side_effect=[item(), restored]),
            patch.object(kanban_sync, "convert_to_issue", return_value={"data": {}}),
            patch.object(kanban_sync, "wait_for_issue", return_value=changed),
            patch.object(kanban_sync, "update_issue", return_value={"data": {}}) as update_issue,
            patch.object(kanban_sync, "add_labels") as add_labels,
            patch.object(kanban_sync, "set_field") as set_field,
        ):
            result = kanban_sync.cmd_move("item-id", "Roadmap", "Ejecutando")

        self.assertEqual(result, 1)
        update_issue.assert_called_once_with(
            "content-id",
            title="Preserve body",
            body=roadmap_body(),
        )
        add_labels.assert_not_called()
        set_field.assert_not_called()

    def test_failure_after_conversion_does_not_change_status(self):
        draft = item()
        issue = item("Issue")
        with (
            patch.object(kanban_sync, "get_item_content", return_value=draft),
            patch.object(kanban_sync, "convert_to_issue", return_value={"data": {}}),
            patch.object(kanban_sync, "wait_for_issue", return_value=issue),
            patch.object(kanban_sync, "add_labels", side_effect=kanban_sync.KanbanError("label failure")),
            patch.object(kanban_sync, "set_field") as set_field,
        ):
            with self.assertRaises(kanban_sync.KanbanError):
                kanban_sync.cmd_move("item-id", "Roadmap", "Ejecutando")

        set_field.assert_not_called()

    def test_resumes_converted_issue_without_converting_again(self):
        issue = item("Issue")
        current = item("Issue")
        current.update(status="Ejecutando", started="2026-08-07", started_exact="2026-08-07T12:12:08Z")
        with (
            patch.object(kanban_sync, "get_item_content", side_effect=[issue, current]),
            patch.object(kanban_sync, "convert_to_issue") as convert,
            patch.object(kanban_sync, "add_labels", return_value={"data": {}}),
            patch.object(kanban_sync, "set_field", return_value={"data": {}}) as set_field,
            patch.object(
                kanban_sync,
                "ensure_temporal_pair",
                return_value=("2026-08-07", "2026-08-07T12:12:08Z"),
            ),
        ):
            result = kanban_sync.cmd_move("item-id", "Roadmap", "Ejecutando")

        self.assertEqual(result, 0)
        convert.assert_not_called()
        set_field.assert_called_once()

    def test_repairs_partial_executing_transition_idempotently(self):
        partial = item("Issue")
        partial.update(
            status="Ejecutando",
            project_created_at="2026-08-07T12:20:00Z",
            started=None,
            started_exact=None,
            status_updated_at="2026-08-07T12:20:00Z",
        )
        recovered = item("Issue")
        recovered.update(
            status="Ejecutando",
            project_created_at="2026-08-07T12:20:00Z",
            labels=["bug", "infra"],
            started="2026-08-07",
            started_exact="2026-08-07T12:20:00Z",
        )
        with (
            patch.object(kanban_sync, "get_item_content", side_effect=[partial, recovered]),
            patch.object(kanban_sync, "add_labels") as add_labels,
            patch.object(kanban_sync, "set_text_field"),
            patch.object(kanban_sync, "set_date_field"),
        ):
            result = kanban_sync.cmd_move("item-id", "Roadmap", "Ejecutando")

        self.assertEqual(result, 0)
        add_labels.assert_called_once_with("content-id", ["bug", "infra"])


class TemporalFieldTests(unittest.TestCase):
    def test_derives_madrid_date_from_utc_instant(self):
        date, exact = kanban_sync.temporal_values(datetime(2026, 1, 31, 23, 30, tzinfo=timezone.utc))

        self.assertEqual(date, "2026-02-01")
        self.assertEqual(exact, "2026-01-31T23:30:00Z")

    def test_handles_madrid_daylight_saving_boundary(self):
        date, exact = kanban_sync.temporal_values(datetime(2026, 3, 29, 22, 30, tzinfo=timezone.utc))

        self.assertEqual(date, "2026-03-30")
        self.assertEqual(exact, "2026-03-29T22:30:00Z")

    def test_rejects_noncanonical_exact_timestamp(self):
        self.assertIsNone(kanban_sync.parse_exact("2026-08-07T12:12:08.123Z"))
        self.assertIsNone(kanban_sync.parse_exact("2026-08-07T14:12:08+02:00"))

    def test_reuses_exact_timestamp_and_repairs_date(self):
        temporal = {"started": None, "started_exact": "2026-01-31T23:30:00Z"}
        with (
            patch.object(kanban_sync, "set_date_field") as set_date,
            patch.object(kanban_sync, "set_text_field") as set_text,
        ):
            result = kanban_sync.ensure_temporal_pair(
                "item-id", temporal, "started", "started_exact", "Started", "StartedExact"
            )

        self.assertEqual(result, ("2026-02-01", "2026-01-31T23:30:00Z"))
        set_date.assert_called_once_with("item-id", kanban_sync.FIELDS["Started"], "2026-02-01")
        set_text.assert_not_called()

    def test_refuses_to_invent_timestamp_for_date_only(self):
        temporal = {"completed": "2026-08-07", "completed_exact": None}
        with (
            patch.object(kanban_sync, "set_date_field") as set_date,
            patch.object(kanban_sync, "set_text_field") as set_text,
        ):
            with self.assertRaises(kanban_sync.KanbanError):
                kanban_sync.ensure_temporal_pair(
                    "item-id", temporal, "completed", "completed_exact", "Completed", "CompletedExact"
                )

        set_date.assert_not_called()
        set_text.assert_not_called()

    def test_uses_project_item_creation_as_start(self):
        temporal = {
            "project_created_at": "2026-01-31T23:30:00Z",
            "started": None,
            "started_exact": None,
        }
        with (
            patch.object(kanban_sync, "set_date_field") as set_date,
            patch.object(kanban_sync, "set_text_field") as set_text,
        ):
            result = kanban_sync.ensure_item_started("item-id", temporal)

        self.assertEqual(result, ("2026-02-01", "2026-01-31T23:30:00Z"))
        set_text.assert_called_once_with(
            "item-id", kanban_sync.FIELDS["StartedExact"], "2026-01-31T23:30:00Z"
        )
        set_date.assert_called_once_with("item-id", kanban_sync.FIELDS["Started"], "2026-02-01")


class TemporalTransitionTests(unittest.TestCase):
    def test_completes_issue_with_one_timestamp_and_verifies_postconditions(self):
        verifying = item("Issue")
        verifying.update(
            status="Verificando",
            state="OPEN",
            started="2026-08-07",
            started_exact="2026-08-07T12:12:08Z",
            status_updated_at="2026-08-07T12:30:00Z",
        )
        completed = item("Issue")
        completed.update(
            status="Changelog",
            state="CLOSED",
            started="2026-08-07",
            started_exact="2026-08-07T12:12:08Z",
            completed="2026-08-07",
            completed_exact="2026-08-07T13:00:00Z",
        )
        with (
            patch.object(kanban_sync, "get_item_content", side_effect=[verifying, completed]),
            patch.object(
                kanban_sync,
                "ensure_temporal_pair",
                return_value=("2026-08-07", "2026-08-07T13:00:00Z"),
            ),
            patch.object(kanban_sync, "set_field") as set_field,
            patch.object(kanban_sync, "update_issue") as update_issue,
            patch.object(kanban_sync, "close_issue") as close_issue,
            patch.object(kanban_sync, "cmd_changelog") as changelog,
            patch.object(kanban_sync.time, "sleep"),
        ):
            result = kanban_sync.cmd_move("item-id", "Verificando", "Changelog")

        self.assertEqual(result, 0)
        set_field.assert_called_once_with(
            "item-id", kanban_sync.FIELDS["Status"], kanban_sync.STATUS["Changelog"]
        )
        update_issue.assert_called_once_with("content-id", title="✅ Preserve body")
        close_issue.assert_called_once_with("content-id")
        changelog.assert_called_once_with()

    def test_changelog_retry_reuses_existing_timestamp(self):
        pending_close = item("Issue")
        pending_close.update(
            status="Changelog",
            state="OPEN",
            started="2026-08-07",
            started_exact="2026-08-07T12:12:08Z",
            completed="2026-08-07",
            completed_exact="2026-08-07T13:00:00Z",
            status_updated_at="2026-08-07T13:00:00Z",
        )
        closed = pending_close | {"state": "CLOSED", "title": "✅ Preserve body"}
        with (
            patch.object(kanban_sync, "get_item_content", side_effect=[pending_close, closed]),
            patch.object(
                kanban_sync,
                "ensure_temporal_pair",
                return_value=("2026-08-07", "2026-08-07T13:00:00Z"),
            ),
            patch.object(kanban_sync, "set_field") as set_field,
            patch.object(kanban_sync, "update_issue"),
            patch.object(kanban_sync, "close_issue") as close_issue,
            patch.object(kanban_sync, "cmd_changelog"),
        ):
            result = kanban_sync.cmd_move("item-id", "Verificando", "Changelog")

        self.assertEqual(result, 0)
        set_field.assert_not_called()
        close_issue.assert_called_once_with("content-id")

    def test_reopening_archives_completion_before_clearing_fields(self):
        closed = item("Issue", "description")
        closed.update(
            status="Changelog",
            state="CLOSED",
            title="✅ Preserve body",
            completed="2026-08-07",
            completed_exact="2026-08-07T13:00:00Z",
        )
        archived = closed | {
            "body": "description\n\n## Historial temporal\n- Ciclo completado: `2026-08-07T13:00:00Z`"
        }
        with (
            patch.object(kanban_sync, "get_item_content", side_effect=[closed, archived]),
            patch.object(kanban_sync, "update_issue") as update_issue,
            patch.object(kanban_sync, "reopen_issue") as reopen_issue,
            patch.object(kanban_sync, "clear_field") as clear_field,
            patch.object(kanban_sync, "set_field") as set_field,
        ):
            result = kanban_sync.cmd_move("item-id", "Changelog", "Ejecutando")

        self.assertEqual(result, 0)
        self.assertIn("## Historial temporal", update_issue.call_args_list[0].kwargs["body"])
        reopen_issue.assert_called_once_with("content-id")
        self.assertEqual(clear_field.call_count, 2)
        set_field.assert_called_once_with(
            "item-id", kanban_sync.FIELDS["Status"], kanban_sync.STATUS["Ejecutando"]
        )


def project_item(
    status,
    tipo=None,
    area=None,
    issue=False,
    labels=(),
    temporal=None,
    closed_at=None,
    created_at="2026-01-31T22:00:00Z",
    version="v0.1.4",
    body=None,
):
    fields = [
        {"field": {"name": "Status"}, "name": status},
        {"field": {"name": "Versión"}, "name": version},
        {"field": {"name": "Prioridad"}, "name": "Alta"},
    ]
    if tipo:
        fields.append({"field": {"name": "Tipo"}, "name": tipo})
    if area:
        fields.append({"field": {"name": "Área principal"}, "name": area})
    for name, value in (temporal or {}).items():
        fields.append({"field": {"name": name}, "date" if name in ("Inicio", "Completado") else "text": value})
    content = {"title": "Audit item"}
    if body:
        content["body"] = body
    if issue:
        content.update({
            "number": 10,
            "state": "CLOSED" if closed_at else "OPEN",
            "labels": {"nodes": [{"name": label} for label in labels]},
            "closedAt": closed_at,
        })
    return {"createdAt": created_at, "content": content, "fieldValues": {"nodes": fields}}


def clean_changelog_item(version="v0.1.3", body=None, closed_at="2026-01-31T23:30:00Z"):
    return project_item(
        "Changelog",
        tipo="Bug",
        area="Infra",
        issue=True,
        labels=("bug", "infra"),
        closed_at=closed_at,
        temporal={
            "Inicio": "2026-01-31",
            "Inicio exacto": "2026-01-31T22:00:00Z",
            "Completado": "2026-02-01",
            "Completado exacto": "2026-01-31T23:30:00Z",
        },
        version=version,
        body=body,
    )


class AuditTests(unittest.TestCase):
    def test_requires_start_for_detectado_and_verificando(self):
        items = [
            project_item("Detectado", tipo="Bug", area="Infra"),
            project_item("Verificando", tipo="Bug", area="Infra", issue=True, labels=("bug", "infra")),
        ]
        output = io.StringIO()
        with (
            patch.object(kanban_sync, "get_all_items", return_value=items),
            patch.object(kanban_sync, "latest_release_tag", return_value="v0.1.3"),
            redirect_stdout(output),
        ):
            result = kanban_sync.cmd_audit()

        self.assertEqual(result, 2)
        self.assertEqual(output.getvalue().count("INICIO_FALTA"), 2)
        self.assertEqual(output.getvalue().count("INICIO_EXACTO_FALTA"), 2)

    def test_reports_missing_classification_and_incorrect_issue_labels(self):
        items = [
            project_item("Detectado"),
            project_item(
                "Verificando",
                tipo="Bug",
                area="Infra",
                issue=True,
                labels=("feature", "infra", "documentation"),
            ),
        ]
        output = io.StringIO()
        with (
            patch.object(kanban_sync, "get_all_items", return_value=items),
            patch.object(kanban_sync, "latest_release_tag", return_value="v0.1.3"),
            redirect_stdout(output),
        ):
            result = kanban_sync.cmd_audit()

        self.assertEqual(result, 2)
        self.assertIn("Tipo, Área principal", output.getvalue())
        self.assertIn("LABEL_FALTA:bug", output.getvalue())
        self.assertIn("ALIAS:documentation->docs", output.getvalue())
        self.assertIn("TIPO_LABEL_EXTRA:feature", output.getvalue())

    def test_get_all_items_follows_pagination(self):
        first = {
            "data": {"node": {"items": {
                "nodes": [{"id": "one"}],
                "pageInfo": {"hasNextPage": True, "endCursor": "cursor-1"},
            }}},
        }
        second = {
            "data": {"node": {"items": {
                "nodes": [{"id": "two"}],
                "pageInfo": {"hasNextPage": False, "endCursor": "cursor-2"},
            }}},
        }
        with patch.object(kanban_sync, "gql", side_effect=[first, second]) as gql:
            result = kanban_sync.get_all_items()

        self.assertEqual(result, [{"id": "one"}, {"id": "two"}])
        self.assertEqual(gql.call_count, 2)
        self.assertIn('after:"cursor-1"', gql.call_args_list[1].args[0])

    def test_reports_missing_and_incoherent_changelog_timestamps(self):
        items = [
            project_item("Changelog", issue=True),
            project_item(
                "Changelog",
                issue=True,
                temporal={
                    "Completado": "2026-08-07",
                    "Completado exacto": "2026-08-06T21:30:00Z",
                },
            ),
        ]
        output = io.StringIO()
        with (
            patch.object(kanban_sync, "get_all_items", return_value=items),
            patch.object(kanban_sync, "latest_release_tag", return_value="v0.1.3"),
            redirect_stdout(output),
        ):
            result = kanban_sync.cmd_audit()

        self.assertEqual(result, 2)
        self.assertIn("COMPLETADO_FALTA", output.getvalue())
        self.assertIn("COMPLETADO_EXACTO_FALTA", output.getvalue())
        self.assertIn("COMPLETADO_FECHA_INCOHERENTE", output.getvalue())


class VersionAuditTests(unittest.TestCase):
    def test_flags_unassigned_version_in_all_states(self):
        items = [
            project_item("Detectado", version="Sin asignar"),
            project_item("Changelog", issue=True, version="Sin asignar"),
        ]
        output = io.StringIO()
        with (
            patch.object(kanban_sync, "get_all_items", return_value=items),
            patch.object(kanban_sync, "latest_release_tag", return_value="v0.1.4"),
            redirect_stdout(output),
        ):
            result = kanban_sync.cmd_audit()

        self.assertEqual(result, 2)
        self.assertEqual(output.getvalue().count("VERSION_SIN_ASIGNAR"), 2)

    def test_flags_active_item_off_objective(self):
        items = [project_item("Detectado", version="v0.1.4")]
        output = io.StringIO()
        with (
            patch.object(kanban_sync, "get_all_items", return_value=items),
            patch.object(kanban_sync, "latest_release_tag", return_value="v0.1.4"),
            redirect_stdout(output),
        ):
            result = kanban_sync.cmd_audit()

        self.assertEqual(result, 1)
        self.assertIn("VERSION_ACTIVA_NO_OBJETIVO:espera_v0.1.5_tiene_v0.1.4", output.getvalue())

    def test_active_item_on_objective_passes(self):
        items = [project_item(
            "Detectado",
            version="v0.1.5",
            tipo="Bug",
            area="Infra",
            temporal={"Inicio": "2026-01-31", "Inicio exacto": "2026-01-31T22:00:00Z"},
        )]
        output = io.StringIO()
        with (
            patch.object(kanban_sync, "get_all_items", return_value=items),
            patch.object(kanban_sync, "latest_release_tag", return_value="v0.1.4"),
            redirect_stdout(output),
        ):
            result = kanban_sync.cmd_audit()

        self.assertEqual(result, 0)
        self.assertIn("OK All items OK!", output.getvalue())

    def test_flags_unknown_version(self):
        items = [project_item("Changelog", issue=True, version="v9.9.9")]
        output = io.StringIO()
        with (
            patch.object(kanban_sync, "get_all_items", return_value=items),
            patch.object(kanban_sync, "latest_release_tag", return_value="v0.1.4"),
            redirect_stdout(output),
        ):
            result = kanban_sync.cmd_audit()

        self.assertEqual(result, 1)
        self.assertIn("VERSION_DESCONOCIDA:v9.9.9", output.getvalue())

    def test_verifies_historical_commit_belongs_to_declared_tag(self):
        items = [clean_changelog_item(
            version="v0.1.4",
            body="Implemented in aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        )]
        output = io.StringIO()
        with (
            patch.object(kanban_sync, "get_all_items", return_value=items),
            patch.object(kanban_sync, "latest_release_tag", return_value="v0.1.4"),
            patch.object(kanban_sync, "tag_containing_commit", return_value=["v0.1.4"]),
            redirect_stdout(output),
        ):
            result = kanban_sync.cmd_audit()

        self.assertEqual(result, 0)
        self.assertIn("OK All items OK!", output.getvalue())

    def test_flags_historical_commit_not_in_declared_tag(self):
        items = [clean_changelog_item(
            version="v0.1.3",
            body="Implemented in aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        )]
        output = io.StringIO()
        with (
            patch.object(kanban_sync, "get_all_items", return_value=items),
            patch.object(kanban_sync, "latest_release_tag", return_value="v0.1.4"),
            patch.object(kanban_sync, "tag_containing_commit", return_value=["v0.1.4"]),
            redirect_stdout(output),
        ):
            result = kanban_sync.cmd_audit()

        self.assertEqual(result, 1)
        self.assertIn("VERSION_HISTORICA_INCOHERENTE:v0.1.3_commit_no_verificado", output.getvalue())

    def test_historical_item_without_commit_citation_is_not_checked(self):
        items = [clean_changelog_item(version="v0.1.3")]
        output = io.StringIO()
        with (
            patch.object(kanban_sync, "get_all_items", return_value=items),
            patch.object(kanban_sync, "latest_release_tag", return_value="v0.1.4"),
            patch.object(kanban_sync, "tag_containing_commit") as tag,
            redirect_stdout(output),
        ):
            result = kanban_sync.cmd_audit()

        self.assertEqual(result, 0)
        tag.assert_not_called()

    def test_audit_aborts_without_release_api(self):
        items = [project_item("Detectado")]
        output = io.StringIO()
        err = io.StringIO()
        with (
            patch.object(kanban_sync, "get_all_items", return_value=items),
            patch.object(kanban_sync, "latest_release_tag", side_effect=kanban_sync.KanbanError("no network")),
            redirect_stdout(output),
            redirect_stderr(err),
        ):
            result = kanban_sync.cmd_audit()

        self.assertEqual(result, 1)
        self.assertIn("audit requires GitHub API access", err.getvalue())

    def test_next_patch_increments_patch_version(self):
        self.assertEqual(kanban_sync.next_patch("v0.1.4"), "v0.1.5")
        self.assertEqual(kanban_sync.next_patch("v1.2.9"), "v1.2.10")
        with self.assertRaises(kanban_sync.KanbanError):
            kanban_sync.next_patch("v0.1.4-beta")


class BackfillTests(unittest.TestCase):
    def test_backfills_missing_values_and_verifies_result(self):
        before = project_item(
            "Changelog",
            issue=True,
            closed_at="2026-01-31T23:30:00Z",
        )
        before["id"] = "item-id"
        after = project_item(
            "Changelog",
            issue=True,
            closed_at="2026-01-31T23:30:00Z",
            temporal={
                "Inicio": "2026-01-31",
                "Inicio exacto": "2026-01-31T22:00:00Z",
                "Completado": "2026-02-01",
                "Completado exacto": "2026-01-31T23:30:00Z",
            },
        )
        after["id"] = "item-id"
        with (
            patch.object(kanban_sync, "get_all_items", side_effect=[[before], [after]]),
            patch.object(kanban_sync, "set_text_field") as set_text,
            patch.object(kanban_sync, "set_date_field") as set_date,
        ):
            result = kanban_sync.cmd_backfill_timestamps()

        self.assertEqual(result, 0)
        self.assertEqual(set_text.call_count, 2)
        set_text.assert_any_call(
            "item-id", kanban_sync.FIELDS["StartedExact"], "2026-01-31T22:00:00Z"
        )
        set_text.assert_any_call(
            "item-id", kanban_sync.FIELDS["CompletedExact"], "2026-01-31T23:30:00Z"
        )
        self.assertEqual(set_date.call_count, 2)
        set_date.assert_any_call("item-id", kanban_sync.FIELDS["Started"], "2026-01-31")
        set_date.assert_any_call("item-id", kanban_sync.FIELDS["Completed"], "2026-02-01")

    def test_corrects_start_that_does_not_match_project_creation(self):
        before = project_item(
            "Detectado",
            temporal={
                "Inicio": "2026-01-31",
                "Inicio exacto": "2026-01-31T23:00:00Z",
            },
        )
        before["id"] = "item-id"
        after = project_item(
            "Detectado",
            temporal={
                "Inicio": "2026-01-31",
                "Inicio exacto": "2026-01-31T22:00:00Z",
            },
        )
        after["id"] = "item-id"
        with (
            patch.object(kanban_sync, "get_all_items", side_effect=[[before], [after]]),
            patch.object(kanban_sync, "set_text_field") as set_text,
            patch.object(kanban_sync, "set_date_field") as set_date,
        ):
            result = kanban_sync.cmd_backfill_timestamps()

        self.assertEqual(result, 0)
        set_text.assert_called_once_with(
            "item-id", kanban_sync.FIELDS["StartedExact"], "2026-01-31T22:00:00Z"
        )
        set_date.assert_not_called()

    def test_rejects_conflicting_existing_date_before_mutation(self):
        conflict = project_item(
            "Changelog",
            issue=True,
            closed_at="2026-01-31T23:30:00Z",
            temporal={"Completado": "2026-01-31"},
        )
        conflict["id"] = "item-id"
        with (
            patch.object(kanban_sync, "get_all_items", return_value=[conflict]),
            patch.object(kanban_sync, "set_text_field") as set_text,
            patch.object(kanban_sync, "set_date_field") as set_date,
        ):
            with self.assertRaises(kanban_sync.KanbanError):
                kanban_sync.cmd_backfill_timestamps()

        set_text.assert_not_called()
        set_date.assert_not_called()


if __name__ == "__main__":
    unittest.main()
