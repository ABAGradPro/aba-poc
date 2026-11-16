import path from 'node:path';
import { folderFor, hermesPath, hostPath, isFolderName, isUuid, trashRoot, workspacesRoot } from './workspace.js';

describe('workspace paths', () => {
  const id = 'd5de03ae-4617-425e-a0df-38b0c5a879f1';

  beforeEach(() => {
    process.env.WORKSPACES_DIR = '/tmp/aba-ws';
    delete process.env.TRASH_DIR;
  });

  it('accepts only UUIDs as project ids', () => {
    expect(isUuid(id)).toBe(true);
    for (const bad of ['', '..', '../etc', 'abc', `${id}/..`, `${id}\0`]) {
      expect(isUuid(bad)).toBe(false);
    }
  });

  it('names the folder after the project, plus 8 characters of the id', () => {
    expect(folderFor('Coffee shop', id)).toBe('coffee-shop-d5de03ae');
    expect(folderFor('  Amman   Coffee!! ', id)).toBe('amman-coffee-d5de03ae');
    expect(folderFor('Café Crème', id)).toBe('cafe-creme-d5de03ae');
    expect(folderFor('ping_pong.shop', id)).toBe('ping-pong-shop-d5de03ae');
  });

  it('drops characters that are not a–z or 0–9, and falls back to "project"', () => {
    expect(folderFor('3ageed Restaurant باب الحارة', id)).toBe('3ageed-restaurant-d5de03ae');
    expect(folderFor('باب الحارة', id)).toBe('project-d5de03ae');
    expect(folderFor('!!!', id)).toBe('project-d5de03ae');
  });

  it('can never produce a path that escapes the workspaces folder', () => {
    for (const evil of ['../../etc/passwd', '..', '/root', 'a/../../b', '.git', 'C:\\Windows']) {
      const folder = folderFor(evil, id);
      expect(isFolderName(folder)).toBe(true);
      expect(path.dirname(hostPath(folder))).toBe(workspacesRoot());
    }
  });

  it('keeps long names to a readable length', () => {
    const folder = folderFor('a very long project name '.repeat(10), id);
    expect(folder.length).toBeLessThanOrEqual(49);
    expect(folder.endsWith('-d5de03ae')).toBe(true);
    expect(folder).not.toMatch(/--/);
  });

  it('builds the API path, the Hermes path and the trash folder', () => {
    expect(hostPath('coffee-shop-d5de03ae')).toBe('/tmp/aba-ws/coffee-shop-d5de03ae');
    expect(hermesPath('coffee-shop-d5de03ae')).toBe('/workspaces/coffee-shop-d5de03ae');
    expect(trashRoot()).toBe('/tmp/trash');
    expect(hostPath(id)).toBe(path.join('/tmp/aba-ws', id)); // old id-named folders still work
  });

  it('refuses anything that is not a valid folder name', () => {
    for (const bad of ['../../etc', '.git', 'Coffee', 'a b', 'a--b', '-a', 'a/b', '']) {
      expect(() => hostPath(bad), bad).toThrow();
    }
    expect(() => folderFor('x', 'not-a-uuid')).toThrow();
  });
});
