import { SseParser } from './sse.js';

describe('SseParser', () => {
  it('parses JSON data frames, even when split across chunks', () => {
    const p = new SseParser();
    expect(p.push('id: 1\ndata: {"event":"run.st')).toEqual([]);
    expect(p.push('arted"}\n\nid: 2\r\ndata: {"event":"tool.started","tool":"write_file"}\r\n\r\n')).toEqual([
      { event: 'run.started' },
      { event: 'tool.started', tool: 'write_file' },
    ]);
  });

  it('ignores comments, keep-alives and non-JSON frames', () => {
    const p = new SseParser();
    expect(p.push(': keep-alive\n\ndata: not json\n\ndata: {"event":"x"}\n\n')).toEqual([{ event: 'x' }]);
  });
});
