import type { LearningGuide, LearningSessionMetadata } from './learning-session.ts';

export type ShareDraft = {
  source: 'guide' | 'followup' | 'assistant';
  topic: string;
  x: string;
  linkedin: string;
  hashtags: string[];
  repository: string;
  commitSha: string;
};

const HYPE_WORDS = /\b(game[- ]?changing|revolutionary|delve|unlock|seamless|robust|cutting[- ]edge|leverage|supercharge)\b/gi;

function plain(value: string): string {
  return value
    .replace(/[`*_>#\[\]()]/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .replace(HYPE_WORDS, '')
    .trim();
}

function sentence(value: string, fallback: string, max = 180): string {
  const text = plain(value) || fallback;
  const first = text.match(/.*?[.!?](\s|$)/)?.[0]?.trim() || text;
  return first.length <= max ? first : `${first.slice(0, max - 1).trim()}…`;
}

function fitX(value: string): string {
  const text = plain(value);
  return text.length <= 240 ? text : `${text.slice(0, 239).trim()}…`;
}

function hashtags(repository: string): string[] {
  const repo = repository.split('/').at(-1)?.replace(/[^A-Za-z0-9]/g, '') || 'Code';
  return ['#TIL', '#CodeReading', `#${repo}`].slice(0, 3);
}

export function createGuideShareDraft(metadata: LearningSessionMetadata, guide: LearningGuide): ShareDraft {
  const topic = sentence(guide.sections[0]?.summary || guide.overview, `How ${metadata.repository} is structured`, 100);
  const concrete = sentence(guide.safeChanges[0] || guide.architecture[0] || guide.requestFlows[0] || guide.overview, 'Small code-reading notes are easier to reuse when they stay tied to file evidence.', 150);
  const x = fitX(`TIL from reading ${metadata.repository}: ${topic} The useful bit: ${concrete}`);
  const linkedin = [
    `I spent time reading ${metadata.repository} and saved one useful takeaway: ${topic}`,
    `The practical lesson: ${concrete}`,
    `I like this kind of code reading because the note stays tied to a pinned commit (${metadata.commitSha.slice(0, 12)}) instead of becoming vague advice.`,
  ].join('\n\n');
  return { source: 'guide', topic, x, linkedin, hashtags: hashtags(metadata.repository), repository: metadata.repository, commitSha: metadata.commitSha };
}

export function createFollowupShareDraft(metadata: LearningSessionMetadata, question: string, answer: string): ShareDraft {
  const topic = sentence(question, `A detail in ${metadata.repository}`, 100);
  const takeaway = sentence(answer, 'The useful part was connecting a small implementation detail back to the repo design.', 155);
  const x = fitX(`TIL while reading ${metadata.repository}: ${takeaway}`);
  const linkedin = [
    `A small thing I learned while reading ${metadata.repository}: ${topic}`,
    takeaway,
    `Saving these notes with the session makes it easier to turn code reading into follow-up work later.`,
  ].join('\n\n');
  return { source: 'followup', topic, x, linkedin, hashtags: hashtags(metadata.repository), repository: metadata.repository, commitSha: metadata.commitSha };
}

export function createAssistantShareDraft(input: { prompt: string; answer: string; route: string; conversationId: string }): ShareDraft {
  const topic = sentence(input.prompt, `A ${input.route.replace(/_/g, ' ')} answer`, 100);
  const takeaway = sentence(input.answer, 'A useful answer worth saving for later.', 155);
  const label = input.route === 'web_research' ? 'from a web research turn' : 'from an assistant chat';
  const x = fitX(`TIL ${label}: ${takeaway}`);
  const linkedin = [
    `A small thing I learned ${label}: ${topic}`,
    takeaway,
    `I saved the answer in my review archive so it is easy to revisit instead of disappearing into chat history.`,
  ].join('\n\n');
  return {
    source: 'assistant',
    topic,
    x,
    linkedin,
    hashtags: ['#TIL', input.route === 'web_research' ? '#WebResearch' : '#Learning'],
    repository: input.route.replace(/_/g, ' '),
    commitSha: input.conversationId,
  };
}
