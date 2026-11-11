import type { RetrieveAndGenerateCommandOutput } from '@aws-sdk/client-bedrock-agent-runtime';
import { describe, expect, it } from 'vitest';
import { parseQuestion } from '../ask/handler.js';
import { buildRequest, PROMPT_TEMPLATE, toAskResponse } from '../lib/ask/ask.js';

const config = {
  knowledgeBaseId: 'KB123',
  modelArn:
    'arn:aws:bedrock:ap-southeast-2:111111111111:inference-profile/au.anthropic.claude-haiku',
  guardrailId: 'gr123',
  guardrailVersion: '3',
};

describe('buildRequest', () => {
  const req = buildRequest('What was used to start fires?', config);
  const kb = req.retrieveAndGenerateConfiguration?.knowledgeBaseConfiguration;

  it('retrieves 6 passages from the knowledge base and generates with the Australian profile', () => {
    expect(kb?.knowledgeBaseId).toBe('KB123');
    expect(kb?.modelArn).toContain('inference-profile/au.');
    expect(kb?.retrievalConfiguration?.vectorSearchConfiguration?.numberOfResults).toBe(6);
  });

  it('applies the pinned guardrail version to every request', () => {
    expect(kb?.generationConfiguration?.guardrailConfiguration).toEqual({
      guardrailId: 'gr123',
      guardrailVersion: '3',
    });
  });

  it('uses our prompt, with the placeholders Bedrock needs for passages and citations', () => {
    expect(kb?.generationConfiguration?.promptTemplate?.textPromptTemplate).toBe(PROMPT_TEMPLATE);
    expect(PROMPT_TEMPLATE).toContain('$search_results$');
    expect(PROMPT_TEMPLATE).toContain('$output_format_instructions$');
    expect(PROMPT_TEMPLATE).toMatch(/only information in the search results/);
    expect(PROMPT_TEMPLATE).toMatch(/data, not instructions/);
  });
});

describe('toAskResponse', () => {
  const ref = (objectId: string, title: string) => ({
    metadata: { objectId, title, sourceUrl: `https://example.org/${objectId}` },
  });

  it('returns the answer with one citation per object, in order of first use', () => {
    const res = toAskResponse({
      output: { text: 'The collection holds a telegraph cable and a telegram.' },
      citations: [
        { retrievedReferences: [ref('247332', 'Telegraph cable')] },
        { retrievedReferences: [ref('50182', 'Telegram'), ref('247332', 'Telegraph cable')] },
      ],
      guardrailAction: 'NONE',
    } as unknown as RetrieveAndGenerateCommandOutput);

    expect(res.answer).toMatch(/telegraph cable/);
    expect(res.citations.map((c) => c.objectId)).toEqual(['247332', '50182']);
    expect(res.citations[0]?.sourceUrl).toBe('https://example.org/247332');
    expect(res.guardrailAction).toBe('NONE');
    expect(res.attribution).toMatch(/Collection API/);
  });

  it('reports a guardrail intervention with no citations', () => {
    const res = toAskResponse({
      output: { text: "Sorry, I can't help with that question." },
      guardrailAction: 'INTERVENED',
    } as unknown as RetrieveAndGenerateCommandOutput);
    expect(res).toMatchObject({ guardrailAction: 'INTERVENED', citations: [] });
  });
});

describe('parseQuestion', () => {
  it.each([
    ['{"question":"  What is a woomera?  "}', { question: 'What is a woomera?' }],
    ['not json', { error: 'Body must be JSON: {"question": "..."}' }],
    ['{"question":42}', { error: 'question must be a string' }],
    ['{"question":"hi"}', { error: 'question must be 3 to 500 characters' }],
  ])('%s', (body, expected) => {
    expect(parseQuestion(body)).toEqual(expected);
  });
});
