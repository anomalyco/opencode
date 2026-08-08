#!/usr/bin/env python3
"""
kanban-sync.py — Automatización del flujo de items del kanban Jarvis · Interno.

Comandos:
  move <itemId> <fromStatus> <toStatus>  — Transiciona un item entre columnas
  changelog                              — Regenera docs/changelog.html + changelog.json
  audit                                  — Verifica campos de todos los items
  backfill-timestamps                    — Repara timestamps de todos los items
"""

import subprocess, json, sys, os, time, argparse, tempfile, re
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

PROJECT_ID = "PVT_kwHOBM87Yc4Bfu74"
REPO_ID = "R_kgDOTx4wIw"
REPO = "jaminsmoke/Jarvis"
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

FIELDS = {
    "Status":    "PVTSSF_lAHOBM87Yc4Bfu74zhZ_v1g",  # built-in Status (opciones custom via UI)
    "Version":   "PVTSSF_lAHOBM87Yc4Bfu74zhZ_weA",  # campo "Versión"
    "Prioridad": "PVTSSF_lAHOBM87Yc4Bfu74zhZ_wb4",
    "Decision":  "PVTSSF_lAHOBM87Yc4Bfu74zhZ_wb0",
    "Tipo":      "PVTSSF_lAHOBM87Yc4Bfu74zhZ_wbw",
    "Area":      "PVTSSF_lAHOBM87Yc4Bfu74zhZ_wwc",   # campo "Área principal"
    "HighLighted": "PVTSSF_lAHOBM87Yc4Bfu74zhZ_wbs",
    "Started":   "PVTF_lAHOBM87Yc4Bfu74zhZ_wwg",    # campo "Inicio"
    "StartedExact": "PVTF_lAHOBM87Yc4Bfu74zhZ_wxY",  # campo "Inicio exacto"
    "Completed": "PVTF_lAHOBM87Yc4Bfu74zhZ_wbo",     # campo "Completado"
    "CompletedExact": "PVTF_lAHOBM87Yc4Bfu74zhZ_wyQ", # campo "Completado exacto"
}

EXACT_FORMAT = "%Y-%m-%dT%H:%M:%SZ"
MADRID = ZoneInfo("Europe/Madrid")

STATUS = {
    "Detectado": "ef2fdff4", "Debate": "ddac116a", "Roadmap": "0ca99905",
    "Ejecutando": "79f82a08", "Verficando": "741a25fa", "Changelog": "f9a1286b",
}

VERSION = {
    "v0.1.0": "075d6fb1", "v0.1.1": "ace4e772", "v0.1.2": "b7128c7b",
    "v0.1.3": "4deda89b", "v0.1.4": "674f4064", "v0.1.5": "ec9916a0", "Sin asignar": "b38b3c4e",
}

PRIORITY = {"Alta": "6921d900", "Media": "f5651c12", "Baja": "2eee9b96"}
DECISION = {"Pendiente": "836be57a", "Aprobado": "f73848fa", "Diferido": "d4010352", "Cancelado": "57635fa9"}
TYPE = {
    "Bug": "274ee788", "Feature": "80bb9b0c", "Maintenance": "f15d15e8",
    "Security": "22af383b", "Decision": "fcdd6924",
}
AREA = {
    "App": "cef0dd05", "Desktop": "cdf56c71", "Core": "5b3f603e",
    "Server": "394a3c9b", "CI": "403239d7", "Infra": "8d9d4236",
    "Docs": "44c2fa77", "Lint": "1603e9a1", "Dependencies": "91bee31d",
    "Release": "0e4281a5", "Governance": "41e91e98", "Upstream": "5977d3e8",
}

LABELS = {
    "app": "LA_kwDOTx4wI88AAAACvXv54Q", "desktop": "LA_kwDOTx4wI88AAAACvXv6Bw",
    "docs": "LA_kwDOTx4wI88AAAACvXv6KQ", "CI": "LA_kwDOTx4wI88AAAACvXv6WQ",
    "infra": "LA_kwDOTx4wI88AAAACvXv6mA", "decision": "LA_kwDOTx4wI88AAAACvXv6uw",
    "lint": "LA_kwDOTx4wI88AAAACvXv69g", "feature": "LA_kwDOTx4wI88AAAACvXv7NA",
    "bug": "LA_kwDOTx4wI88AAAACvXv7Sw", "dependencies": "LA_kwDOTx4wI88AAAACvXv7fw",
    "maintenance": "LA_kwDOTx4wI88AAAACvXv7wQ", "security": "LA_kwDOTx4wI88AAAACvXv8BQ",
    "core": "LA_kwDOTx4wI88AAAACvXv8Iw", "server": "LA_kwDOTx4wI88AAAACvXv8Qw",
    "release": "LA_kwDOTx4wI88AAAACvXv8YA", "governance": "LA_kwDOTx4wI88AAAACvXv8fw",
    "upstream": "LA_kwDOTx4wI88AAAACvXv8nw",
}

TYPE_LABELS = {
    "Bug": "bug", "Feature": "feature", "Maintenance": "maintenance",
    "Security": "security", "Decision": "decision",
}
AREA_LABELS = {
    "App": "app", "Desktop": "desktop", "Core": "core", "Server": "server",
    "CI": "CI", "Infra": "infra", "Docs": "docs", "Lint": "lint",
    "Dependencies": "dependencies", "Release": "release", "Governance": "governance",
    "Upstream": "upstream",
}
LABEL_ALIASES = {"documentation": "docs", "enhancement": "feature"}

ROADMAP_BODY_SECTIONS = (
    "## Contexto",
    "## Hallazgo y evidencia",
    "## Decisión acordada",
    "## Plan aprobado",
    "## Criterios de aceptación",
    "## Plan de verificación",
    "## Riesgos y recuperación",
)


class KanbanError(RuntimeError):
    pass

# ── Helpers ──

def gql(query):
    descriptor, filename = tempfile.mkstemp(prefix='.kanban-sync-', suffix='.gql', dir=BASE_DIR)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as fh:
            fh.write(query)
        try:
            result = subprocess.run(['gh', 'api', 'graphql', '-F', f'query=@{filename}'],
                                    capture_output=True, encoding='utf-8', timeout=15)
        except (OSError, subprocess.SubprocessError) as error:
            raise KanbanError('GitHub GraphQL command failed') from error
    finally:
        if os.path.exists(filename):
            os.remove(filename)
    if result.returncode != 0:
        raise KanbanError(f'GitHub GraphQL command failed (code {result.returncode}): {result.stderr.strip() or result.stdout.strip()}')
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise KanbanError('GitHub GraphQL returned invalid JSON') from error
    if data.get('errors'):
        raise KanbanError('GitHub GraphQL returned errors')
    return data

def _get_field(fields_dict, *names):
    """Get field value, trying multiple name variants (accent-insensitive)."""
    for name in names:
        if name in fields_dict:
            return fields_dict[name]
    # Fallback: case-insensitive match
    nlow = {k.lower(): v for k, v in fields_dict.items()}
    for name in names:
        if name.lower() in nlow:
            return nlow[name.lower()]
    return '-'

def set_field(item_id, field_id, option_id):
    return gql(
        f'mutation{{updateProjectV2ItemFieldValue(input:{{'
        f'projectId:"{PROJECT_ID}",itemId:"{item_id}",'
        f'fieldId:"{field_id}",value:{{singleSelectOptionId:"{option_id}"}}'
        f'}}){{clientMutationId}}}}'
    )


def set_date_field(item_id, field_id, value):
    return gql(
        f'mutation{{updateProjectV2ItemFieldValue(input:{{'
        f'projectId:"{PROJECT_ID}",itemId:"{item_id}",'
        f'fieldId:"{field_id}",value:{{date:"{value}"}}'
        f'}}){{clientMutationId}}}}'
    )


def set_text_field(item_id, field_id, value):
    return gql(
        f'mutation{{updateProjectV2ItemFieldValue(input:{{'
        f'projectId:"{PROJECT_ID}",itemId:"{item_id}",'
        f'fieldId:"{field_id}",value:{{text:{json.dumps(value)}}}'
        f'}}){{clientMutationId}}}}'
    )


def clear_field(item_id, field_id):
    return gql(
        f'mutation{{clearProjectV2ItemFieldValue(input:{{'
        f'projectId:"{PROJECT_ID}",itemId:"{item_id}",fieldId:"{field_id}"'
        f'}}){{clientMutationId}}}}'
    )

def convert_to_issue(item_id):
    return gql(
        f'mutation{{convertProjectV2DraftIssueItemToIssue(input:{{'
        f'itemId:"{item_id}",repositoryId:"{REPO_ID}"'
        f'}}){{clientMutationId}}}}'
    )

def get_issue_from_item(item_id):
    item = get_item_content(item_id)
    return item if item['type'] == 'Issue' else None


def get_item_content(item_id):
    data = gql(
        f'{{node(id:"{item_id}"){{...on ProjectV2Item{{'
        f'id,createdAt,statusField:fieldValueByName(name:"Status"){{...on ProjectV2ItemFieldSingleSelectValue{{name,updatedAt}}}},'
        f'typeField:fieldValueByName(name:"Tipo"){{...on ProjectV2ItemFieldSingleSelectValue{{name}}}},'
        f'areaField:fieldValueByName(name:"Área principal"){{...on ProjectV2ItemFieldSingleSelectValue{{name}}}},'
        f'startedField:fieldValueByName(name:"Inicio"){{...on ProjectV2ItemFieldDateValue{{date}}}},'
        f'startedExactField:fieldValueByName(name:"Inicio exacto"){{...on ProjectV2ItemFieldTextValue{{text}}}},'
        f'completedField:fieldValueByName(name:"Completado"){{...on ProjectV2ItemFieldDateValue{{date}}}},'
        f'completedExactField:fieldValueByName(name:"Completado exacto"){{...on ProjectV2ItemFieldTextValue{{text}}}},'
        f'content{{__typename ...on DraftIssue{{id,title,body}} '
        f'...on Issue{{id,number,title,body,state,closedAt,labels(first:100){{nodes{{name}}}}}}}}}}}}}}'
    )
    node = data.get('data', {}).get('node')
    if not node or not node.get('content'):
        raise KanbanError('Project item content is unavailable')
    content = node['content']
    content['type'] = content.pop('__typename')
    content['project_created_at'] = node.get('createdAt')
    content['status'] = (node.get('statusField') or {}).get('name')
    content['status_updated_at'] = (node.get('statusField') or {}).get('updatedAt')
    content['tipo'] = (node.get('typeField') or {}).get('name')
    content['area'] = (node.get('areaField') or {}).get('name')
    content['started'] = (node.get('startedField') or {}).get('date')
    content['started_exact'] = (node.get('startedExactField') or {}).get('text')
    content['completed'] = (node.get('completedField') or {}).get('date')
    content['completed_exact'] = (node.get('completedExactField') or {}).get('text')
    content['labels'] = [label['name'] for label in content.get('labels', {}).get('nodes', [])]
    return content


def wait_for_issue(item_id, attempts=8):
    for attempt in range(attempts):
        item = get_item_content(item_id)
        if item['type'] == 'Issue':
            return item
        if attempt < attempts - 1:
            time.sleep(0.5)
    return None


def missing_roadmap_sections(body):
    return [section for section in ROADMAP_BODY_SECTIONS if section not in body]


def normalize_body(body):
    return body.replace('\r\n', '\n')


def content_matches(item, title, body):
    return item['title'] == title and normalize_body(item.get('body') or '') == normalize_body(body)


def classification_labels(item):
    if item.get('tipo') not in TYPE_LABELS:
        raise KanbanError('Tipo is missing or unknown')
    if item.get('area') not in AREA_LABELS:
        raise KanbanError('Área principal is missing or unknown')
    return [TYPE_LABELS[item['tipo']], AREA_LABELS[item['area']]]


def parse_api_datetime(value):
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (AttributeError, ValueError):
        return None
    if parsed.tzinfo is None:
        return None
    return parsed.astimezone(timezone.utc)


def parse_exact(value):
    try:
        return datetime.strptime(value, EXACT_FORMAT).replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def temporal_values(moment=None):
    exact = (moment or datetime.now(timezone.utc)).astimezone(timezone.utc).replace(microsecond=0)
    return exact.astimezone(MADRID).date().isoformat(), exact.strftime(EXACT_FORMAT)


def date_from_exact(value):
    parsed = parse_exact(value)
    return parsed.astimezone(MADRID).date().isoformat() if parsed else None


ACTIVE_STATUSES = {"Detectado", "Debate", "Roadmap", "Ejecutando", "Verificando"}

KNOWN_VERSIONS = {"v0.1.0", "v0.1.1", "v0.1.2", "v0.1.3", "v0.1.4", "v0.1.5", "Sin asignar"}


def latest_release_tag():
    result = subprocess.run(
        ['gh', 'api', f'repos/{REPO}/releases/latest', '--jq', '.tag_name'],
        capture_output=True, encoding='utf-8', timeout=15,
    )
    if result.returncode == 0:
        return result.stdout.strip()
    if 'Not Found' in result.stderr:
        return None
    raise KanbanError('Cannot reach GitHub API to resolve latest release')


def next_patch(version):
    match = re.match(r'^v(\d+)\.(\d+)\.(\d+)$', version)
    if not match:
        raise KanbanError(f'Unparseable release version: {version}')
    major, minor, patch = (int(g) for g in match.groups())
    return f'v{major}.{minor}.{patch + 1}'


def tag_containing_commit(commit_sha):
    result = subprocess.run(
        ['git', 'tag', '--contains', commit_sha],
        capture_output=True, encoding='utf-8', timeout=15,
    )
    if result.returncode != 0:
        return None
    tags = [line.strip() for line in result.stdout.splitlines() if line.strip().startswith('v')]
    return tags or None


def ensure_temporal_pair(item_id, item, date_key, exact_key, date_field, exact_field, moment=None):
    exact = item.get(exact_key)
    date = item.get(date_key)
    if exact:
        expected_date = date_from_exact(exact)
        if not expected_date:
            raise KanbanError(f'{exact_key} has an invalid UTC timestamp')
        if date != expected_date:
            set_date_field(item_id, FIELDS[date_field], expected_date)
        return expected_date, exact
    if date:
        raise KanbanError(f'{date_key} exists without {exact_key}; refusing to invent a timestamp')
    expected_date, exact = temporal_values(moment)
    set_text_field(item_id, FIELDS[exact_field], exact)
    set_date_field(item_id, FIELDS[date_field], expected_date)
    return expected_date, exact


def ensure_item_started(item_id, item):
    created_at = parse_api_datetime(item.get('project_created_at'))
    if not created_at:
        raise KanbanError('Project item createdAt is unavailable')
    expected_date, expected_exact = temporal_values(created_at)
    if item.get('started') not in (None, expected_date):
        raise KanbanError('Inicio conflicts with Project item createdAt')
    if item.get('started_exact') not in (None, expected_exact):
        raise KanbanError('Inicio exacto conflicts with Project item createdAt')
    if not item.get('started_exact'):
        set_text_field(item_id, FIELDS['StartedExact'], expected_exact)
    if not item.get('started'):
        set_date_field(item_id, FIELDS['Started'], expected_date)
    return expected_date, expected_exact

def add_labels(issue_id, label_names):
    names = list(dict.fromkeys(label_names))
    missing = [name for name in names if name not in LABELS]
    if missing:
        raise KanbanError(f'Unknown canonical labels: {", ".join(missing)}')
    label_ids = [LABELS[name] for name in names]
    if not label_ids: return None
    ids_str = '","'.join(label_ids)
    return gql(f'mutation{{addLabelsToLabelable(input:{{labelableId:"{issue_id}",labelIds:["{ids_str}"]}}){{clientMutationId}}}}')

def update_issue(issue_id, title=None, body=None):
    parts = [f'id:"{issue_id}"']
    if title:
        parts.append(f'title:"{title.replace(chr(92), chr(92)*2).replace(chr(34), chr(92)+chr(34))}"')
    if body:
        parts.append(f'body:"{body.replace(chr(92), chr(92)*2).replace(chr(34), chr(92)+chr(34)).replace(chr(10), chr(92)+"n")}"')
    return gql(f'mutation{{updateIssue(input:{{{", ".join(parts)}}}){{clientMutationId}}}}')

def close_issue(issue_id):
    return gql(f'mutation{{closeIssue(input:{{issueId:"{issue_id}",stateReason:COMPLETED}}){{clientMutationId}}}}')


def reopen_issue(issue_id):
    return gql(f'mutation{{reopenIssue(input:{{issueId:"{issue_id}"}}){{clientMutationId}}}}')

def get_all_items():
    items = []
    cursor = None
    while True:
        after = f',after:"{cursor}"' if cursor else ''
        data = gql(
            f'{{node(id:"{PROJECT_ID}"){{...on ProjectV2{{'
            f'items(first:100{after}){{pageInfo{{hasNextPage,endCursor}},nodes{{id,createdAt,'
            f'content{{...on DraftIssue{{id,title,body}}'
            f'...on Issue{{id,title,number,state,closedAt,body,labels(first:100){{nodes{{name}}}}}}}}'
            f'fieldValues(first:50){{nodes{{'
            f'...on ProjectV2ItemFieldSingleSelectValue{{field{{...on ProjectV2FieldCommon{{name}}}},name,updatedAt}}'
            f'...on ProjectV2ItemFieldDateValue{{field{{...on ProjectV2FieldCommon{{name}}}},date}}'
            f'...on ProjectV2ItemFieldTextValue{{field{{...on ProjectV2FieldCommon{{name}}}},text}}'
            f'}}}}}}}}}}}}}}'
        )
        connection = data.get('data', {}).get('node', {}).get('items')
        if not connection:
            raise KanbanError('Project items are unavailable')
        items.extend(connection['nodes'])
        if not connection['pageInfo']['hasNextPage']:
            return items
        cursor = connection['pageInfo']['endCursor']

# ── move ──

def cmd_move(item_id, from_status, to_status):
    print(f"Moving {item_id}: {from_status} -> {to_status}")
    to_id = STATUS.get(to_status)
    if not to_id: return print(f"ERROR: Unknown status '{to_status}'") or 1
    item = get_item_content(item_id)
    started, started_exact = ensure_item_started(item_id, item)
    item['started'] = started
    item['started_exact'] = started_exact

    if from_status == "Detectado" and to_status == "Debate":
        set_field(item_id, FIELDS["Status"], to_id); print("  OK Status -> Debate"); return 0
    if from_status == "Debate" and to_status == "Roadmap":
        set_field(item_id, FIELDS["Decision"], DECISION["Aprobado"]); print("  OK Decision -> Aprobado")
        set_field(item_id, FIELDS["Status"], to_id); print("  OK Status -> Roadmap"); return 0
    if from_status == "Roadmap" and to_status == "Ejecutando":
        if item['status'] == "Ejecutando":
            if item['type'] != 'Issue':
                raise KanbanError('Ejecutando item is not an Issue')
            expected_labels = classification_labels(item)
            add_labels(item['id'], expected_labels)
            current = get_item_content(item_id)
            if current['status'] != "Ejecutando" or not set(expected_labels).issubset(current['labels']):
                raise KanbanError('Ejecutando recovery postconditions failed')
            if not current['started'] or not current['started_exact']:
                raise KanbanError('Ejecutando recovery timestamp postconditions failed')
            print("  OK Existing Issue already in Ejecutando with labels and Inicio preserved")
            return 0
        if item['status'] != "Roadmap":
            print(f"ERROR: Actual status is '{item['status']}', expected 'Roadmap'", file=sys.stderr)
            return 1
        missing = missing_roadmap_sections(item.get('body') or '')
        if missing:
            print(f"ERROR: Roadmap body is missing required sections: {', '.join(missing)}", file=sys.stderr)
            return 1
        try:
            expected_labels = classification_labels(item)
        except KanbanError as error:
            print(f"ERROR: {error}; Status remains Roadmap", file=sys.stderr)
            return 1
        original_title = item['title']
        original_body = item['body']
        if item['type'] == 'DraftIssue':
            if not convert_to_issue(item_id):
                print("ERROR: Draft conversion failed; Status remains Roadmap", file=sys.stderr)
                return 1
            issue = wait_for_issue(item_id)
            if not issue:
                print("ERROR: Converted Issue is not visible; Status remains Roadmap", file=sys.stderr)
                return 1
            print(f"  OK Draft -> Issue #{issue['number']}")
        elif item['type'] == 'Issue':
            issue = item
            print(f"  OK Resuming Issue #{issue['number']} in Roadmap")
        else:
            print(f"ERROR: Unsupported item type '{item['type']}'", file=sys.stderr)
            return 1
        if not content_matches(issue, original_title, original_body):
            update_issue(issue['id'], title=original_title, body=original_body)
            restored = get_item_content(item_id)
            if restored['type'] != 'Issue' or not content_matches(restored, original_title, original_body):
                print("ERROR: Title or body changed and recovery failed; Status remains Roadmap", file=sys.stderr)
                return 1
            print("ERROR: Title or body changed and was restored; retry from Roadmap", file=sys.stderr)
            return 1
        print("  OK Title and body preserved")
        add_labels(issue['id'], expected_labels); print(f"  OK Labels {', '.join(expected_labels)} -> #{issue['number']}")
        print(f"  OK Inicio -> {started_exact} ({started})")
        set_field(item_id, FIELDS["Status"], to_id); print("  OK Status -> Ejecutando")
        current = get_item_content(item_id)
        if current['status'] != "Ejecutando" or current['started'] != started or current['started_exact'] != started_exact:
            raise KanbanError('Roadmap -> Ejecutando postconditions failed; retry is safe')
        return 0
    if from_status == "Ejecutando" and to_status == "Verificando":
        if item['status'] != "Ejecutando":
            print(f"ERROR: Actual status is '{item['status']}', expected 'Ejecutando'", file=sys.stderr)
            return 1
        set_field(item_id, FIELDS["Status"], to_id); print("  OK Status -> Verificando")
        print("  [!] Remember to update description with implementation details"); return 0
    if from_status == "Verificando" and to_status == "Changelog":
        issue = item
        if issue['status'] not in ("Verificando", "Changelog") or issue['type'] != 'Issue':
            print(f"ERROR: Actual item is {issue['type']} in '{issue['status']}', expected Issue in Verificando", file=sys.stderr)
            return 1
        completed, completed_exact = ensure_temporal_pair(
            item_id, issue, 'completed', 'completed_exact', 'Completed', 'CompletedExact'
        )
        if issue['status'] == "Verificando":
            set_field(item_id, FIELDS["Status"], to_id); print("  OK Status -> Changelog"); time.sleep(0.3)
        old_title = issue.get('title', '')
        if not old_title.startswith('✅ '):
            update_issue(issue['id'], title=f"✅ {old_title}"); print("  OK Title -> ✅")
        if issue.get('state') != 'CLOSED':
            close_issue(issue['id']); print(f"  OK Issue #{issue['number']} closed")
        current = get_item_content(item_id)
        if current['status'] != "Changelog" or current['state'] != 'CLOSED':
            raise KanbanError('Verificando -> Changelog state postconditions failed; retry is safe')
        if current['completed'] != completed or current['completed_exact'] != completed_exact:
            raise KanbanError('Verificando -> Changelog timestamp postconditions failed; retry is safe')
        cmd_changelog(); return 0
    if from_status == "Changelog" and to_status != "Changelog":
        issue = item
        if issue['type'] != 'Issue' or issue['status'] != 'Changelog':
            print(f"ERROR: Actual item is {issue['type']} in '{issue['status']}', expected Issue in Changelog", file=sys.stderr)
            return 1
        if issue.get('completed') or issue.get('completed_exact'):
            entry = f"- Ciclo completado: `{issue.get('completed_exact') or issue.get('completed')}`"
            if entry not in issue['body']:
                heading = "\n\n## Historial temporal\n" if "## Historial temporal" not in issue['body'] else "\n"
                update_issue(issue['id'], body=issue['body'] + heading + entry)
                restored = get_item_content(item_id)
                if entry not in restored['body']:
                    raise KanbanError('Completion history could not be preserved')
        if issue.get('state') == 'CLOSED':
            reopen_issue(issue['id'])
        if issue['title'].startswith('✅ '):
            update_issue(issue['id'], title=issue['title'][2:])
        if issue.get('completed_exact'):
            clear_field(item_id, FIELDS['CompletedExact'])
        if issue.get('completed'):
            clear_field(item_id, FIELDS['Completed'])
        set_field(item_id, FIELDS["Status"], to_id); print(f"  OK Reopened -> {to_status}")
        return 0
    if to_status == "Changelog" and from_status in ("Detectado", "Debate"):
        set_field(item_id, FIELDS["Decision"], DECISION["Cancelado"]); print("  OK Decision -> Cancelado")
        set_field(item_id, FIELDS["Status"], to_id); print("  OK Status -> Changelog"); time.sleep(0.3)
        convert_to_issue(item_id); time.sleep(0.3)
        issue = get_issue_from_item(item_id)
        if issue:
            old_title = issue.get('title', '')
            if not old_title.startswith('✅ '): update_issue(issue['id'], title=f"✅ {old_title}")
            add_labels(issue['id'], ['decision']); close_issue(issue['id'])
            print(f"  OK Issue #{issue['number']} closed as Cancelado")
        return 0
    set_field(item_id, FIELDS["Status"], to_id); print(f"  OK Status -> {to_status}"); return 0

# ── changelog ──

def cmd_changelog():
    print("Regenerating changelog.html...")
    items = get_all_items()
    changelog_items = []
    for i in items:
        ct = i['content']
        if 'number' not in ct: continue
        fields = {}
        for fv in i.get('fieldValues', {}).get('nodes', []):
            fn = fv.get('field', {}).get('name', '?')
            val = fv.get('name', '?')
            if val != '?': fields[fn] = val
        if fields.get('Status') == 'Changelog':
            ver = _get_field(fields, 'Versión', 'Version', 'versi', 'Versi')
            changelog_items.append({'number': ct['number'], 'title': ct.get('title', '?'), 'version': ver})

    by_version = {}
    for item in changelog_items:
        v = item['version']
        by_version.setdefault(v, []).append(item)

    version_order = ['v0.1.5', 'v0.1.4', 'v0.1.3', 'v0.1.2', 'v0.1.1', 'v0.1.0', 'Sin asignar']
    sorted_versions = [v for v in version_order if v in by_version]
    total = sum(len(vv) for vv in by_version.values())

    html = [
        '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
        '<title>Jarvis — Changelog</title>'
        '<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:900px;margin:40px auto;padding:0 20px;background:#0d1117;color:#c9d1d9}'
        'h1{font-size:28px;border-bottom:1px solid #30363d;padding-bottom:12px}'
        'h2{font-size:20px;color:#58a6ff;margin-top:32px}'
        'ul{padding-left:20px}li{margin:6px 0;line-height:1.5}'
        'a{color:#58a6ff;text-decoration:none}a:hover{text-decoration:underline}'
        '.count{color:#8b949e;font-size:13px}.back{display:inline-block;margin-bottom:20px}'
        '</style></head><body>'
        f'<a href="index.html" class="back">← Volver</a>'
        f'<h1>Changelog de Jarvis</h1>'
        f'<p>{total} issues</p>',
    ]

    for ver in sorted_versions:
        issues = by_version[ver]
        html.append(f'<h2>{ver} <span class="count">({len(issues)} issues)</span></h2><ul>')
        for item in issues:
            title = item['title'].replace('✅ ', '')
            html.append(f'<li><a href="https://github.com/{REPO}/issues/{item["number"]}">#{item["number"]}</a> {title}</li>')
        html.append('</ul>')

    html.extend(['</body></html>'])

    changelog_path = os.path.join(BASE_DIR, '..', 'docs', 'changelog.html')
    os.makedirs(os.path.dirname(changelog_path), exist_ok=True)
    with open(changelog_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(html))
    print(f"  OK changelog.html regenerated ({total} issues across {len(sorted_versions)} versions)")

    # Also regenerate changelog.json (highlights only)
    gen_json = os.path.join(BASE_DIR, 'generate-changelog-json.py')
    subprocess.run([sys.executable, gen_json], check=True)


def item_fields(item):
    fields = {}
    updated = {}
    for value in item.get('fieldValues', {}).get('nodes', []):
        name = value.get('field', {}).get('name', '?')
        field_value = value.get('name', value.get('date', value.get('text', '?')))
        if field_value != '?':
            fields[name] = field_value
        if value.get('updatedAt'):
            updated[name] = value['updatedAt']
    return fields, updated


def cmd_backfill_timestamps():
    print("Backfilling Project timestamps...")
    plan = []
    for item in get_all_items():
        fields, _ = item_fields(item)
        content = item['content']
        created_at = parse_api_datetime(item.get('createdAt'))
        if not created_at:
            raise KanbanError(f'Project item {item["id"]} lacks createdAt')
        started, started_exact = temporal_values(created_at)
        completed = None
        completed_exact = None
        if fields.get('Status') == 'Changelog':
            closed_at = parse_api_datetime(content.get('closedAt'))
            if 'number' not in content or content.get('state') != 'CLOSED' or not closed_at:
                raise KanbanError(f'Changelog item {item["id"]} lacks a closed Issue timestamp')
            completed, completed_exact = temporal_values(closed_at)
            if fields.get('Completado') not in (None, completed):
                raise KanbanError(f'Issue #{content["number"]} has a conflicting Completado date')
            if fields.get('Completado exacto') not in (None, completed_exact):
                raise KanbanError(f'Issue #{content["number"]} has a conflicting Completado exacto')
        plan.append((item['id'], content.get('number'), fields, started, started_exact, completed, completed_exact))

    changed = []
    try:
        for item_id, number, fields, started, started_exact, completed, completed_exact in plan:
            if fields.get('Inicio exacto') != started_exact:
                set_text_field(item_id, FIELDS['StartedExact'], started_exact)
                changed.append((item_id, FIELDS['StartedExact'], 'text', fields.get('Inicio exacto')))
            if fields.get('Inicio') != started:
                set_date_field(item_id, FIELDS['Started'], started)
                changed.append((item_id, FIELDS['Started'], 'date', fields.get('Inicio')))
            if completed_exact and not fields.get('Completado exacto'):
                set_text_field(item_id, FIELDS['CompletedExact'], completed_exact)
                changed.append((item_id, FIELDS['CompletedExact'], 'text', None))
            if completed and not fields.get('Completado'):
                set_date_field(item_id, FIELDS['Completed'], completed)
                changed.append((item_id, FIELDS['Completed'], 'date', None))
            label = f'#{number}' if number else item_id
            print(f"  OK {label} -> Inicio {started_exact}" + (f", Completado {completed_exact}" if completed_exact else ""))
    except KanbanError as error:
        rollback_failed = False
        for item_id, field_id, field_type, old_value in reversed(changed):
            try:
                if old_value is None:
                    clear_field(item_id, field_id)
                elif field_type == 'date':
                    set_date_field(item_id, field_id, old_value)
                else:
                    set_text_field(item_id, field_id, old_value)
            except KanbanError:
                rollback_failed = True
        suffix = '; rollback incomplete' if rollback_failed else '; changes rolled back'
        raise KanbanError(f'Backfill failed{suffix}') from error

    remaining = []
    for item in get_all_items():
        fields, _ = item_fields(item)
        started, started_exact = temporal_values(parse_api_datetime(item.get('createdAt')))
        invalid_start = fields.get('Inicio') != started or fields.get('Inicio exacto') != started_exact
        invalid_completed = fields.get('Status') == 'Changelog' and date_from_exact(
            fields.get('Completado exacto')
        ) != fields.get('Completado')
        if invalid_start or invalid_completed:
            remaining.append(item['id'])
    if remaining:
        raise KanbanError(f'Backfill verification failed for {len(remaining)} items')
    print(f"  OK {len(plan)} Project items verified; {len(changed)} values written")
    return 0

# ── audit ──

def cmd_audit():
    print("Auditing kanban...")
    try:
        latest = latest_release_tag()
    except KanbanError as error:
        print(f"ERROR: {error}; audit requires GitHub API access", file=sys.stderr)
        return 1
    if latest is None:
        target = "v0.1.0"
        print(f"  No releases yet -> version objetivo={target}")
    else:
        target = next_patch(latest)
        print(f"  Release latest={latest} -> version objetivo={target}")
    items = get_all_items()
    issues_found = 0

    for i in items:
        ct = i['content']
        is_issue = 'number' in ct
        title = ct.get('title', '?')[:55]
        fields, _ = item_fields(i)

        st = fields.get('Status', 'SIN')
        ver = _get_field(fields, 'Versión', 'Version')
        prio = fields.get('Prioridad', '-')
        dec = _get_field(fields, 'Decisión', 'Decision')
        tipo = fields.get('Tipo', '-')
        area = fields.get('Área principal', '-')
        started = fields.get('Inicio')
        started_exact = fields.get('Inicio exacto')
        completed = fields.get('Completado')
        completed_exact = fields.get('Completado exacto')

        problems = []
        if ver == '-': problems.append('Version')
        elif ver == 'Sin asignar': problems.append('VERSION_SIN_ASIGNAR')
        elif ver not in KNOWN_VERSIONS: problems.append(f'VERSION_DESCONOCIDA:{ver}')
        elif st in ACTIVE_STATUSES and ver != target:
            problems.append(f'VERSION_ACTIVA_NO_OBJETIVO:espera_{target}_tiene_{ver}')
        elif st == 'Changelog' and ver != target:
            sha = re.search(r'\b[0-9a-f]{40}\b', ct.get('body') or '')
            if sha:
                tags = tag_containing_commit(sha.group(0))
                if tags and ver not in tags:
                    problems.append(f'VERSION_HISTORICA_INCOHERENTE:{ver}_commit_no_verificado')
        if prio == '-': problems.append('Prioridad')
        if (title.startswith('D-0') or title.startswith('✅ D-0')) and dec == '-': problems.append('Decision')
        if st == 'Changelog' and not is_issue: problems.append('DRAFT_EN_CHANGELOG')
        created_at = parse_api_datetime(i.get('createdAt'))
        expected_started, expected_started_exact = temporal_values(created_at) if created_at else (None, None)
        if not created_at: problems.append('CREATED_AT_FALTA')
        if not started: problems.append('INICIO_FALTA')
        if not started_exact: problems.append('INICIO_EXACTO_FALTA')
        if bool(started) != bool(started_exact): problems.append('INICIO_INCOMPLETO')
        if started_exact and not parse_exact(started_exact): problems.append('INICIO_EXACTO_INVALIDO')
        if started_exact and date_from_exact(started_exact) != started: problems.append('INICIO_FECHA_INCOHERENTE')
        if created_at and started and started != expected_started: problems.append('INICIO_NO_COINCIDE_CREATED_AT')
        if created_at and started_exact and started_exact != expected_started_exact: problems.append('INICIO_EXACTO_NO_COINCIDE_CREATED_AT')
        if st == 'Changelog' and not completed: problems.append('COMPLETADO_FALTA')
        if st == 'Changelog' and not completed_exact: problems.append('COMPLETADO_EXACTO_FALTA')
        if completed_exact and not parse_exact(completed_exact): problems.append('COMPLETADO_EXACTO_INVALIDO')
        if completed_exact and date_from_exact(completed_exact) != completed: problems.append('COMPLETADO_FECHA_INCOHERENTE')
        if st != 'Changelog' and (completed or completed_exact): problems.append('FINALIZACION_FUERA_DE_CHANGELOG')
        classification_scope = st != 'Changelog' or ver == 'v0.1.4'
        if classification_scope and tipo == '-': problems.append('Tipo')
        if classification_scope and area == '-': problems.append('Área principal')
        if classification_scope and tipo != '-' and tipo not in TYPE_LABELS: problems.append(f'TIPO_DESCONOCIDO:{tipo}')
        if classification_scope and area != '-' and area not in AREA_LABELS: problems.append(f'AREA_DESCONOCIDA:{area}')
        if classification_scope and is_issue and tipo in TYPE_LABELS and area in AREA_LABELS:
            actual_labels = {label['name'] for label in ct.get('labels', {}).get('nodes', [])}
            expected_labels = {TYPE_LABELS[tipo], AREA_LABELS[area]}
            problems.extend(f'LABEL_FALTA:{label}' for label in sorted(expected_labels - actual_labels))
            problems.extend(f'ALIAS:{label}->{LABEL_ALIASES[label]}' for label in sorted(actual_labels & LABEL_ALIASES.keys()))
            extra_types = (actual_labels & set(TYPE_LABELS.values())) - {TYPE_LABELS[tipo]}
            problems.extend(f'TIPO_LABEL_EXTRA:{label}' for label in sorted(extra_types))
        if problems:
            print(f"  [{st:12}] {title:55s}  PROBLEMS: {', '.join(problems)}")
            issues_found += 1

    if issues_found == 0:
        print("  OK All items OK!")
    else:
        print(f"\n  [!] {issues_found} items with issues")

    drafts = sum(1 for i in items if 'number' not in i['content'] and any(
        fv.get('name') == 'Changelog' for fv in i.get('fieldValues',{}).get('nodes',[])
        if fv.get('field',{}).get('name') == 'Status'))
    if drafts: print(f"  [!!] {drafts} Drafts in Changelog!")
    return issues_found

# ── CLI ──

def main():
    parser = argparse.ArgumentParser(description='Kanban automation for Jarvis')
    sub = parser.add_subparsers(dest='command')
    p = sub.add_parser('move', help='Move item between columns')
    p.add_argument('item_id'); p.add_argument('from_status'); p.add_argument('to_status')
    sub.add_parser('changelog', help='Regenerate changelog.html')
    sub.add_parser('audit', help='Audit all kanban items')
    sub.add_parser('backfill-timestamps', help='Backfill exact Changelog timestamps')
    args = parser.parse_args()
    try:
        if args.command == 'move': return cmd_move(args.item_id, args.from_status, args.to_status)
        if args.command == 'changelog': return cmd_changelog()
        if args.command == 'audit': return cmd_audit()
        if args.command == 'backfill-timestamps': return cmd_backfill_timestamps()
        parser.print_help(); return 1
    except KanbanError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1

if __name__ == '__main__':
    sys.exit(main())
