import path from 'node:path';
import { hermesPath, hostPath, isUuid, workspacesRoot } from './workspace.js';

describe('workspace paths', () => {
  const id = '3f2b8c1e-9d4a-4b6f-8e2a-1c5d7f9a0b3e';

  beforeEach(() => {
    process.env.WORKSPACES_DIR = '/tmp/aba-ws';
  });

  it('accepts only UUIDs as project ids', () => {
    expect(isUuid(id)).toBe(true);
    for (const bad of ['', '..', '../etc', 'abc', `${id}/..`, `${id}\0`]) {
      expect(isUuid(bad)).toBe(false);
    }
  });

  it('builds the API path and the Hermes path for the same folder', () => {
    expect(hostPath(id)).toBe(path.join('/tmp/aba-ws', id));
    expect(hermesPath(id)).toBe(`/workspaces/${id}`);
    expect(path.dirname(hostPath(id))).toBe(workspacesRoot());
  });

  it('refuses anything that is not a UUID instead of building a path from it', () => {
    expect(() => hostPath('../../etc')).toThrow();
    expect(() => hermesPath('x')).toThrow();
  });
});
