/** Incremental Server-Sent Events parser: feed it text chunks, get back the JSON `data:` payloads. */
export class SseParser {
  private buffer = '';

  push(chunk: string): unknown[] {
    this.buffer += chunk.replace(/\r\n/g, '\n');
    const out: unknown[] = [];
    let end: number;
    while ((end = this.buffer.indexOf('\n\n')) >= 0) {
      const frame = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      const data = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, ''))
        .join('\n');
      if (!data) continue; // comments / keep-alives
      try {
        out.push(JSON.parse(data));
      } catch {
        // ignore frames that are not JSON
      }
    }
    return out;
  }
}
