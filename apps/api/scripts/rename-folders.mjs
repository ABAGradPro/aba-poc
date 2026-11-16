#!/usr/bin/env node
// One-time move to readable folder names: renames every project folder that is still
// named by its id (or by an old name) to folderFor(name, id), e.g. "coffee-shop-d5de03ae",
// and updates Project.folder. Safe to run again: projects already named correctly are skipped.
//
// Usage (from apps/api, with PostgreSQL running and no build in progress):
//   pnpm folders:rename            show what would change
//   pnpm folders:rename --apply    do it
import 'dotenv/config';
import { existsSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import pg from 'pg';
import { folderFor, hostPath } from '../src/projects/workspace.ts';

const apply = process.argv.includes('--apply');
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const busy = await db.query(`select count(*)::int as n from "Run" where status in ('queued','running')`);
if (busy.rows[0].n > 0) {
  console.error('A build is running. Wait for it to finish, then run this again.');
  process.exit(1);
}

const { rows } = await db.query('select id, name, folder from "Project" order by "createdAt"');
let changed = 0;
for (const p of rows) {
  const target = folderFor(p.name, p.id);
  if (p.folder === target) continue;
  const from = hostPath(p.folder);
  const to = hostPath(target);
  const note = existsSync(from) ? '' : '  (no folder on disk; database only)';
  console.log(`${p.folder}  →  ${target}   "${p.name}"${note}`);
  changed++;
  if (!apply) continue;
  if (existsSync(to)) throw new Error(`${to} already exists; not overwriting it`);
  if (existsSync(from)) await rename(from, to);
  try {
    await db.query('update "Project" set folder = $1 where id = $2', [target, p.id]);
  } catch (err) {
    if (existsSync(to)) await rename(to, from);
    throw err;
  }
}
await db.end();
console.log(
  changed === 0
    ? 'All project folders already have readable names.'
    : apply
      ? `Renamed ${changed} project folder(s).`
      : `${changed} folder(s) would be renamed. Run again with --apply to do it.`,
);
