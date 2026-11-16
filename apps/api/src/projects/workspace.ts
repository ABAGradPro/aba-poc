import { homedir } from 'node:os';
import path from 'node:path';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A project folder: lowercase letters and digits in groups joined by single hyphens. */
const FOLDER_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_BASE = 40;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function isFolderName(value: string): boolean {
  return value.length <= 64 && FOLDER_RE.test(value);
}

/**
 * The folder for a project: its name made safe for file paths, plus the first
 * 8 characters of its id so two projects with the same name never collide.
 * "Coffee shop" + "d5de03ae-…" → "coffee-shop-d5de03ae".
 * Only a–z, 0–9 and "-" survive, so names like "../etc" can never escape WORKSPACES_DIR.
 */
export function folderFor(name: string, projectId: string): string {
  if (!isUuid(projectId)) throw new Error(`Not a project id: ${JSON.stringify(projectId)}`);
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // é → e
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_BASE)
    .replace(/-+$/, '');
  return `${base || 'project'}-${projectId.slice(0, 8).toLowerCase()}`;
}

function assertFolder(folder: string): void {
  if (!isFolderName(folder)) throw new Error(`Not a project folder: ${JSON.stringify(folder)}`);
}

/** Where the API sees the workspaces (on the laptop, inside WSL). */
export function workspacesRoot(): string {
  return path.resolve(
    process.env.WORKSPACES_DIR ?? path.join(homedir(), 'aba-data', 'workspaces'),
  );
}

/** Where deleted projects' folders are moved, so a mistake can still be undone by hand. */
export function trashRoot(): string {
  return path.resolve(process.env.TRASH_DIR ?? path.join(path.dirname(workspacesRoot()), 'trash'));
}

/** A project's folder as the API sees it. Built only from a validated folder name. */
export function hostPath(folder: string): string {
  assertFolder(folder);
  return path.join(workspacesRoot(), folder);
}

/** The same folder as Hermes sees it inside its container. Always tell Hermes this one. */
export function hermesPath(folder: string): string {
  assertFolder(folder);
  return `/workspaces/${folder}`;
}
