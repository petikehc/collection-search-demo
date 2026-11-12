# Evaluation set for "Ask the collection"

`questions.jsonl` holds the cases `pnpm eval` runs through the same `askCollection` code as the `/ask` Lambda. Each line is one case:

| Field               | Meaning                                                                                                                                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                | Stable case ID, e.g. `h-woomera`                                                                                                                                                                                            |
| `category`          | `factual`, `hard` (known retrieval traps), `out-of-scope`, `blocked`                                                                                                                                                        |
| `question`          | What a staff member would ask                                                                                                                                                                                               |
| `expect`            | `answer`, `not-covered` (say the collection doesn't cover it, with no facts from memory) or `blocked` (by the guardrail)                                                                                                    |
| `expectedObjectIds` | Collection objects retrieval should find in its top 6 (for `answer` cases)                                                                                                                                                  |
| `broad`             | Broad topic (e.g. convict love tokens): `expectedObjectIds` lists every relevant object in the sample, found with a precise keyword query, so recall@6 is the share of the six retrieved slots filled with relevant objects |
| `mustNotMention`    | Phrases that would show the model answered from memory (e.g. "capital of France is")                                                                                                                                        |

## What is scored

- **Retrieval recall@6:** the share of expected objects in the Knowledge Base's top 6, from a separate `Retrieve` call, because citations only show what the model chose to use.
- **Hit@6:** whether at least one expected object was retrieved.
- **Expectation met:** blocked when expected, not blocked otherwise, and `not-covered` answers that contain none of the `mustNotMention` words. Citations are allowed there, because the model may point to related objects while saying the topic isn't covered.
- **LLM judge:** a stronger model (Claude Sonnet 4.6 through the `au.` inference profile) reads the question, the retrieved passages and the answer, and scores:
  - **faithfulness** (1–5): is every claim supported by the passages?
  - **helpfulness** (1–5): does it answer the question, or correctly say the records don't cover it?

Results are written to `results/<date>-<label>.md` and `.json`, so each change can be compared with the last run.

## Search

`pnpm eval:search` compares keyword and hybrid search through the deployed `GET /search`, and writes `results/<date>-search-<label>.md`. It measures both directions hybrid search can fail in:

- **Questions** (the answerable cases above): recall@10 and hit@10 of each case's `expectedObjectIds`. Keyword search is weak here.
- **Keywords** (`search-keywords.json`): of the first 10 hybrid results, the share that contain the words at all. Keyword search scores 100% by definition, and hybrid must not give that up by ranking look-alikes above exact matches.

## Evaluating the evaluator

The first baseline run scored two faithful answers 2/5. The judge had been given passages cut at 1,500 characters, and called details from later in those records "invented". The judge now sees each passage in full. Broad topics also scored 0% recall while retrieving relevant objects, because only four "expected" IDs were listed, so broad topics now list every relevant object. Check surprising scores against the evidence before changing the system.

## Data

The questions refer to object IDs and titles from the National Museum of Australia's Collection API (https://data.nma.gov.au). Collection metadata is licensed CC BY-NC 4.0 by the National Museum of Australia. The expected IDs were chosen from the sample ingested on 11 November 2026; a later ingest with a different sample may need them updating.
