# 8. Evaluating "Ask the collection": eval set, LLM judge, calibrated grounding, query expansion

- Status: accepted
- Date: 2026-11-11

## Context

Ask's quality depends on retrieval (are the right records found?), generation (does the answer stick to them?) and the guardrail (does it block the right things, and only those?). Testing by hand found problems by accident. We need numbers that can be compared before and after every change: prompt, thresholds, model, retrieval.

## Options considered

1. **Manual spot checks.** Quick, but not repeatable, and no way to compare changes.
2. **Bedrock's managed evaluation jobs** (Knowledge Base and RAG evaluation with an LLM judge). Little code, but less control over cases and scoring. Results live in the console and S3, not next to the code.
3. **Our own eval script**: a versioned case file, the same `askCollection` code as the Lambda, a separate `Retrieve` call for retrieval metrics, and an LLM judge. More code, but transparent and cheap (about $0.50 a run), with results committed to the repository.

## Decision

Option 3: `pnpm eval` over `evals/questions.jsonl`, 25 cases:

- **factual** cases;
- **hard** retrieval traps found while building;
- **out-of-scope** questions;
- questions that **should be blocked**.

It scores:

- **retrieval recall@6** against expected object IDs (for broad topics, every relevant object in the sample);
- **whether the expected behaviour happened** (answered, declined or blocked);
- **faithfulness and helpfulness** (1–5) from a **stronger judge model**, Claude Sonnet 4.6 via the `au.` profile, which reads the question, the retrieved passages and the answer.

### Evaluate the evaluator

The first run scored faithful answers 2/5. The judge had been given passages cut at 1,500 characters and called correct details from later in a record "invented". Broad topics also showed 0% recall while retrieving relevant objects, because only four expected IDs were listed. Both were evaluator bugs. Fixing them moved faithfulness from 4.60 to 4.89 without changing the system.

### Calibrated grounding thresholds

The guardrail's first guesses (grounding 0.7, relevance 0.5) blocked honest answers: QSL cards scored 0.61 on grounding; Broken Hill minerals scored 0.33 on relevance (true, but only one mineral). Real failures scored at most 0.12 (grounding) and 0.02 (relevance). The thresholds are now **0.5 and 0.2**, inside that gap. Faithfulness didn't drop (4.91), and the guardrail suite's ungrounded and irrelevant answers are still blocked by a wide margin.

### Query expansion with the keyword synonyms

Embeddings don't know the collection's vocabulary equivalences: "woomera" retrieved _Woollahra_ and _Wyreema_ (recall 0%), because every record says "spearthrower". Questions are now expanded with the **same synonym list the keyword analyser uses** (`objects-index.json`), so there's one list to maintain.

A first version added the terms as "also known as". The model then stated the equivalence as a fact, which the grounding check rightly couldn't support. The terms are now labelled `[search terms: …]`, and the prompt says they are search aids, not facts.

### Temperature 0

At temperature 0.2, the same question produced grounding scores from 0.23 to 0.89 between runs (sometimes a short, faithful answer, sometimes a long, generalising one). Temperature 0 makes answers and eval results consistent.

## Results

| Run              | Change                                                                                      | Expectations met | Recall@6 | Faithfulness | Helpfulness |
| ---------------- | ------------------------------------------------------------------------------------------- | ---------------- | -------- | ------------ | ----------- |
| baseline         | evaluator fixed                                                                             | 88%              | 88%      | 4.89         | 4.32        |
| calibrated       | grounding/relevance 0.7/0.5 → 0.5/0.2                                                       | 100%*            | 88%      | 4.91         | 4.41        |
| expanded-v2      | query expansion as search terms; temperature 0                                              | 96%              | 93%      | 4.81         | 4.33        |
| examples-not-all | "which objects" answers framed as examples (12 Nov; new sample, so recall isn't comparable) | 96%              | 74%      | 4.77         | 4.50        |

\* At temperature 0.2 the QSL case happened to pass in that run; with temperature 0 its result is stable (see below).

Details per case are in `evals/results/`.

**examples-not-all:** "Churches in Victoria?" got "The collection includes postcards of two churches in Victoria", though the model only sees the six closest records. The prompt now asks for "which objects" answers to be framed as examples from the records found. The first wording also told the model to say the results list may show more. The Guardrail blocked four more answers (80% met), because that sentence isn't in any record and so fails the grounding check. The pointer to the results list is now fixed text under the answer, outside the model's output. Keep the model's answer to what the records say; put everything else in the page.

## Consequences

- **Known limitation:** definition-style answers can be conservatively blocked. "What is a QSL card?" gets "couldn't find a reliable answer" (grounding 0.42), because the records hold QSL cards but no definition. That's safe, but unhelpful. The better fix is a **glossary source** in the Knowledge Base, so definitions become groundable, rather than lowering the threshold for one case.
- **Don't tune to 100% on 25 cases.** That's overfitting: thresholds and prompts should generalise. Grow the eval set as real questions arrive, especially questions staff flag as wrong, and recalibrate from the larger set.
- Each eval run costs about $0.50 and takes about 3 minutes. Run it before changing the prompt, model, thresholds or retrieval, and commit the results.
