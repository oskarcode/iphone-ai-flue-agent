import { describe, expect, it } from 'vitest';
import { parseJevRoute } from '../src/tools/jev-router.ts';

describe('Jev routing', () => {
  it('reads a nested Jev response', () => {
    expect(parseJevRoute({ result: { result: { model: 'typesafe/jev', answers: { route: { choice: 'read_url' } } } } })).toBe('read_url');
  });

  it('rejects an unknown route', () => {
    expect(() => parseJevRoute({ result: { answers: { route: { choice: 'unknown' } } } })).toThrow('invalid route');
  });
});
