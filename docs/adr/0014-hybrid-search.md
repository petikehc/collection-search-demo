# 14. Hybrid search: keyword and vector matches ranked together, with L2 normalisation

- Status: accepted
- Date: 2026-11-12

## Context

Keyword search only finds objects that share words with the query. That works for "woomera" or an accession number, and fails for:

- **questions:** "how did people communicate over long distances before telephones?" matched nothing, though the collection holds telegrams and a telegraph cable;
- **misspellings:** "bommerang" matched nothing;
- **different vocabulary** from the Museum's records.

On the eval set's 20 answerable questions, keyword search found 27% of the expected objects in its first ten results.

Ask already retrieves by meaning, through the Knowledge Base (ADR 6), but only to write an answer. The search results themselves needed the same reach, without losing what keyword search is good at.

## Options considered

1. **Vector search only.** Finds related objects for any wording, but is worse at exact terms: embeddings match rare words by their spelling. On 12 keyword queries, only 75% of the first ten results contained the words at all.
2. **Keyword first, vector as a fallback** when keyword search finds nothing (or too little). Never worse than today for keyword queries. But a question that happens to match a few words gets only those, and the two lists are never ranked against each other.
3. **Hybrid search in OpenSearch:** one request runs the keyword query and a k-NN query, and a search pipeline normalises and combines the scores into one ranking.
4. **Hybrid, combined in our own code** (two requests, merged in the Lambda). Full control, but it rebuilds what the engine already does.

## Decision

**Option 3**, with settings chosen by measurement rather than defaults.

- **Index:** each object gets a 1,024-dimension vector (`knn_vector`, faiss HNSW, inner product) from Titan Text Embeddings V2 in Sydney (ADR 12).
  - The text embedded is the object's own title, classification and descriptions.
  - The collection-level statement is left out: every object in a collection shares it, so it would pull unrelated objects together.
- **Ingest:** embeds every object, eight at a time, with retries. About 45 seconds and 3 US cents for 3,757 objects. If an object can't be embedded, the run fails before the alias moves.
- **Query:** the search Lambda embeds the query, then sends a `hybrid` query: the existing keyword query plus k-NN for the 30 nearest objects.
  - The analyser's synonyms are added to the text before embedding, as Ask does (ADR 8): the embedding model doesn't know a woomera is a spear-thrower.
  - The same filters go inside the k-NN clause, so a filtered search still gets 30 neighbours that match the filters.
  - Recent query vectors are cached per Lambda container, because paging and filtering repeat the same words.
  - **If embedding fails, the search runs on keywords alone.**
- **Search pipeline** (`objects-hybrid`, created by a custom resource, set as the index's default): **L2 normalisation, then a weighted mean: keyword 0.6, vector 0.4.**
- **API:** `mode=hybrid` is the default when there's a query; `mode=keyword` matches words only. The response reports `keywordTotal`, counted with a filter aggregation: how many results contain the words, as opposed to related objects.
- **Paging:** the best 200 matches can be paged through. The ranking depth is constant across pages, so page 2 continues page 1's ranking.

## What we found

- **The textbook settings made keyword search worse.** With min-max normalisation and equal weights, "woomera" ranked "Woollahra Point" level with the collection's spear-throwers. Min-max gives each list's best hit a score of 1, however weak that hit is. L2 keeps the shape of the keyword scores, so a strong exact match stays ahead.

  A spike on a scratch index compared the options (20 questions, 12 keyword queries):

  | Strategy                             | Question recall@10 | Keyword precision@10 |
  | ------------------------------------ | ------------------ | -------------------- |
  | Keyword only                         | 27%                | 100%                 |
  | Vector only                          | 80%                | 75%                  |
  | Hybrid, min-max, 50/50               | 81%                | 86%                  |
  | Hybrid, reciprocal rank fusion       | 80%                | 87%                  |
  | Hybrid, L2, 60/40                    | 80%                | 98%                  |
  | **Hybrid, L2, 60/40, with synonyms** | **83%**            | **97%**              |

- **k-NN's `k` is per segment.** The deployed index returned about 240 neighbours where 30 were asked for, because a freshly loaded index had eight segments. That also changed the normalisation, and so the ranking. The reindex now merges the new index to one segment before the alias moves. The index is never written to after loading, so one segment is also the fastest shape to search.
- **Re-ingesting changed the data.** Adding embeddings meant a new index, and the first attempt refetched from the Museum. The sample is drawn from pages spread across the Museum's results, and those had moved: only 10% of the previous day's objects came back, and 23 of the eval set's 252 expected objects. `pnpm ingest --from <index>` now rebuilds from an existing index without fetching. A mapping change is a reindex, not a new harvest.
- **Query logging had to change.** The search Lambda logged the query text when nothing matched, to find missing synonyms. Questions now go in the same box and may hold personal details, so only queries of three words or fewer are logged in full.

## How it was verified

`pnpm eval:search` runs both modes through the deployed API ([results](../../evals/results/2026-11-12-search-hybrid.md)):

| Mode    | Question recall@10 | Question hit@10 | Keyword precision@10 |
| ------- | ------------------ | --------------- | -------------------- |
| Keyword | 27%                | 35%             | 100%                 |
| Hybrid  | 85%                | 100%            | at least 95%         |

Also checked live: "bommerang" returns boomerangs; "woomera" returns 37 results, 15 of them matching the word and ranked first; a filtered hybrid search; the paging limit; and that the search Lambda's read-only OpenSearch role is enough. Hybrid adds about 110 ms to a search.

## Update: questions ranked by meaning (12 November 2026)

The new results page showed a problem the eval had missed. For "What did people use to start fires?", the first five results were a bark painting, a saddle and a coin. They match enough of the question's common words ("what", "did", "people", "use", "start") to count as keyword matches, and with keyword-leaning weights every keyword match outranks every meaning-based one. The three right objects were 6th, 8th and 9th, so recall@10 still scored the question 100%.

A second measure that counts order (the reciprocal rank of the first right object, MRR) showed the trade-off on the live index:

| Weights (keyword/vector) | Question MRR | Question hit@3 | Keyword precision@10 |
| ------------------------ | ------------ | -------------- | -------------------- |
| 0.6/0.4                  | 0.76         | 75%            | 95%                  |
| 0.2/0.8                  | 0.88         | 90%            | 89%                  |
| 0.1/0.9                  | 0.92         | 90%            | 88%                  |

No single weighting is best for both, so there are now two pipelines: `objects-hybrid` (0.6/0.4) for keyword-style searches, and `objects-hybrid-question` (0.2/0.8) for searches that look like questions, using the same question detection as the web site (a question mark, a question word first, or six words or more). 0.2/0.8 rather than 0.1/0.9 keeps some weight on exact words for questions that name something, given only 20 questions to judge by. `pnpm eval:search` now reports MRR and hit@3.

## Update: words matched across fields (12 November 2026)

"Churches in Victoria?" ranked a Sydney church 2nd and a Victorian church's records 14th. The keyword query was `best_fields`, whose "most of the words" rule applies to each field separately. So an object with "Church" in its title and "Victoria" in its place didn't count as a keyword match, while one whose description mentions "Victoria Park" did. The query is now `cross_fields`, which matches the text fields as one. Every text field uses the same analyser, so they blend into one group; the accession number (a keyword field) stays its own group, and number lookups and synonyms work as before.

On the same index (`evals/results/2026-11-12-search-cross-fields.md`): the Victorian churches went from 1st, 3rd and 14th to 1st, 2nd and 4th. Keyword matches for "churches in victoria" went from 9 to 14, and question hit@3 from 80% to 85%. MRR moved from 0.72 to 0.69 and keyword precision from 99% to 94%. Checked by hand: the "postcard" drop is the measure's 50-result limit (all ten results are postcards). For "polar medal", the husky's dog collar went from 2nd to 10th, behind other medals. Accepted for the gain on searches that name a place.

## Consequences

- **Easier:** questions and misspellings find objects. The result list and the AI answer now draw on the same kind of retrieval.
- **Harder:**
  - Every search with words costs one small embedding call, and depends on Bedrock being available (with the keyword fallback when it isn't).
  - The first hybrid search after a new index took about 5 seconds, while the vector index loaded into memory.
  - Deep paging stops at 200 results in hybrid mode.
  - Facet counts include the related objects, not only the keyword matches.
- **Known limits:**
  - The settings were tuned on a small eval set (20 questions, 15 keyword queries), so they are a starting point, not a proof.
  - Embeddings still miss what words mean in context: "before cars" returns cars.
  - A fresh `pnpm ingest` still draws a different sample when the Museum's data has changed. The eval set's and the walkthrough's objects are pinned: every ingest fetches any the sample missed, one request each, because the API can't fetch a list of IDs at once (pinning the whole sample that way would take over an hour).
- **Revisit:** warming the vector index after each ingest; a larger eval set; weights per query type, if exact lookups and questions ever need different settings.
