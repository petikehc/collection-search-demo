# 4. Versioned indices behind an alias, with search-time synonyms after stemming

- Status: accepted
- Date: 2026-11-10

## Context

Analysers, tokenizers and most index settings are fixed when an OpenSearch index is created: the tokens are computed at index time and stored. Changing how a field is analysed (a new stemmer, new synonyms) therefore means building a new index. Search must keep working while that happens, and a bad change must be easy to undo.

The collection's vocabulary also needs help that a stemmer can't give: "kylie" is a kind of boomerang, "woomera" is a spear-thrower, "photo" is short for "photograph".

## Options considered

**Rolling out index changes:**

1. **Update the live index in place.** Not possible for analysers without closing the index (downtime), and existing documents keep their old tokens.
2. **Reindex under the same name** (delete, then recreate). Search breaks or returns partial results while it reloads.
3. **Versioned indices behind an alias.** Each ingest creates `objects-<timestamp>`, loads and verifies it, then moves the `objects` alias to it in one atomic `_aliases` request. Clients only ever query the alias.

**Where synonyms live:**

1. **Index-time synonyms.** Expansions are baked into the stored tokens, so every change needs a full reindex. Multi-word synonyms are unreliable at index time.
2. **Search-time `synonym_graph`, inline in the index settings.** Correct for multi-word synonyms. Changing the list still needs a new index here, because the analyser settings belong to the index.
3. **Search-time synonyms from an OpenSearch Service package** (a synonym file in S3, associated with the domain, analyser marked `updateable`). The list can change without a reindex. It adds an S3 object, package versioning and a domain association to manage.

**Stemming:**

1. **porter** merges more forms ("carve", "carved", "carving"), but also unrelated words: "university"/"universe", "organic"/"organ", and "painting" (an artwork) with "paint" (a material).
2. **kstem** checks a dictionary, so it is more precise, but leaves gaps ("carve" ≠ "carving").

## Decision

- **Versioned indices behind the `objects` alias,** swapped atomically after a document-count check. One previous index is kept for rollback, and older ones are pruned. A failure before the swap deletes the new index; after the swap the new index is never deleted.
- **Search-time `synonym_graph`, inline,** in the `collection_search` analyser only. The ingest rebuilds the index on every run anyway, so a package's in-place updates wouldn't save anything yet.
- **The synonym filter runs after the stemmer.** Synonym rules are processed by the filters before them, so rules written on base words ("photo, photograph") also match plurals ("photos"). With the filter before the stemmer, `_analyze` showed "photos" missing the rule.
- **kstem, not porter,** for precision. Known gaps are closed with explicit synonyms (e.g. "carve, carving").
- **Verified on the live domain:** `pnpm check:analysis` creates a throwaway index and checks the tokens for each case. A reindex during 317 searches produced 0 errors and 0 empty results.

## Consequences

- Clients (the search Lambda, and later the Knowledge Base ingest) never need to know an index name.
- Rollback is a one-request alias change back to the previous index.
- Changing synonyms means running the ingest, which takes under a minute at this size. At a size where a full reindex is slow, move the synonyms to an OpenSearch Service package with an `updateable` analyser.
- During a reindex, storage briefly holds two copies of the index (plus the kept previous one), so size the disk for three times the index.
