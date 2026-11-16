import { cleanFields, MAX_FIELD_CHARS, MAX_FIELDS } from './messages.service.js';

describe('cleanFields', () => {
  it('keeps short text fields and trims them', () => {
    expect(cleanFields({ name: ' Lina ', email: 'lina@example.com', guests: 4, newsletter: true })).toEqual({
      name: 'Lina',
      email: 'lina@example.com',
      guests: '4',
      newsletter: 'true',
    });
  });

  it('drops empty values, nested values and strange keys', () => {
    expect(cleanFields({ name: '', nested: { a: 1 }, list: ['x'], '<script>': 'x', message: 'Hello' })).toEqual({
      message: 'Hello',
    });
  });

  it('cuts long values and long forms', () => {
    const many = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`f${i}`, 'x']));
    expect(Object.keys(cleanFields(many)!)).toHaveLength(MAX_FIELDS);
    expect(cleanFields({ message: 'x'.repeat(5000) })!.message).toHaveLength(MAX_FIELD_CHARS);
  });

  it('refuses anything that is not a form', () => {
    expect(cleanFields(null)).toBeNull();
    expect(cleanFields('text')).toBeNull();
    expect(cleanFields(['a'])).toBeNull();
    expect(cleanFields({})).toBeNull();
    expect(cleanFields({ name: '   ' })).toBeNull();
  });
});
