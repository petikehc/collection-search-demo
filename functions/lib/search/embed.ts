import { type BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import type { CollectionObject } from '../nma/normalise.js';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL_ID } from './constants.js';

export type Embed = (text: string) => Promise<number[]>;

/** Titan's input limit is about 8,000 tokens; records are far shorter, this is a backstop. */
const MAX_CHARS = 8000;

/**
 * What an object "means" for vector search: its own title, classification and descriptions.
 * The collection-level statement is left out: it's shared by every object in a collection, so
 * it would pull unrelated objects together.
 */
export function embeddingText(obj: CollectionObject): string {
  return [
    obj.title,
    obj.types.join(', '),
    obj.places.join('; '),
    obj.materials.join(', '),
    obj.dateLabel,
    obj.physicalDescription,
    obj.contentDescription,
    obj.description,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Embeds text with Titan V2. Vectors are unit length, so inner product equals cosine. */
export function createEmbedder(client: BedrockRuntimeClient): Embed {
  return async (text) => {
    const res = await client.send(
      new InvokeModelCommand({
        modelId: EMBEDDING_MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          inputText: text.slice(0, MAX_CHARS),
          dimensions: EMBEDDING_DIMENSIONS,
          normalize: true,
        }),
      }),
    );
    return (JSON.parse(new TextDecoder().decode(res.body)) as { embedding: number[] }).embedding;
  };
}

/**
 * Embeds many texts, a few at a time (Titan takes one text per call), in input order.
 * A failed call is retried with exponential backoff; if it keeps failing, the whole run fails
 * rather than indexing objects that vector search can't find.
 */
export async function embedAll(
  texts: string[],
  embed: Embed,
  options: { concurrency?: number; retries?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<number[][]> {
  const { concurrency = 8, retries = 5 } = options;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const vectors = new Array<number[]>(texts.length);
  let next = 0;

  const worker = async () => {
    while (next < texts.length) {
      const i = next++;
      for (let attempt = 0; ; attempt++) {
        try {
          vectors[i] = await embed(texts[i] ?? '');
          break;
        } catch (err) {
          if (attempt >= retries) throw err;
          await sleep(250 * 2 ** attempt);
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, texts.length) }, worker));
  return vectors;
}
