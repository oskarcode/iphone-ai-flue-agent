// These tests pin Jev response-envelope parsing independently of live model inference.
import { describe, expect, it } from 'vitest';
import { parseJevRoute } from '../src/tools/jev-router.ts';

describe('Jev routing', () => {
  it('reads a nested Jev response', () => {
    expect(parseJevRoute({ result: { result: { model: 'typesafe/jev', answers: { route: { choice: 'web_research' } } } } })).toBe('web_research');
  });

  it('rejects an unknown route', () => {
    expect(() => parseJevRoute({ result: { answers: { route: { choice: 'unknown' } } } })).toThrow('invalid route');
  });

  it('rejects the removed correction route', () => {
    expect(() => parseJevRoute({ result: { answers: { route: { choice: 'correct' } } } })).toThrow('invalid route');
  });

  it.each(['read_url', 'web_search'])('rejects removed split route %s', (route) => {
    expect(() => parseJevRoute({ result: { answers: { route: { choice: route } } } })).toThrow('invalid route');
  });
});
