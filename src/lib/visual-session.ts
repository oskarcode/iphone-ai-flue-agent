// This module owns temporary visual explainer records rendered by the fixed SVG page.
export const VISUAL_SESSION_TTL_SECONDS = 60 * 60;
export const VISUAL_SESSION_KEY_PREFIX = 'visual-session:';

// The model produces this small schema; browser HTML is always rendered by application code.
export type VisualExplainer = {
  title: string;
  concept: string;
  analogy: string;
  summary: string;
  caption: string;
  parts: VisualExplainerPart[];
  flow: VisualExplainerFlow[];
  codeExample: string;
};

export type VisualExplainerPart = {
  id: string;
  label: string;
  meaning: string;
  role: string;
};

export type VisualExplainerFlow = {
  from: string;
  to: string;
  label: string;
};

export type VisualSessionMetadata = {
  id: string;
  concept: string;
  createdAt: string;
  expiresAt: string;
};

type VisualSessionRecord = {
  metadata: VisualSessionMetadata;
  explainer: VisualExplainer;
};

/** Input: legacy visual ID. Output: KV key.
 * What this function does: preserves the historical storage naming convention.
 */
export function visualSessionRecordKey(id: string): string {
  return `${VISUAL_SESSION_KEY_PREFIX}${id}:record`;
}

/** Input: ISO expiration. Output: epoch seconds for legacy KV.
 * What this function does: converts finite historical expirations; new durable artifacts do not use this helper.
 */
export function visualSessionExpiration(expiresAt: string): number {
  return Math.floor(new Date(expiresAt).getTime() / 1000);
}

/** Input: KV, metadata and normalized visual. Output: historical expiring record.
 * What this function does: retains the old write helper; current Pi visual writes use LearningSession.setVisual.
 */
export async function putVisualSession(
  kv: KVNamespace,
  metadata: VisualSessionMetadata,
  explainer: VisualExplainer,
): Promise<void> {
  await kv.put(visualSessionRecordKey(metadata.id), JSON.stringify({ metadata, explainer }), {
    expiration: visualSessionExpiration(metadata.expiresAt),
  });
}

/** Input: KV and visual ID. Output: old record or null.
 * What this function does: supports old visual URLs while their previously written data still exists.
 */
export async function getVisualSession(
  kv: KVNamespace,
  id: string,
): Promise<VisualSessionRecord | null> {
  return await kv.get<VisualSessionRecord>(visualSessionRecordKey(id), 'json');
}
