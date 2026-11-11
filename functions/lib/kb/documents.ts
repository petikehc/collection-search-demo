import { createHash } from 'node:crypto';
import type { CollectionObject } from '../nma/normalise.js';

/** S3 prefix the Knowledge Base data source reads from. */
export const KB_PREFIX = 'kb/';

export interface KbFile {
  key: string;
  body: string;
  /** MD5 hex of the body: equals the S3 ETag of a single-part upload, so unchanged files are skipped. */
  md5: string;
}

/**
 * One object becomes two files: Markdown text the KB embeds, and a `.metadata.json` sidecar
 * that Bedrock stores with the vector and returns with each citation.
 * The body has no timestamps, so re-ingesting unchanged data doesn't change the files.
 */
export function toKbFiles(obj: CollectionObject): KbFile[] {
  const key = `${KB_PREFIX}${obj.id}.md`;
  return [file(key, toMarkdown(obj)), file(`${key}.metadata.json`, toMetadata(obj))];
}

function toMarkdown(obj: CollectionObject): string {
  const facts: [string, string | undefined][] = [
    ['Type', obj.types.join(', ')],
    ['Collection', obj.collection],
    ['Date', obj.dateLabel],
    ['Places', obj.places.join('; ')],
    ['Materials', obj.materials.join(', ')],
    ['Accession number', obj.accessionNumber],
  ];
  const lines = [`# ${obj.title}`, ''];
  for (const [label, value] of facts) if (value) lines.push(`- ${label}: ${value}`);
  for (const text of [obj.physicalDescription, obj.contentDescription, obj.description]) {
    if (text) lines.push('', text);
  }
  if (obj.significanceStatement) {
    lines.push('', '## About the collection this object belongs to', '', obj.significanceStatement);
  }
  lines.push(
    '',
    `Source: National Museum of Australia, ${obj.sourceUrl} (metadata licensed CC BY-NC 4.0)`,
  );
  return `${lines.join('\n')}\n`;
}

function toMetadata(obj: CollectionObject): string {
  const attributes: Record<string, string | number | boolean> = {
    objectId: obj.id,
    title: obj.title,
    sourceUrl: obj.sourceUrl,
    hasImage: obj.images.length > 0,
  };
  if (obj.types[0]) attributes.type = obj.types[0];
  if (obj.yearStart !== undefined) attributes.yearStart = obj.yearStart;
  return JSON.stringify({ metadataAttributes: attributes });
}

function file(key: string, body: string): KbFile {
  return { key, body, md5: createHash('md5').update(body).digest('hex') };
}

/** What to upload and what to delete, given the files already in S3 (key → ETag). */
export function planSync(existing: Map<string, string>, wanted: KbFile[]) {
  const wantedKeys = new Set(wanted.map((f) => f.key));
  return {
    put: wanted.filter((f) => existing.get(f.key) !== f.md5),
    remove: [...existing.keys()].filter((key) => !wantedKeys.has(key)),
    unchanged: wanted.filter((f) => existing.get(f.key) === f.md5).length,
  };
}
