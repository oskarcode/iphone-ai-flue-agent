import { describe, expect, it } from 'vitest';

import {
  DIRECT_ANSWER_ROUTE_PROMPT,
  EXPLANATION_PROMPT,
  WEB_RESEARCH_PROMPT,
  WEB_RESEARCH_ROUTE_PROMPT,
} from '../src/prompts.ts';

describe('route-specific prompts', () => {
  it('preserves explanation behavior for explicitly requested pasted text', () => {
    expect(EXPLANATION_PROMPT).toContain('Explain the provided text clearly');
    expect(EXPLANATION_PROMPT).toContain('For a sentence or paragraph, paraphrase its overall meaning');
    expect(EXPLANATION_PROMPT).toContain('Prefer TypeScript because the learner is studying TypeScript');
  });

  it('uses visible prompt wording for question-shaped explanation requests', () => {
    expect(DIRECT_ANSWER_ROUTE_PROMPT).toContain('user explicitly asks for pasted text to be explained');
    expect(DIRECT_ANSWER_ROUTE_PROMPT).toContain('pasted text is phrased as a question');
    expect(DIRECT_ANSWER_ROUTE_PROMPT).toContain('not hidden request metadata');
  });

  it('keeps URL content in context and permits grounded follow-up research', () => {
    expect(WEB_RESEARCH_ROUTE_PROMPT).toContain('Call web_research exactly once');
    expect(WEB_RESEARCH_PROMPT).toContain('Keep the page and your explanation as context for later follow-up questions');
  });

  it('combines optional page reading and current search in one tool call', () => {
    expect(WEB_RESEARCH_ROUTE_PROMPT).toContain('Pass the requested URL when one is present');
    expect(WEB_RESEARCH_ROUTE_PROMPT).toContain('Set searchWeb to true');
    expect(WEB_RESEARCH_PROMPT).toContain('Connect findings to earlier page or conversation context');
  });
});
