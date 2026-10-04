import { describe, expect, it } from 'vitest';
import { renderLearningGuidePage, renderLearningWaitingPage } from '../src/learning-page.ts';
import {
  getLearningGuide,
  getLearningSession,
  getLearningSubmission,
  learningSessionRecordKey,
  learningSessionSubmissionKey,
  putLearningGuide,
  putLearningSession,
  putLearningSubmission,
  type LearningGuide,
  type LearningSessionMetadata,
} from '../src/lib/learning-session.ts';
import { isReadableRepositoryPath, parseGithubRepositoryRequest } from '../src/tools/github-repository.ts';

const metadata: LearningSessionMetadata = {
  id: '7df74d60-cb1b-4b31-a5ae-f28608efdab5',
  status: 'ready',
  repository: 'cloudflare/workers-sdk',
  repositoryUrl: 'https://github.com/cloudflare/workers-sdk',
  defaultBranch: 'main',
  commitSha: 'a'.repeat(40),
  createdAt: '2026-10-03T12:00:00.000Z',
  expiresAt: '2026-10-03T13:00:00.000Z',
};

const guide: LearningGuide = {
  title: 'Workers SDK learning guide',
  subtitle: 'Understand the repository in runtime order.',
  overview: 'This is an **evidence-based** overview.',
  quickStart: ['Install dependencies', 'Run `npm test`'],
  architecture: ['The application owns routing.', 'Packages isolate responsibilities.'],
  requestFlows: ['request -> router -> handler -> response'],
  sections: [{
    id: 'runtime',
    title: 'Runtime walkthrough',
    summary: 'Follow the request through the source tree.',
    content: 'Read `src/index.ts` first.\n\n- Follow imports\n- Check tests',
    evidence: ['src/index.ts', 'test/index.test.ts'],
  }],
  safeChanges: ['Run tests after changing routing.', 'Keep public contracts stable.'],
  quiz: [
    { question: 'Where does execution start?', answer: 'At the documented entry point.' },
    { question: 'Where are tests?', answer: 'Under the test directory.' },
    { question: 'What pins evidence?', answer: 'The commit SHA.' },
  ],
};

describe('GitHub learning sessions', () => {
  /**
   * Input:
   * - No arguments.
   *
   * Output:
   * - A minimal in-memory KV test double.
   *
   * What this function does:
   * - Supports JSON reads and the put/delete operations used by session helpers.
   */
  function memoryKv(): KVNamespace {
    const values = new Map<string, string>();
    return {
      async get(key: string, type?: string) {
        const value = values.get(key);
        if (value === undefined) return null;
        return type === 'json' ? JSON.parse(value) : value;
      },
      async put(key: string, value: string) { values.set(key, value); },
      async delete(key: string) { values.delete(key); },
    } as unknown as KVNamespace;
  }

  it('extracts and normalizes a public GitHub repository URL', () => {
    expect(parseGithubRepositoryRequest('Help me learn https://github.com/cloudflare/workers-sdk.git please')).toEqual({
      owner: 'cloudflare',
      repo: 'workers-sdk',
      url: 'https://github.com/cloudflare/workers-sdk',
    });
  });

  it('rejects requests without a GitHub repository URL', () => {
    expect(() => parseGithubRepositoryRequest('Teach me this project')).toThrow('public GitHub repository URL');
  });

  it.each([
    'src/index.ts',
    'README.md',
    'packages/example/package.json',
  ])('allows readable repository path %s', (path) => {
    expect(isReadableRepositoryPath(path)).toBe(true);
  });

  it.each([
    '../secret.txt',
    '/absolute.txt',
    'node_modules/library/index.js',
    'dist/bundle.js',
    'image.png',
    'package-lock.json',
  ])('skips unsafe or low-value repository path %s', (path) => {
    expect(isReadableRepositoryPath(path)).toBe(false);
  });

  it('uses separate atomic-record and submission-receipt KV keys', () => {
    expect(learningSessionRecordKey(metadata.id)).toBe(`learning-session:${metadata.id}:record`);
    expect(learningSessionSubmissionKey(metadata.id)).toBe(`learning-session:${metadata.id}:submission`);
  });

  it('publishes ready metadata and its guide in one record', async () => {
    const kv = memoryKv();
    await putLearningSession(kv, { ...metadata, status: 'queued' });
    await putLearningSubmission(kv, metadata.id, 'submission-1', metadata.expiresAt);
    await putLearningGuide(kv, { ...metadata, status: 'queued' }, guide);

    await expect(getLearningSession(kv, metadata.id)).resolves.toMatchObject({ status: 'ready' });
    await expect(getLearningGuide(kv, metadata.id)).resolves.toEqual(guide);
    await expect(getLearningSubmission(kv, metadata.id)).resolves.toBe('submission-1');
  });

  it('renders executable waiting-page JavaScript', () => {
    const html = renderLearningWaitingPage({ ...metadata, status: 'queued' });
    const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
    expect(html).toContain('/events');
    expect(script).toBeTruthy();
    expect(() => new Function(script!)).not.toThrow();
  });

  it('renders terminal failure without a spinner or polling script', () => {
    const html = renderLearningWaitingPage({ ...metadata, status: 'failed', error: 'GitHub timed out.' });
    expect(html).toContain('Guide generation stopped');
    expect(html).toContain('GitHub timed out.');
    expect(html).not.toContain('class="spinner"');
    expect(html).not.toContain('setInterval');
  });

  it('renders a safe guide and executable follow-up chat', () => {
    const html = renderLearningGuidePage(metadata, {
      ...guide,
      overview: '<script>unsafe()</script> **safe**',
    });
    const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
    expect(html).toContain('&lt;script&gt;unsafe()&lt;/script&gt;');
    expect(html).not.toContain('<script>unsafe()</script>');
    expect(html).toContain('/v1/learning-sessions/');
    expect(html).toContain('Runtime walkthrough');
    expect(script).toBeTruthy();
    expect(() => new Function(script!)).not.toThrow();
  });
});
