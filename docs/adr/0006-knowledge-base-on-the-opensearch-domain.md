# 6. Knowledge Base vectors on the existing OpenSearch domain, one chunk per object

- Status: accepted
- Date: 2026-11-11

## Context

"Ask the collection" uses retrieval-augmented generation (RAG) through an Amazon Bedrock Knowledge Base. The KB needs a vector store, and its source documents need a chunking strategy. ADR 0002 chose to try the existing managed OpenSearch domain as the vector store, with Amazon S3 Vectors as a fallback if the integration couldn't be made to work within a two-hour timebox.

Each collection object is short: a title, a few facts and usually one or two descriptive paragraphs, typically a few hundred tokens.

## Options considered

**Vector store:**

1. **The existing managed domain** (`OPENSEARCH_MANAGED_CLUSTER`). No extra hourly cost, keyword and vector search on the same service, and a path to hybrid search. We must create the k-NN index and grant access ourselves. The domain must have a public endpoint (ADR 0003).
2. **S3 Vectors.** Almost free and simple to wire up, but a separate store from search, with no hybrid search.
3. **OpenSearch Serverless.** Rejected on cost in ADR 0002.

**Chunking:**

1. **Fixed-size chunks** (e.g. 300 tokens with overlap). Suits long documents. Here it would split some objects into fragments that lose their title and facts, and one object could appear several times in the results.
2. **Semantic or hierarchical chunking.** Built for long, structured documents. More cost and complexity for no gain on short records.
3. **No chunking.** Each file is one chunk, so each retrieved result is one whole object with its title, facts and description together.

## Decision

- **The vector store is the existing OpenSearch domain.** The `kb-objects` index is created by a custom resource before the KB:
  - a `knn_vector` field of 1,024 dimensions;
  - faiss, HNSW (m 24, ef_construction 128), l2 distance;
  - `AMAZON_BEDROCK_TEXT_CHUNK` and `AMAZON_BEDROCK_METADATA` fields.
- **Least privilege at every layer:**
  - the KB service role can be assumed only by Bedrock for a KB in this account (`aws:SourceAccount`, `aws:SourceArn`);
  - it may invoke only Titan Text Embeddings V2, read only `kb/*` in the docs bucket, call only `kb-objects` paths, and call `es:DescribeDomain`;
  - inside OpenSearch, `kb_access` allows only document read and write plus reading the index and its mapping.
- **Embeddings:** Titan Text Embeddings V2, 1,024 dimensions, invoked in ap-southeast-2.
- **No chunking:** one object per file, one chunk per object, so citations map one-to-one to collection records. Each file has a `.metadata.json` sidecar (`objectId`, `title`, `sourceUrl`, `type`, `hasImage`, `yearStart`) that Bedrock returns with each result.
- **Document bodies contain no timestamps,** and the ingest uploads only files whose MD5 differs from the S3 ETag. Unchanged objects aren't re-uploaded or re-embedded.

## Outcome

The integration worked first time, about one hour into the two-hour timebox, so the S3 Vectors fallback was not needed:

- **The deploy succeeded.** The KB was created and Bedrock validated the domain, the index mapping and its access.
- **The first sync embedded 3,757 documents with 0 failures in about 5 minutes,** and the index holds 3,757 vectors.
- **Retrieval for natural-language questions finds relevant objects that keyword search misses.** For example, "how did people communicate over long distances before telephones?" returns a telegraph cable and a telegram, while keyword search returns 0 results. Keyword search still does better on exact terms.

## Consequences

- No extra hourly cost: the vectors (about 30 MB) share the existing domain.
- The domain's sizing now covers k-NN memory too. That's small at this scale, and the JVM memory pressure alarm (step 11) watches it.
- Each run of `pnpm ingest` must be followed by `pnpm kb:sync` (or a scheduled sync) to update the vectors.
- Hybrid search (keyword plus vector in one OpenSearch query) is possible later on the same domain.
- If objects ever grow long (e.g. full narratives), switch that data source to fixed-size or hierarchical chunking. Chunking is set per data source.
