import { describe, expect, it } from 'vitest';
import { renderReviewDetailPage, renderReviewIndexPage } from '../src/review-page.ts';
import {
  getLearningGuide,
  getLearningSession,
  getLearningSessionRecord,
  getLearningSubmission,
  learningSessionRecordKey,
  learningSessionSubmissionKey,
  putLearningGuide,
  putLearningSession,
  putLearningSubmission,
  putRepositoryTutorSession,
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

  it('accepts the exact pasted-text tau repository handoff', () => {
    expect(parseGithubRepositoryRequest('Explain this pasted text in plain English:\n\nhttps://github.com/huggingface/tau.git')).toEqual({ owner: 'huggingface', repo: 'tau', url: 'https://github.com/huggingface/tau' });
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

  it('stores a chat-ready repository without a generated guide or setup receipt', async () => {
    const kv = memoryKv();
    const repository = { owner: 'huggingface', repo: 'tau', fullName: 'huggingface/tau', url: 'https://github.com/huggingface/tau', defaultBranch: 'main', commitSha: 'a'.repeat(40), description: '', files: ['README.md'], private: false, treeTruncated: false };
    await putRepositoryTutorSession(kv, metadata, repository);
    expect(await getLearningSessionRecord(kv, metadata.id)).toEqual({ metadata, repository });
    expect(await getLearningGuide(kv, metadata.id)).toBeNull();
    expect(await getLearningSubmission(kv, metadata.id)).toBeNull();
    await putLearningSession(kv, { ...metadata, status: 'ready' });
    expect((await getLearningSessionRecord(kv, metadata.id))?.repository).toEqual(repository);
  });

  it('recovers only the obsolete missing-guide failure for existing tutors', async () => {
    const kv = memoryKv();
    await putLearningSession(kv, { ...metadata, status: 'failed', error: 'The agent completed without publishing a guide.' });
    expect(await getLearningSession(kv, metadata.id)).toMatchObject({ status: 'ready', error: undefined });
    await putLearningSession(kv, { ...metadata, status: 'failed', error: 'GitHub timed out.' });
    expect(await getLearningSession(kv, metadata.id)).toMatchObject({ status: 'failed', error: 'GitHub timed out.' });
  });

  it('renders learning archive review pages', () => {
    const index = renderReviewIndexPage([{ ...metadata, title: guide.title, subtitle: guide.subtitle, issueCount: 1, lastEventAt: metadata.createdAt }]);
    expect(index).toContain('Saved assistant sessions');
    expect(index).toContain('cloudflare/workers-sdk');
    expect(index).toContain('Oct 3, 2026');
    expect(index).not.toContain('issue');

    const detail = renderReviewDetailPage({
      ...metadata,
      title: guide.title,
      subtitle: guide.subtitle,
      issueCount: 1,
      lastEventAt: metadata.createdAt,
      guide,
      events: [
        { id: 1, sessionId: metadata.id, type: 'followup', createdAt: metadata.createdAt, payload: { question: '<unsafe>', answer: 'Safe answer' } },
        { id: 2, sessionId: metadata.id, type: 'share_draft', createdAt: metadata.createdAt, payload: { source: 'guide', topic: '<draft>', x: 'Short X draft', linkedin: 'Longer LinkedIn draft', hashtags: ['#TIL'], repository: metadata.repository, commitSha: metadata.commitSha } },
      ],
    });
    expect(detail).toContain('Published guide');
    expect(detail).toContain('Runtime walkthrough');
    expect(detail).toContain('Share what you learned');
    expect(detail).toContain('Short X draft');
    expect(detail).toContain('&lt;draft&gt;');
    expect(detail).toContain('&lt;unsafe&gt;');
    expect(detail).not.toContain('<unsafe>');
  });

});
