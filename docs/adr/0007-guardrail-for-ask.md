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

| Policy                        | Setting                                                                                  | Why                                                                                                                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Content filters               | hate, insults, sexual, misconduct: medium; **violence: medium on input, low on output**  | Answers about weapons and conflict history must not be blocked                                                                                                                    |
| Prompt attack                 | high, input only                                                                         | Jailbreak and instruction-override attempts                                                                                                                                       |
| Denied topics, **input only** | "Object valuation": block. "Secret or sacred cultural knowledge": **detect only**        | They refuse certain requests. Answers come from the Museum's published records, so these topics aren't checked on output. See the update below for why the second is detect-only. |
| PII                           | email and phone **masked**, card numbers blocked, input and output; **names not masked** | Historical people's names are part of the collection                                                                                                                              |
| Contextual grounding          | grounding ≥ 0.5, relevance ≥ 0.2                                                         | Blocks answers not supported by the retrieved passages, or not answering the question. Calibrated to 0.5 and 0.2 with the eval set (ADR 0008).                                    |

- **Pinned versions.** Callers use a **published version**. The version's description carries a hash of the configuration, so any change creates a new version instead of silently editing what's live.
- **A regression suite.** `pnpm guardrail:test` runs 14 fixed cases through `ApplyGuardrail` (the guardrail alone, no model): questions that must pass, requests that must be blocked, masking, and grounded, ungrounded and irrelevant answers.

## How we got here

The first configuration failed on legitimate content, which the regression suite caught:

| Version             | Problem found                                                                                                                                                                                                                                                      | Fix                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1                   | "What is a coolamon?" blocked as sacred knowledge. **A plain answer about a boomerang was blocked on output.**                                                                                                                                                     | Denied topics checked on input only; the sacred-knowledge definition narrowed to secret or restricted knowledge not for public sharing |
| 2                   | "Tell me about the boomerangs in the collection" blocked as **valuation**: one example read "How much is this boomerang worth?", so the classifier treated "boomerang" as part of the topic. PII masking didn't fire on input at all.                              | Topic examples about money, not particular objects; explicit `inputAction`/`outputAction` for PII                                      |
| 3                   | 13/13 in the suite, but live through `/ask`, "What is a woomera and what was it used for?" was blocked as sacred knowledge. Ten everyday questions about Aboriginal and Torres Strait Islander objects showed 1 in 10 blocked, sensitive to small wording changes. | Sacred-knowledge topic set to **detect only** (`inputAction: NONE`)                                                                    |
| 4 (`Api` stack, v1) | 14/14, including the woomera question (detected, not blocked)                                                                                                                                                                                                      |                                                                                                                                        |

**The lesson:** denied-topic **examples teach the classifier**. Name the behaviour you want refused, never an object from your own domain. And test both directions: requests that must pass, as well as requests that must be blocked.

## Update: the sacred-knowledge topic is detect-only

A probabilistic classifier can't be tuned to zero false refusals by rewording, and refusing ordinary questions about Aboriginal objects is itself a poor outcome for the material the topic is meant to respect. Its protective value is low in this design:

- answers can only come from the Museum's **published** records, which the Museum vets before publication;
- the grounding check blocks anything not in those records;
- the prompt tells the model not to speculate about restricted or sacred meanings.

So the topic now detects without blocking. Detections appear in the guardrail trace and the model invocation logs, so their rate and content can be reviewed before deciding whether to block again.

## Where the guardrail lives

The guardrail moved from the `Ai` stack to the `Api` stack, next to the `/ask` Lambda, its only user. Each configuration change publishes a new version (see Decision). With the guardrail in `Ai`, that version was a CloudFormation export imported by `Api`, and **an export can't change while another stack imports it**, so every guardrail change failed to deploy. The guardrail's name is now derived from its stack, because a fixed name prevented creating the new guardrail while the old one still existed.

## Consequences

- Every Ask call costs a little more (about $0.10–0.15 per 1,000 text units per policy). That's cents at this scale.
- **Model invocation logs keep the original input,** because guardrail masking doesn't apply to them. The invocation log group uses CloudWatch Logs data protection to mask email addresses (managed identifier) and Australian phone numbers (a custom identifier, as CloudWatch has no managed one for Australia). Verified: a phone number in a question appears as `************` in the logs.
- **Guardrail behaviour is probabilistic.** The suite pins down known cases, not all cases. Wider coverage comes from the eval set and from logs of blocked requests.
- Denied topics apply to input only, so a model answer that somehow strays into these topics isn't blocked by them. Grounding (answers must come from the published records) and the content filters still apply to every answer.
