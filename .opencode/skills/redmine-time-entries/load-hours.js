#!/usr/bin/env node
/**
 * Cargador de Horas Redmine
 * 
 * Automatiza la carga de horas en OneAdmin Redmine via Playwright.
 * 
 * Uso: bun load-hours.js --date YYYY-MM-DD --comment "Resumen del trabajo"
 * 
 * Jerarquía de configuración:
 *   1. Flags CLI (--date, --comment, --detail, etc.)
 *   2. config.json (proyecto, tarea, actividad por defecto)
 *   3. .credentials (usuario, contraseña)
 */

import { chromium } from 'playwright';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawnSync } from 'child_process';
import { createRequire } from 'module';
import { createInterface } from 'readline/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ═══════════════════════════════════════════════════════════════
// CONFIG LOADING
// ═══════════════════════════════════════════════════════════════

function loadJSON(filename) {
  const path = join(__dirname, filename);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function pickEditor() {
  // User preference first
  if (process.env.EDITOR || process.env.VISUAL) return process.env.EDITOR || process.env.VISUAL;
  // GUI desktop detected → prefer graphical editor
  if (process.env.DISPLAY) {
    for (const gui of ['gedit', 'kate', 'mousepad', 'pluma', 'leafpad']) {
      try { execSync(`which ${gui} 2>/dev/null`, { encoding: 'utf8' }); return gui; } catch {}
    }
  }
  // Terminal fallback
  return 'nano';
}

function promptCredentials() {
  const credFile = join(__dirname, '.credentials');
  const isTTY = process.stdin.isTTY;

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║        🔒 CONFIGURACIÓN DE CREDENCIALES                    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('  Tus credenciales NUNCA se envían a la nube, se loguean,');
  console.log('  ni se ven en ningún contexto de IA. Quedan en un archivo');
  console.log('  local que solo este script puede leer.');
  console.log('');

  if (isTTY) {
    // ── Terminal interactivo ──
    console.log('  Abriendo editor para configurar REDMINE_USER y REDMINE_PASS...');
    const exampleFile = join(__dirname, '.credentials.example');
    writeFileSync(exampleFile,
      '# Credenciales Redmine — CONFIGURACIÓN ÚNICA\n' +
      '# Editá los valores abajo, guardá y cerrá el editor.\n' +
      'REDMINE_USER=tu_usuario\n' +
      'REDMINE_PASS=tu_contraseña\n' +
      '\n',
      'utf8'
    );
    const editor = pickEditor();
    const result = spawnSync(editor, [exampleFile], { stdio: 'inherit', encoding: 'utf8' });
    if (result.error || result.status !== 0) {
      console.error(`❌ El editor "${editor}" falló.`);
      console.error('   Creá .credentials manualmente desde .credentials.example');
      process.exit(1);
    }
    const raw = readFileSync(exampleFile, 'utf8');
    const user = raw.match(/REDMINE_USER=(.+)/)?.[1]?.trim();
    const pass = raw.match(/REDMINE_PASS=(.+)/)?.[1]?.trim();
    if (!user || !pass || user === 'tu_usuario' || pass === 'tu_contraseña') {
      console.error('❌ Tenés que completar REDMINE_USER y REDMINE_PASS en el archivo.');
      process.exit(1);
    }
    writeFileSync(credFile, `REDMINE_USER=${user}\nREDMINE_PASS=${pass}\n`, 'utf8');
    console.log('  ✅ Credenciales guardadas en .credentials');
    return { user, pass };
  } else {
    // ── No interactivo (AI context, CI, etc.) ──
    writeFileSync(credFile,
      '# Credenciales Redmine — CONFIGURACIÓN ÚNICA\n' +
      '# Editá los valores abajo con tus credenciales reales.\n' +
      'REDMINE_USER=tu_usuario\n' +
      'REDMINE_PASS=tu_contraseña\n' +
      '\n',
      'utf8'
    );
    console.log('');
    console.log('  ═══════════════════════════════════════════════════════════');
    console.log('  🔒 Editá este archivo con tus credenciales de Redmine:');
    console.log(`     ${credFile}`);
    console.log('');
    console.log('  Reemplazá "tu_usuario" y "tu_contraseña" con tus datos');
    console.log('  reales de Redmine. Después ejecutá este script de nuevo.');
    console.log('  ═══════════════════════════════════════════════════════════');
    console.log('');
    process.exit(0);
  }
}

function loadCredentials() {
  // 1. Env vars
  if (process.env.REDMINE_USER && process.env.REDMINE_PASS) {
    return { user: process.env.REDMINE_USER, pass: process.env.REDMINE_PASS };
  }

  // 2. .credentials file (KEY=VALUE format)
  try {
    const raw = readFileSync(join(__dirname, '.credentials'), 'utf8');
    const user = raw.match(/REDMINE_USER=(.+)/)?.[1]?.trim();
    const pass = raw.match(/REDMINE_PASS=(.+)/)?.[1]?.trim();
    if (user && pass) return { user, pass };
  } catch {}

  // 3. Primera vez: pedir credenciales (seguro — no pasan por el chat)
  console.log('');
  console.log('  ─────────────────────────────────────────────────────');
  console.log('  🔒 No hay credenciales. Vamos a configurarlas.');
  console.log('  ─────────────────────────────────────────────────────');
  console.log('  Tus credenciales NUNCA pasan por este chat');
  console.log('  ni por ningún contexto de IA. Quedan en un archivo');
  console.log('  local en tu máquina, solo este script puede leerlo.\n');
  return promptCredentials();
}

// ═══════════════════════════════════════════════════════════════
// ENTRY BUILDER — combines config + CLI into entries
// ═══════════════════════════════════════════════════════════════

function parseArgs() {
  const args = process.argv.slice(2);
  const flags = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) continue;

    const key = arg.slice(2);

    // Look ahead for a value (next arg not starting with --)
    if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
      flags[key] = args[i + 1];
      i++;
    } else {
      flags[key] = true; // boolean flag
    }
  }

  return flags;
}

function buildEntries() {
  const flags = parseArgs();

  // NEW: --entries JSON array (supports multi-project)
  if (flags.entries) {
    try {
      const raw = flags.entries;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        console.error('❌ --entries must be a non-empty JSON array');
        process.exit(1);
      }
      return parsed.map((e, i) => ({
        date: e.date,
        hours: e.hours ? parseFloat(e.hours) : undefined,
        activity: e.activity || undefined,
        comment: e.comment || undefined,
        detail: e.detail || undefined,
        project: e.project || undefined,
        issueId: e.issue || e.issueId || undefined,
        skipAutoDetail: !!e.skipAutoDetail,
      }));
    } catch (err) {
      console.error(`❌ JSON de --entries inválido: ${err.message}`);
      process.exit(1);
    }
  }

  // OLD: --date (backward compat)
  if (!flags.date) return [];

  const dates = flags.date.split(',').map(d => d.trim());
  const projects = flags.project ? flags.project.split(',').map(p => p.trim()) : [];
  const issues = flags.issue ? flags.issue.split(',').map(i => i.trim()) : [];
  const skipAutoDetail = flags['no-detail'] === true;
  return dates.map((date, i) => ({
    date,
    hours: flags.hours ? parseFloat(flags.hours) : undefined,
    activity: flags.activity || undefined,
    comment: flags.comment || undefined,
    detail: skipAutoDetail ? undefined : (flags.detail || undefined),
    project: projects[i] || projects[0] || undefined,
    issueId: issues[i] || issues[0] || flags.issue || undefined,
    skipAutoDetail,
  }));
}

// ═══════════════════════════════════════════════════════════════
// ACTIVITIES — valid Redmine activity labels
// ═══════════════════════════════════════════════════════════════

const ACTIVITIES = [
  'Análisis', 'Diseño', 'Desarrollo', 'Seguimiento', 'Testing',
  'Prueba de Concepto', 'Reunion', 'Despliegue+Soporte QA',
  'Despliegue+Soporte PROD', 'Gestión',
];

// ═══════════════════════════════════════════════════════════════
// AUTO-COMMENT — genera resumen descriptivo cuando no hay --comment
// ═══════════════════════════════════════════════════════════════

function generateAutoComment(date) {
  const gitLog = queryGitLog(date);
  const commits = gitLog ? gitLog.split('\n').filter(l => l.trim()).map(l => l.replace(/^\s*-\s*/, '').replace(/\s+\([a-f0-9]+\)$/, '')) : [];
  if (commits.length === 0) return '';

  // Etiquetas de tipos en español
  const typeLabels = {
    feat: 'implementación', fix: 'corrección', docs: 'documentación',
    test: 'tests', refactor: 'refactor', chore: 'mantenimiento',
  };

  // Traducción de scopes
  const scopeLabels = {
    installer: 'Instalador', install: 'Instalador', skills: 'Skills',
    core: 'Núcleo', tui: 'Interfaz', cli: 'CLI', sdk: 'SDK',
    config: 'Configuración', app: 'App', desktop: 'Escritorio',
    plugin: 'Plugin', opencode: 'OpenCode', general: 'General',
  };

  // Agrupar por scope y contar tipos
  const scopes = {};
  for (const c of commits) {
    const match = c.match(/^(\w+)(?:\(([^)]+)\))?:\s*(.+)/);
    if (match) {
      const scope = scopeLabels[match[2]] || match[2] || 'General';
      const type = typeLabels[match[1]] || match[1];
      if (!scopes[scope]) scopes[scope] = [];
      scopes[scope].push(type);
    } else {
      if (!scopes['General']) scopes['General'] = [];
      scopes['General'].push('cambio');
    }
  }

  // Armar resumen en español
  const parts = Object.entries(scopes).map(([scope, types]) => {
    const total = types.length;
    // Contar ocurrencias por tipo
    const counts = {};
    for (const t of types) counts[t] = (counts[t] || 0) + 1;
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);

    // Si hay un solo tipo dominante, decir "X cambios de tipo Y"
    if (sorted.length === 1) {
      const [t, c] = sorted[0];
      if (c === 1) return `${scope}: 1 cambio (${t})`;
      return `${scope}: ${c} cambios (${t})`;
    }

    // Múltiples tipos: "documentación, tests y correcciones"
    const labels = sorted.map(([t, c]) => c > 1 ? `${t} (${c})` : t);
    const desc = labels.length <= 2
      ? labels.join(' y ')
      : labels.slice(0, -1).join(', ') + ' y ' + labels[labels.length - 1];
    return `${scope}: ${desc}`;
  });

  return parts.join(' | ');
}

// ═══════════════════════════════════════════════════════════════
// AUTO-DETAIL — Engram + git log cuando no se pasa --detail
// ═══════════════════════════════════════════════════════════════

const _require = createRequire(import.meta.url);

function queryEngram(date) {
  try {
    const home = process.env.HOME || '';
    const dbPath = `${home}/.engram/engram.db`;

    if (!existsSync(dbPath)) return null;

    if (typeof process !== 'undefined' && process.isBun) {
      const { Database } = _require('bun:sqlite');
      const db = new Database(dbPath, { readonly: true });
      return db.prepare(
        "SELECT title, content, type, created_at FROM observations WHERE project = 'opencode' AND deleted_at IS NULL AND date(created_at) = ? ORDER BY created_at"
      ).all(date);
    }

    // Fallback: shell out to bun when running with node
    const script = `
const { Database } = require('bun:sqlite');
const db = new Database('${dbPath}', { readonly: true });
const rows = db.prepare("SELECT title, content, type, created_at FROM observations WHERE project = 'opencode' AND deleted_at IS NULL AND date(created_at) = '${date}' ORDER BY created_at").all();
process.stdout.write(JSON.stringify(rows));
`;
    const result = spawnSync('bun', ['-e', script], { encoding: 'utf8', timeout: 10000 });
    if (result.error || result.status !== 0) return null;
    return JSON.parse(result.stdout.trim());
  } catch {
    return null;
  }
}

function queryGitLog(date) {
  try {
    const repoPath = '/home/servidor/Descargas/opencode';
    const after = date;
    const before = `${date}T23:59:59`;

    const result = execSync(
      `git -C "${repoPath}" log --after="${after}" --before="${before}" --format="  - %s (%h)" --no-merges`,
      { encoding: 'utf8', timeout: 10000 }
    );
    return result.trim();
  } catch {
    return '';
  }
}

function formatAutoDetail(date) {
  const engramRows = queryEngram(date);
  const gitLog = queryGitLog(date);
  const parts = [];

  // Git log section
  if (gitLog) {
    parts.push('## Commits del día', gitLog);
  }

  // Engram section
  if (engramRows && engramRows.length > 0) {
    const categories = {
      'Decisiones / Arquitectura': ['architecture', 'decision'],
      'Bugs': ['bugfix'],
      'Descubrimientos': ['discovery', 'learning'],
      'Configuración / Patrones': ['config', 'pattern'],
    };

    const grouped = {};
    for (const row of engramRows) {
      let found = false;
      for (const [catName, types] of Object.entries(categories)) {
        if (types.includes(row.type)) {
          if (!grouped[catName]) grouped[catName] = [];
          const what = row.content.match(/\*\*What\*\*:\s*(.+?)(?:\n|$)/)?.[1]?.trim()
            || row.content.substring(0, 100).replace(/\n/g, ' ').trim() + '…';
          grouped[catName].push(`- **${row.title}**: ${what}`);
          found = true;
          break;
        }
      }
      if (!found) {
        if (!grouped['Otros']) grouped['Otros'] = [];
        const what = row.content.substring(0, 100).replace(/\n/g, ' ').trim() + '…';
        grouped['Otros'].push(`- **${row.title}**: ${what}`);
      }
    }

    parts.push('## Engram');
    for (const [catName, items] of Object.entries(grouped)) {
      parts.push(`### ${catName}`);
      parts.push(...items);
    }
    parts.push('', `## Sesiones registradas: ${engramRows.length}`);
  }

  if (!gitLog && (!engramRows || engramRows.length === 0)) {
    return '';
  }

  return parts.join('\n');
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

async function main() {
  // Load config
  const fileConfig = loadJSON('config.json') || {};
  const CREDENTIALS = loadCredentials();
  const ENTRIES = buildEntries();

  const CONFIG = {
    baseUrl: fileConfig.baseUrl || 'https://oneadmin.oneinfoconsulting.com',
    project: fileConfig.project || 'service-delivery-2026',
    issueId: fileConfig.issueId || '15464',
    issueLabel: fileConfig.issueLabel || 'Gestión Interna',
    defaultActivity: fileConfig.defaultActivity || 'Desarrollo',
    defaultHours: fileConfig.defaultHours || 8,
    headless: fileConfig.headless !== false,
  };

  // CLI overrides for config
  const cliFlags = parseArgs();
  if (cliFlags.project) CONFIG.project = cliFlags.project;
  if (cliFlags.issue) CONFIG.issueId = cliFlags.issue;
  if (cliFlags.headless === 'false') CONFIG.headless = false;

  // Mostrar ayuda si no hay entradas
  if (ENTRIES.length === 0) {
    console.log('');
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║       Cargador de Horas Redmine                 ║');
    console.log('╚══════════════════════════════════════════════════╝');
    console.log('');
    console.log(`  Config:  ${CONFIG.project} / Tarea #${CONFIG.issueId}`);
    console.log(`  Usuario: ${CREDENTIALS.user}`);
    console.log('');
    console.log('  Uso:');
    console.log('    bun load-hours.js --date YYYY-MM-DD --comment "Resumen"');
    console.log('    bun load-hours.js --entries \'[{...}]\'  (multi-proyecto)');
    console.log('');
    console.log('  Opciones:');
    console.log('    --date       Fecha(s) separadas por coma (modo simple)');
    console.log('    --entries    JSON array de entradas (modo multi-proyecto)');
    console.log('    --comment    Resumen corto (se auto-genera si se omite)');
    console.log('    --detail     Info técnica extendida (auto-generada)');
    console.log('    --no-detail  Saltear auto-generación de detalle');
    console.log('    --hours      Horas (default: 8)');
    console.log('    --activity   Tipo de actividad (default: Desarrollo)');
    console.log('    --issue      ID de tarea (coma-sep para multi-entry)');
    console.log('    --project    Slug del proyecto (coma-sep para multi-entry)');
    console.log('');
    console.log('  Actividades:');
    console.log(`    ${ACTIVITIES.join(', ')}`);
    console.log('');
    console.log('  Campos de entrada (--entries JSON):');
    console.log('    date (obligatorio), hours, activity, comment, detail,');
    console.log('    project, issue, skipAutoDetail');
    console.log('');
    console.log('  Ejemplos:');
    console.log('    bun load-hours.js --date 2026-07-13 --comment "Correcciones instalador"');
    console.log('    bun load-hours.js --date 2026-07-14,2026-07-15');
    console.log('    bun load-hours.js --date 2026-07-13 --no-detail');
    console.log('');
    console.log('    # Multi-proyecto mismo día:');
    console.log('    bun load-hours.js --entries \'[');
    console.log('      {"date":"2026-07-17","hours":4,"project":"proj-a","issue":"123","activity":"Desarrollo","comment":"Nueva funcionalidad"},');
    console.log('      {"date":"2026-07-17","hours":2,"project":"proj-b","issue":"456","activity":"Testing","comment":"Corrección de bugs"}');
    console.log('    ]\'');
    console.log('');
    process.exit(0);
  }

  // Validar actividades
  for (const entry of ENTRIES) {
    const act = entry.activity || CONFIG.defaultActivity;
    if (!ACTIVITIES.includes(act)) {
      console.error(`❌ Actividad inválida "${act}". Válidas: ${ACTIVITIES.join(', ')}`);
      process.exit(1);
    }
  }

  // ── Auto-comment (resumen descriptivo) ──
  for (const entry of ENTRIES) {
    if (!entry.comment) {
      const autoComment = generateAutoComment(entry.date);
      if (autoComment) {
        entry.comment = autoComment;
        console.log(`  💬 Comment auto-generado: ${autoComment.substring(0, 80)}${autoComment.length > 80 ? '…' : ''}`);
      }
    }
  }

  // ── Banner ──
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║         Cargando horas                          ║');
  console.log('╚══════════════════════════════════════════════════╝');
  const uniqueProjects = [...new Set(ENTRIES.map(e => e.project || CONFIG.project))];
  if (uniqueProjects.length === 1) {
    console.log(`  📁 Proyecto: ${uniqueProjects[0]}`);
  } else {
    console.log(`  📁 Proyectos: ${uniqueProjects.join(', ')}`);
  }
  console.log(`  📋 Tarea:    #${CONFIG.issueId}: ${CONFIG.issueLabel}`);
  console.log(`  🏷️  Activ.:   ${CONFIG.defaultActivity}`);
  console.log(`  ⏰ Horas:    ${CONFIG.defaultHours}/día`);
  console.log(`  📊 Entradas: ${ENTRIES.length}`);
  console.log('');

  // ── Auto-detail desde Engram + git log ──
  for (const entry of ENTRIES) {
    if (!entry.skipAutoDetail && !entry.detail) {
      const autoDetail = formatAutoDetail(entry.date);
      if (autoDetail) {
        entry.detail = autoDetail;
        console.log(`  📋 Detalle auto-generado para ${entry.date}`);
      } else {
        console.log(`  ⚠️  Sin commits ni observaciones Engram para ${entry.date}, detalle vacío`);
      }
    }
  }
  console.log('');

  const browser = await chromium.launch({
    headless: CONFIG.headless,
    args: ['--no-sandbox'],
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    });
    const page = await context.newPage();

    // ── Login ──
    process.stdout.write('🔐 Iniciando sesión...');
    await page.goto(`${CONFIG.baseUrl}/login`, { waitUntil: 'networkidle' });
    await page.locator('#username').fill(CREDENTIALS.user);
    await page.locator('#password').fill(CREDENTIALS.pass);
    await page.locator('#login-submit').click();
    await page.waitForLoadState('networkidle', { timeout: 15000 });

    if (page.url().includes('/login')) {
      console.log(' ❌');
      console.error('  Error de inicio de sesión — actualizá credenciales en .credentials');
      process.exit(1);
    }
    console.log(' ✅');

    // ── Cargar entradas ──
    let success = 0;
    let failed = 0;

    for (let i = 0; i < ENTRIES.length; i++) {
      const entry = ENTRIES[i];
      const date = entry.date;
      const hours = entry.hours || CONFIG.defaultHours;
      const activity = entry.activity || CONFIG.defaultActivity;
      const comment = entry.comment || '';
      const detail = entry.detail || '';
      const project = entry.project || CONFIG.project;
      const issueId = entry.issueId || CONFIG.issueId;
      const isLast = i === ENTRIES.length - 1;

      const projectLabel = project !== CONFIG.project ? `[${project}] ` : '';
      console.log(`\n  📝 [${i + 1}/${ENTRIES.length}] ${projectLabel}${date} — ${hours}h ${activity}`);
      if (comment) console.log(`     Comentario: ${comment.length > 80 ? comment.substring(0, 80) + '...' : comment}`);
      if (detail) console.log(`     Detalle:   ${detail.length > 80 ? detail.substring(0, 80) + '...' : detail}`);

      try {
        await page.goto(`${CONFIG.baseUrl}/projects/${project}/time_entries/new`, {
          waitUntil: 'networkidle',
        });

        // Date
        await page.locator('#time_entry_spent_on').fill(date);

        // Hours
        await page.locator('#time_entry_hours').fill(String(hours));

        // Comment
        if (comment) {
          await page.locator('#time_entry_comments').fill(comment);
        }

        // Detail (extended technical info)
        if (detail) {
          const detailField = page.getByRole('textbox', { name: 'Detail' });
          await detailField.fill(detail);
        }

        // Activity dropdown
        await page.locator('#time_entry_activity_id').selectOption({ label: activity });

        // Issue autocomplete
        if (issueId) {
          const issueField = page.getByRole('textbox', { name: 'Petición' });
          await issueField.fill('');
          await issueField.pressSequentially(String(issueId), { delay: 80 });
          await page.waitForTimeout(1500);

          const dropdown = page.locator('.ui-menu-item');
          const count = await dropdown.count();
          if (count > 0) {
            await dropdown.first().click();
            await page.waitForTimeout(300);
          } else {
            console.log('     ⚠️  No autocomplete match, submitting without issue link');
          }
        }

        // Submit
        const submitBtn = isLast
          ? page.getByRole('button', { name: 'Crear', exact: true })
          : page.getByRole('button', { name: 'Crear y continuar' });

        await submitBtn.click();
        await page.waitForLoadState('networkidle', { timeout: 10000 });

          if (!page.url().includes('/time_entries/new')) {
          console.log('     ✅ Creada');
          success++;
        } else {
          const error = await page.locator('.flash error, #errorExplanation').textContent().catch(() => null);
          console.log(`     ❌ Falló: ${error || 'error desconocido'}`);
          failed++;
        }
      } catch (err) {
        console.log(`     ❌ Error: ${err.message}`);
        failed++;
      }
    }

    // ── Resumen ──
    console.log('\n' + '═'.repeat(50));
    console.log(`  ✅ Creadas: ${success}  ❌ Fallaron: ${failed}  📊 Total: ${ENTRIES.length}`);
    console.log('═'.repeat(50));

    // ── Verificar ──
    if (success > 0) {
      console.log('\n  🔍 Verificando...');
      const verifiedProjects = new Set();
      for (const entry of ENTRIES) {
        const project = entry.project || CONFIG.project;
        if (verifiedProjects.has(project)) continue;
        verifiedProjects.add(project);

        const entryDates = ENTRIES.filter(e => (e.project || CONFIG.project) === project).map(e => e.date);
        const sortedDates = [...new Set(entryDates)].sort();
        console.log(`     📁 ${project}: verificando ${sortedDates[0]} → ${sortedDates[sortedDates.length - 1]}`);

        await page.goto(
          `${CONFIG.baseUrl}/projects/${project}/time_entries?set_filter=1&sort=spent_on:desc&f[]=spent_on&op[spent_on]=between&v[spent_on][]=${sortedDates[0]}&v[spent_on][]=${sortedDates[sortedDates.length - 1]}&f[]=user_id&op[user_id]==&v[user_id][]=me`,
          { waitUntil: 'networkidle' }
        );

        for (const e of ENTRIES.filter(en => (en.project || CONFIG.project) === project)) {
          const row = await page.locator(`tr:has(td:text-is("${e.date}"))`).count();
          console.log(`       ${e.date}: ${row > 0 ? '✅' : '⚠️  creada (revisar listado)'}`);
        }
      }
    }

  } finally {
    await browser.close();
    console.log('\n  🏁 Terminado.\n');
  }
}

main().catch(err => {
  console.error('\n❌ Error fatal:', err.message);
  process.exit(1);
});
