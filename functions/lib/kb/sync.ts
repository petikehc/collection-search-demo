import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { KB_PREFIX, type KbFile, planSync } from './documents.js';

export interface SyncResult {
  put: number;
  deleted: number;
  unchanged: number;
}

/**
 * Makes the bucket's kb/ prefix match `files`: uploads new or changed files, deletes files for
 * objects no longer in the sample (so the Knowledge Base drops their vectors on the next sync).
 */
export async function syncKbFiles(
  s3: S3Client,
  bucket: string,
  files: KbFile[],
): Promise<SyncResult> {
  const existing = new Map<string, string>();
  let ContinuationToken: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: KB_PREFIX, ContinuationToken }),
    );
    for (const o of page.Contents ?? []) {
      if (o.Key && o.ETag) existing.set(o.Key, o.ETag.replaceAll('"', ''));
    }
    ContinuationToken = page.NextContinuationToken;
  } while (ContinuationToken);

  const plan = planSync(existing, files);

  // Upload with limited parallelism: fast, without opening thousands of sockets at once.
  const queue = [...plan.put];
  const worker = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: f.key,
          Body: f.body,
          ContentType: f.key.endsWith('.json') ? 'application/json' : 'text/markdown',
        }),
      );
    }
  };
  await Promise.all(Array.from({ length: 16 }, worker));

  for (let i = 0; i < plan.remove.length; i += 1000) {
    const keys = plan.remove.slice(i, i + 1000).map((Key) => ({ Key }));
    await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys } }));
  }

  return { put: plan.put.length, deleted: plan.remove.length, unchanged: plan.unchanged };
}
