# 7. A Bedrock Guardrail for "Ask the collection", tuned against over-blocking

- Status: accepted
- Date: 2026-11-11

## Context

"Ask the collection" sends user questions and retrieved collection records to a generation model. We want to:

- refuse some kinds of request: valuations, secret or sacred cultural knowledge, jailbreaks;
- avoid passing contact details to the model;
- block answers that aren't supported by the retrieved records.

This collection is full of material a generic safety setup would flag: weapons, conflict, frontier history and Aboriginal and Torres Strait Islander objects. **Over-blocking would make Ask useless for a large part of the collection,** so it matters as much as under-blocking.

## Options considered

1. **Rules in the prompt only.** Simple, but a prompt can be argued with, and nothing checks the answer.
2. **A Bedrock Guardrail, Standard tier.** Better multilingual and prompt-attack detection, but it requires cross-region inference, so guardrail requests may be processed outside Australia.
3. **A Bedrock Guardrail, Classic tier.** Processed in-region; one configuration applied to both input and output, independent of the prompt.

## Decision

A Classic-tier guardrail, attached to every Ask call, configured as:

| Policy                        | Setting                                                                                  | Why                                                                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Content filters               | hate, insults, sexual, misconduct: medium; **violence: medium on input, low on output**  | Answers about weapons and conflict history must not be blocked                                                                        |
| Prompt attack                 | high, input only                                                                         | Jailbreak and instruction-override attempts                                                                                           |
| Denied topics, **input only** | "Object valuation"; "Secret or sacred cultural knowledge"                                | They refuse certain requests. Answers come from the Museum's published records, so these topics aren't checked on output.             |
| PII                           | email and phone **masked**, card numbers blocked, input and output; **names not masked** | Historical people's names are part of the collection                                                                                  |
| Contextual grounding          | grounding ≥ 0.7, relevance ≥ 0.5                                                         | Blocks answers not supported by the retrieved passages, or not answering the question. To be calibrated with the eval set (ADR 0008). |

- **Pinned versions.** Callers use a **published version**. The version's description carries a hash of the configuration, so any change creates a new version instead of silently editing what's live.
- **A regression suite.** `pnpm guardrail:test` runs 13 fixed cases through `ApplyGuardrail` (the guardrail alone, no model): questions that must pass, requests that must be blocked, masking, and grounded, ungrounded and irrelevant answers.

## How we got here

The first configuration failed on legitimate content, which the regression suite caught:

| Version | Problem found                                                                                                                                                                                                                         | Fix                                                                                                                                    |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1       | "What is a coolamon?" blocked as sacred knowledge. **A plain answer about a boomerang was blocked on output.**                                                                                                                        | Denied topics checked on input only; the sacred-knowledge definition narrowed to secret or restricted knowledge not for public sharing |
| 2       | "Tell me about the boomerangs in the collection" blocked as **valuation**: one example read "How much is this boomerang worth?", so the classifier treated "boomerang" as part of the topic. PII masking didn't fire on input at all. | Topic examples about money, not particular objects; explicit `inputAction`/`outputAction` for PII                                      |
| 3       | 13/13 cases behave as expected                                                                                                                                                                                                        |                                                                                                                                        |

**The lesson:** denied-topic **examples teach the classifier**. Name the behaviour you want refused, never an object from your own domain. And test both directions: requests that must pass, as well as requests that must be blocked.

## Consequences

- Every Ask call costs a little more (about $0.10–0.15 per 1,000 text units per policy). That's cents at this scale.
- **Model invocation logs keep the original, unmasked input,** because guardrail masking doesn't apply to them. The invocation log group therefore needs CloudWatch Logs data protection to mask email addresses and phone numbers (step 9).
- **Guardrail behaviour is probabilistic.** The suite pins down known cases, not all cases. Wider coverage comes from the eval set and from logs of blocked requests.
- Denied topics apply to input only, so a model answer that somehow strays into these topics isn't blocked by them. Grounding (answers must come from the published records) and the content filters still apply to every answer.
