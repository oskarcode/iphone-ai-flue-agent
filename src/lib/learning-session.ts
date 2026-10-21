// This module owns the learning-session record shared by HTTP routes and the durable learning agent.
export const LEARNING_SESSION_TTL_SECONDS = 0;
export const LEARNING_SESSION_KEY_PREFIX = 'learning-session:';

// Status is intentionally small because the browser only needs queued, ready, or terminal failure.
export type LearningSessionStatus = 'queued' | 'ready' | 'failed';

// Metadata identifies the immutable repository snapshot and the session's current lifecycle state.
export type LearningSessionMetadata = {
  id: string;
  status: LearningSessionStatus;
  repository: string;
  repositoryUrl: string;
  defaultBranch: string;
  commitSha: string;
  privateRepository?: boolean;
  createdAt: string;
  expiresAt: string;
  error?: string;
};

// Each section keeps teaching content next to the repository paths that support its claims.
export type LearningGuideSection = {
  id: string;
  title: string;
  summary: string;
  content: string;
  evidence: string[];
};

// The validated guide shape is rendered by fixed application HTML rather than model-authored markup.
export type LearningGuide = {
  title: string;
  subtitle: string;
  overview: string;
  quickStart: string[];
  architecture: string[];
  requestFlows: string[];
  sections: LearningGuideSection[];
  safeChanges: string[];
  quiz: Array<{ question: string; answer: string }>;
};

// Keeping metadata and guide together makes the queued -> ready transition one atomic KV write.
type LearningSessionRecord = {
  metadata: LearningSessionMetadata;
  guide?: LearningGuide;
};

/**
 * Input:
 * - A learning-session UUID.
 *
 * Output:
 * - The KV key containing metadata and, once ready, the guide.
 *
 * What this function does:
 * - Keeps the session record naming convention in one place.
 */
export function learningSessionRecordKey(id: string): string {
  return `${LEARNING_SESSION_KEY_PREFIX}${id}:record`;
}

/**
 * Input:
 * - A learning-session UUID.
 *
 * Output:
 * - The KV key containing Flue's submission receipt.
 *
 * What this function does:
 * - Separates asynchronous admission data from guide lifecycle state to avoid lost updates.
 */
export function learningSessionSubmissionKey(id: string): string {
  return `${LEARNING_SESSION_KEY_PREFIX}${id}:submission`;
}

/**
 * Input:
 * - The session's ISO expiration timestamp.
 *
 * Output:
 * - An absolute Unix timestamp accepted by Workers KV.
 *
 * What this function does:
 * - Gives all related keys the same one-hour expiry boundary.
 */
export function learningSessionExpiration(expiresAt: string): number {
  return Math.floor(new Date(expiresAt).getTime() / 1000);
}

/**
 * Input:
 * - A KV namespace and learning-session UUID.
 *
 * Output:
 * - Session metadata, or null after expiry/deletion.
 *
 * What this function does:
 * - Reads only the metadata portion of the atomic session record.
 */
export async function getLearningSession(kv: KVNamespace, id: string): Promise<LearningSessionMetadata | null> {
  const record = await kv.get<LearningSessionRecord>(learningSessionRecordKey(id), 'json');
  return record?.metadata ?? null;
}

/**
 * Input:
 * - A KV namespace and queued or failed session metadata.
 *
 * Output:
 * - No value; the write completes before resolution.
 *
 * What this function does:
 * - Creates or updates metadata while preserving an already-published guide.
 */
export async function putLearningSession(kv: KVNamespace, metadata: LearningSessionMetadata): Promise<void> {
  const existing = await kv.get<LearningSessionRecord>(learningSessionRecordKey(metadata.id), 'json');
  await kv.put(learningSessionRecordKey(metadata.id), JSON.stringify({ metadata, guide: existing?.guide }));
}

/**
 * Input:
 * - A KV namespace, session UUID, submission ID, and expiration time.
 *
 * Output:
 * - No value; the receipt write completes before resolution.
 *
 * What this function does:
 * - Records the Flue submission without rewriting metadata that the agent may already have advanced.
 */
export async function putLearningSubmission(
  kv: KVNamespace,
  id: string,
  submissionId: string,
  expiresAt: string,
): Promise<void> {
  await kv.put(learningSessionSubmissionKey(id), submissionId);
}

/**
 * Input:
 * - A KV namespace and learning-session UUID.
 *
 * Output:
 * - Flue's submission ID, or null while admission is incomplete/expired.
 *
 * What this function does:
 * - Supplies the receipt needed by the SSE completion watcher.
 */
export function getLearningSubmission(kv: KVNamespace, id: string): Promise<string | null> {
  return kv.get(learningSessionSubmissionKey(id));
}

/**
 * Input:
 * - A KV namespace and learning-session UUID.
 *
 * Output:
 * - The published guide, or null while queued/failed/expired.
 *
 * What this function does:
 * - Reads the guide from the same record that declares the session ready.
 */
export async function getLearningGuide(kv: KVNamespace, id: string): Promise<LearningGuide | null> {
  const record = await kv.get<LearningSessionRecord>(learningSessionRecordKey(id), 'json');
  return record?.metadata.status === 'ready' ? record.guide ?? null : null;
}

/**
 * Input:
 * - A KV namespace, current metadata, and validated learning guide.
 *
 * Output:
 * - No value; publication completes before resolution.
 *
 * What this function does:
 * - Atomically stores the guide and changes its metadata status to ready.
 */
export async function putLearningGuide(
  kv: KVNamespace,
  metadata: LearningSessionMetadata,
  guide: LearningGuide,
): Promise<void> {
  const readyMetadata = { ...metadata, status: 'ready' as const, error: undefined };
  await kv.put(learningSessionRecordKey(metadata.id), JSON.stringify({ metadata: readyMetadata, guide }));
}

/**
 * Input:
 * - A KV namespace and learning-session UUID.
 *
 * Output:
 * - No value; both temporary keys are removed before resolution.
 *
 * What this function does:
 * - Deletes the published/queued session record and Flue submission receipt together.
 */
export async function deleteLearningSession(kv: KVNamespace, id: string): Promise<void> {
  await Promise.all([
    kv.delete(learningSessionRecordKey(id)),
    kv.delete(learningSessionSubmissionKey(id)),
  ]);
}
