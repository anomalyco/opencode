#!/usr/bin/env node
/**
 * Redmine Time Entry Loader
 * 
 * Automates loading work hours into OneAdmin Redmine via Playwright.
 * 
 * First run: node setup.js    (configure credentials + settings)
 * Load hours: node load-hours.js --date 2026-07-13 --comment "Built installer"
 * 
 * Config hierarchy:
 *   1. CLI flags (--date, --comment, --detail, etc.)
 *   2. config.json (project, issue, activity defaults)
 *   3. .credentials (username, password)
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
  console.log('║        🔒 FIRST-TIME CREDENTIAL SETUP                     ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('  Your credentials will NEVER be sent to the cloud, logged,');
  console.log('  or visible in any AI context. They stay in a local file');
  console.log('  that only this script can read.');
  console.log('');

  if (isTTY) {
    // ── Interactive terminal ──
    console.log('  Opening editor to set REDMINE_USER and REDMINE_PASS...');
    const exampleFile = join(__dirname, '.credentials.example');
    writeFileSync(exampleFile,
      '# Redmine credentials — ONE-TIME SETUP\n' +
      '# Edit the values below, save, and close the editor.\n' +
      'REDMINE_USER=your_username\n' +
      'REDMINE_PASS=your_password\n' +
      '\n',
      'utf8'
    );
    const editor = pickEditor();
    const result = spawnSync(editor, [exampleFile], { stdio: 'inherit', encoding: 'utf8' });
    if (result.error || result.status !== 0) {
      console.error(`❌ Editor "${editor}" exited with error.`);
      console.error('   Create .credentials manually from .credentials.example');
      process.exit(1);
    }
    const raw = readFileSync(exampleFile, 'utf8');
    const user = raw.match(/REDMINE_USER=(.+)/)?.[1]?.trim();
    const pass = raw.match(/REDMINE_PASS=(.+)/)?.[1]?.trim();
    if (!user || !pass || user === 'your_username' || pass === 'your_password') {
      console.error('❌ You must set both REDMINE_USER and REDMINE_PASS in the file.');
      process.exit(1);
    }
    writeFileSync(credFile, `REDMINE_USER=${user}\nREDMINE_PASS=${pass}\n`, 'utf8');
    console.log('  ✅ Credentials saved locally in .credentials');
    return { user, pass };
  } else {
    // ── Non-interactive (AI context, CI, etc.) ──
    writeFileSync(credFile,
      '# Redmine credentials — ONE-TIME SETUP\n' +
      '# Edit the values below with your real credentials.\n' +
      'REDMINE_USER=your_username\n' +
      'REDMINE_PASS=your_password\n' +
      '\n',
      'utf8'
    );
    console.log('');
    console.log('  ═══════════════════════════════════════════════════════════');
    console.log('  🔒 Edit this file with your Redmine credentials:');
    console.log(`     ${credFile}`);
    console.log('');
    console.log('  Replace "your_username" and "your_password" with your real');
    console.log('  Redmine login. Then run this script again.');
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

  // 3. First-time setup: prompt via editor (safe — no credentials pass through chat)
  console.log('');
  console.log('  ─────────────────────────────────────────────────────');
  console.log('  🔒 No credentials found. Let\'s set them up securely.');
  console.log('  ─────────────────────────────────────────────────────');
  console.log('  Your credentials will NEVER pass through this chat');
  console.log('  or any AI context. They stay in a local file on your');
  console.log('  machine, readable only by this script.\n');
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
      console.error(`❌ Invalid --entries JSON: ${err.message}`);
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
// AUTO-DETAIL — Engram + git log when no --detail is provided
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
    parts.push('## Commits', gitLog);
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

  // Show help if no entries
  if (ENTRIES.length === 0) {
    console.log('');
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║         Redmine Time Entry Loader               ║');
    console.log('╚══════════════════════════════════════════════════╝');
    console.log('');
    console.log(`  Config:  ${CONFIG.project} / Task #${CONFIG.issueId}`);
    console.log(`  User:    ${CREDENTIALS.user}`);
    console.log('');
    console.log('  Usage:');
    console.log('    node load-hours.js --date YYYY-MM-DD --comment "What I did"');
    console.log('    node load-hours.js --entries \'[{...}]\'  (multi-project)');
    console.log('');
    console.log('  Options:');
    console.log('    --date       Date(s) comma-separated (required for simple mode)');
    console.log('    --entries    JSON array of entry objects (multi-project mode)');
    console.log('    --comment    Short summary');
    console.log('    --detail     Extended technical info (auto-generated from Engram + git log if omitted)');
    console.log('    --no-detail  Skip auto-detail generation');
    console.log('    --hours      Hours (default: 8)');
    console.log('    --activity   Activity type (default: Desarrollo)');
    console.log('    --issue      Issue ID override (comma-sep for multi-entry)');
    console.log('    --project    Project slug override (comma-sep for multi-entry)');
    console.log('');
    console.log('  Activities:');
    console.log(`    ${ACTIVITIES.join(', ')}`);
    console.log('');
    console.log('  Entry fields (--entries JSON):');
    console.log('    date (required), hours, activity, comment, detail,');
    console.log('    project, issue, skipAutoDetail');
    console.log('');
    console.log('  Examples:');
    console.log('    node load-hours.js --date 2026-07-13 --comment "Built installer"');
    console.log('    node load-hours.js --date 2026-07-14,2026-07-15 --comment "Dev work"');
    console.log('    node load-hours.js --date 2026-07-13 --no-detail --comment "Dev work"');
    console.log('');
    console.log('    # Multi-project in same day:');
    console.log('    node load-hours.js --entries \'[');
    console.log('      {"date":"2026-07-17","hours":4,"project":"proj-a","issue":"123","activity":"Desarrollo","comment":"Feature X"},');
    console.log('      {"date":"2026-07-17","hours":2,"project":"proj-b","issue":"456","activity":"Testing","comment":"Bug fixes"}');
    console.log('    ]\'');
    console.log('');
    process.exit(0);
  }

  // Validate activities
  for (const entry of ENTRIES) {
    const act = entry.activity || CONFIG.defaultActivity;
    if (!ACTIVITIES.includes(act)) {
      console.error(`❌ Invalid activity "${act}". Valid: ${ACTIVITIES.join(', ')}`);
      process.exit(1);
    }
  }

  // ── Banner ──
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║         Loading time entries                    ║');
  console.log('╚══════════════════════════════════════════════════╝');
  const uniqueProjects = [...new Set(ENTRIES.map(e => e.project || CONFIG.project))];
  if (uniqueProjects.length === 1) {
    console.log(`  📁 Project:  ${uniqueProjects[0]}`);
  } else {
    console.log(`  📁 Projects: ${uniqueProjects.join(', ')}`);
  }
  console.log(`  📋 Issue:    Task #${CONFIG.issueId}: ${CONFIG.issueLabel}`);
  console.log(`  🏷️  Activity: ${CONFIG.defaultActivity}`);
  console.log(`  ⏰ Hours:    ${CONFIG.defaultHours}/day`);
  console.log(`  📊 Entries:  ${ENTRIES.length}`);
  console.log('');

  // ── Auto-detail from Engram + git log ──
  for (const entry of ENTRIES) {
    if (!entry.skipAutoDetail && !entry.detail) {
      const autoDetail = formatAutoDetail(entry.date);
      if (autoDetail) {
        entry.detail = autoDetail;
        console.log(`  📋 Auto-detail generated for ${entry.date}`);
      } else {
        console.log(`  ⚠️  No commits or Engram observations for ${entry.date}, detail empty`);
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
    process.stdout.write('🔐 Logging in...');
    await page.goto(`${CONFIG.baseUrl}/login`, { waitUntil: 'networkidle' });
    await page.locator('#username').fill(CREDENTIALS.user);
    await page.locator('#password').fill(CREDENTIALS.pass);
    await page.locator('#login-submit').click();
    await page.waitForLoadState('networkidle', { timeout: 15000 });

    if (page.url().includes('/login')) {
      console.log(' ❌');
      console.error('  Login failed — run "node setup.js" to update credentials');
      process.exit(1);
    }
    console.log(' ✅');

    // ── Load entries ──
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
      if (comment) console.log(`     Comment: ${comment.length > 70 ? comment.substring(0, 70) + '...' : comment}`);
      if (detail) console.log(`     Detail:  ${detail.length > 70 ? detail.substring(0, 70) + '...' : detail}`);

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
          console.log('     ✅ Created');
          success++;
        } else {
          const error = await page.locator('.flash error, #errorExplanation').textContent().catch(() => null);
          console.log(`     ❌ Failed: ${error || 'unknown error'}`);
          failed++;
        }
      } catch (err) {
        console.log(`     ❌ Error: ${err.message}`);
        failed++;
      }
    }

    // ── Summary ──
    console.log('\n' + '═'.repeat(50));
    console.log(`  ✅ Created: ${success}  ❌ Failed: ${failed}  📊 Total: ${ENTRIES.length}`);
    console.log('═'.repeat(50));

    // ── Verify ──
    if (success > 0) {
      console.log('\n  🔍 Verifying...');
      const verifiedProjects = new Set();
      for (const entry of ENTRIES) {
        const project = entry.project || CONFIG.project;
        if (verifiedProjects.has(project)) continue;
        verifiedProjects.add(project);

        const entryDates = ENTRIES.filter(e => (e.project || CONFIG.project) === project).map(e => e.date);
        const sortedDates = [...new Set(entryDates)].sort();
        console.log(`     📁 ${project}: checking ${sortedDates[0]} → ${sortedDates[sortedDates.length - 1]}`);

        await page.goto(
          `${CONFIG.baseUrl}/projects/${project}/time_entries?set_filter=1&sort=spent_on:desc&f[]=spent_on&op[spent_on]=between&v[spent_on][]=${sortedDates[0]}&v[spent_on][]=${sortedDates[sortedDates.length - 1]}&f[]=user_id&op[user_id]==&v[user_id][]=me`,
          { waitUntil: 'networkidle' }
        );

        for (const e of ENTRIES.filter(en => (en.project || CONFIG.project) === project)) {
          const row = await page.locator(`tr:has(td:text-is("${e.date}"))`).count();
          console.log(`       ${e.date}: ${row > 0 ? '✅' : '⚠️  created (check list)'}`);
        }
      }
    }

  } finally {
    await browser.close();
    console.log('\n  🏁 Done.\n');
  }
}

main().catch(err => {
  console.error('\n❌ Fatal:', err.message);
  process.exit(1);
});
