import { homedir } from 'node:os';
import path from 'node:path';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function assertUuid(id: string): void {
  if (!isUuid(id)) throw new Error(`Not a project id: ${JSON.stringify(id)}`);
}

/** Where the API sees the workspaces (on the laptop, inside WSL). */
export function workspacesRoot(): string {
  return path.resolve(
    process.env.WORKSPACES_DIR ?? path.join(homedir(), 'aba-data', 'workspaces'),
  );
}

/** A project's folder as the API sees it. Built only from a validated UUID. */
export function hostPath(projectId: string): string {
  assertUuid(projectId);
  return path.join(workspacesRoot(), projectId);
}

/** The same folder as Hermes sees it inside its container. Always tell Hermes this one. */
export function hermesPath(projectId: string): string {
  assertUuid(projectId);
  return `/workspaces/${projectId}`;
}
