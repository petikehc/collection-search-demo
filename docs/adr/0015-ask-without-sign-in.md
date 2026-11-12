# 15. Ask without sign-in, bounded by a daily allowance of answers

- Status: accepted
- Date: 2026-11-12
- Changes: [ADR 9](0009-sign-in-with-cognito.md) (Ask no longer needs the `ask` scope)

## Context

Ask needed an invited account (ADR 9). The sign-in was the main cost control: each answer calls a model, so only known people could make it spend money. It was also the main obstacle to trying the app. A visitor had to be invited before seeing its most interesting feature.

The site is public, and crawlers found it within hours of going live. On the first day, two addresses sent about 22,000 requests between them, following every link they found.

So removing sign-in needs another way to bound cost, one that holds whoever is asking, including software.

## Options considered

1. **Keep sign-in.** Safe, but most visitors never see Ask.
2. **Self sign-up for Ask.** Anyone can make an account. Still a barrier, and an account is cheap for a script to make, so it bounds little.
3. **No sign-in, per-address limits only.** No barrier, but a bot spread over many addresses has no ceiling.
4. **No sign-in, with a shared daily allowance**, on top of the existing throttle and concurrency limit. A hard ceiling on cost, whoever is asking. The trade-off: one heavy user can use up the day's answers for everyone.

## Decision

**Option 4.**

- **`POST /ask` needs the API key only.** The web server holds the key and sends it; the browser never sees it. The `ask` scope is removed from Cognito, and only the `favourites` scope remains.
- **A daily allowance of 500 answers,** counted in a DynamoDB table with one item per UTC day.
  - The check and the increment are one conditional write (`ADD count` only if `count < 500`), so concurrent requests can't both take the last answer.
  - Items expire by TTL after a week.
  - The Lambda may only `UpdateItem` that table.
  - Past the allowance, the API answers 429 with a message saying search still works and answers return tomorrow. Nothing reaches the model.
  - If the counter can't be updated (a DynamoDB error), the request fails rather than skipping the check.
- **The existing limits stay:**
  - 1 request a second (burst 2) on `/ask`;
  - reserved concurrency 2 on the Lambda;
  - the Guardrail;
  - the alarm on more than 60 answers in an hour.

  A new alarm fires when the allowance runs out.
- **An answer only comes from a person's action.** A question searched from one of the site's own pages answers itself; otherwise the visitor presses "Ask AI" (a form POST). Browsers mark navigations within a site with `Sec-Fetch-Site: same-origin` and `Sec-Fetch-Mode: navigate`, which crawlers and other tools don't send, so a crawler following links can't spend the allowance. (The first version used `Sec-Fetch-User`, which Safari doesn't send: questions never answered themselves there.)
- **The web server refuses POSTs with no `Origin` header.** Astro's built-in origin check refuses cross-site POSTs, but let one with no `Origin` header through. Browsers always send `Origin` on a POST; scripts and crawlers often don't. A bot can fake the header, so this only stops naive ones: the allowance is the real bound.

## Cost

At most 500 answers a day: Claude Haiku 4.5 plus the Guardrail for each, about US$2–3 a day if a bot used the whole allowance every day. A typical day of real use is a few cents.

## Consequences

- **Easier:** anyone can try Ask. The command-line `pnpm ask` needs no browser sign-in.
- **Harder:**
  - One heavy user, or a bot that fakes browser headers, can use up the day's answers for everyone. The alarm says when it happens.
  - Questions arrive from anyone, so personal details in them are more likely. The Guardrail masks contact details in answers and the invocation log masks them in stored prompts (ADR 7, ADR 12). The page asks visitors not to include personal details.
- **Next, if abuse appears:** a per-address rate limit in the web server, and a CAPTCHA (AWS WAF) on the form.
