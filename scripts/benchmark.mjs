#!/usr/bin/env node
// NFR1 mini-benchmark (guide, Step 8): 10 fixed prompts through the ABA API, each checked
// with the aba-verify check script (headless Chromium: console errors, missing files, rules).
//
// Needs the API (pnpm --filter api start:dev), PostgreSQL and Hermes running.
// Usage: node scripts/benchmark.mjs [--only 1,4]   (results: docs/benchmark-results.md)
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const API = process.env.ABA_API ?? 'http://127.0.0.1:3000/api';
const RUN_LIMIT_MS = 11 * 60 * 1000;

const PROMPTS = [
  ['business', 'A landing page for a family bakery in Amman with opening hours, a menu of breads and pastries, and a contact form'],
  ['business', 'A website for a dental clinic with services, prices, the team, and a form to book an appointment'],
  ['business', 'A page for a car repair garage listing services, customer reviews, and a button to call or send a message'],
  ['shop', 'An online bookshop page with a grid of books, a search box, and a shopping cart that adds up the total'],
  ['shop', 'A shop page for phone accessories with product cards, filters by type, and an add-to-cart button'],
  ['shop', 'A flower shop page where customers choose a bouquet, pick a delivery date, and see the price'],
  ['personal', 'A personal portfolio for a graphic designer with a short bio, a gallery of work, and contact links'],
  ['personal', 'A wedding invitation page with the couple names, date and place, a countdown, and an RSVP form'],
  ['educational', 'A 5-question multiple choice quiz about the solar system that shows the score at the end'],
  ['educational', 'A vocabulary flashcard app for learning English words with flip cards and next and previous buttons'],
];

const only = (() => {
  const i = process.argv.indexOf('--only');
  return i > 0 ? new Set(process.argv[i + 1].split(',').map(Number)) : null;
})();

let cookie = '';
async function call(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${await res.text()}`);
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  return res.status === 204 ? null : res.json();
}

/** Follows a run's event stream until its final status. */
async function follow(runId) {
  const res = await fetch(`${API}/runs/${runId}/events`, {
    headers: { Cookie: cookie },
    signal: AbortSignal.timeout(RUN_LIMIT_MS),
  });
  const decoder = new TextDecoder();
  let buffer = '';
  let final = { status: 'failed', text: 'stream ended' };
  let version = null;
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let end;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = frame.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('');
      if (!data) continue;
      const e = JSON.parse(data);
      if (e.type === 'version.created') version = e.version;
      if (e.type === 'run.status' && ['completed', 'failed', 'timeout'].includes(e.status)) final = e;
    }
  }
  return { final, version };
}

function verify(projectId) {
  try {
    return execFileSync(
      'docker',
      ['exec', '-u', '1000', 'hermes', 'sh', '/opt/data/skills/aba/aba-verify/check.sh', `/workspaces/${projectId}`],
      { encoding: 'utf8', timeout: 90_000 },
    ).trim();
  } catch (err) {
    return `FAIL\n- check script error: ${String(err.message).split('\n')[0]}`;
  }
}

const user = { username: `bench-${Date.now()}`, password: 'benchmark password' };
await call('/auth/register', user);
await call('/auth/login', user);

const results = [];
for (const [i, [category, prompt]] of PROMPTS.entries()) {
  const n = i + 1;
  if (only && !only.has(n)) continue;
  const t0 = Date.now();
  process.stdout.write(`[${n}/10] ${category}: ${prompt.slice(0, 60)}… `);
  let row;
  try {
    const project = await call('/projects', { name: `Benchmark ${n}: ${category}` });
    const { runId } = await call(`/projects/${project.id}/runs`, { prompt });
    const { final, version } = await follow(runId);
    const check = final.status === 'completed' ? verify(project.id) : `FAIL\n- run ${final.status}: ${final.text ?? ''}`;
    const pass = check.startsWith('PASS');
    row = { n, category, prompt, projectId: project.id, run: final.status, version: version?.number ?? null, pass, check, seconds: Math.round((Date.now() - t0) / 1000) };
  } catch (err) {
    row = { n, category, prompt, run: 'error', pass: false, check: `FAIL\n- ${err.message}`, seconds: Math.round((Date.now() - t0) / 1000) };
  }
  results.push(row);
  console.log(`${row.pass ? 'PASS' : 'FAIL'} (${row.seconds}s)`);
  if (!row.pass) console.log('   ' + row.check.split('\n').slice(1).join('\n   '));
}

const passed = results.filter((r) => r.pass).length;
const lines = [
  '# NFR1 mini-benchmark results',
  '',
  `Run ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · model google/gemma-4-31b-it via OpenRouter · checked with skills/aba/aba-verify/check.sh (headless Chromium).`,
  '',
  '| # | Category | Prompt | Run | Renders without console errors? | Time |',
  '| --- | --- | --- | --- | --- | --- |',
  ...results.map((r) => `| ${r.n} | ${r.category} | ${r.prompt} | ${r.run}${r.version ? ` (v${r.version})` : ''} | ${r.pass ? '✅ PASS' : '❌ FAIL'} | ${Math.floor(r.seconds / 60)}m ${r.seconds % 60}s |`),
  '',
  `**Result: ${passed} of ${results.length}** (target: at least 7 of 10, NFR1 = 70%).`,
  '',
  ...results.filter((r) => !r.pass).flatMap((r) => [`Failure details for #${r.n}:`, '```', r.check, '```', '']),
];
writeFileSync('docs/benchmark-results.md', lines.join('\n') + '\n');
writeFileSync('/tmp/aba-benchmark.json', JSON.stringify(results, null, 2));
console.log(`\nResult: ${passed} of ${results.length} passed. Written to docs/benchmark-results.md`);
