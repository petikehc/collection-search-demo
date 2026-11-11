# 12. Data residency: everything in Sydney, generation within Australia, enforced by IAM

- Status: accepted
- Date: 2026-11-11

## Context

The collection data is public, but the app also handles data about people:

- email addresses in Cognito;
- favourites;
- the questions people type into Ask, which may include personal details;
- logs of all of the above.

Australian public-sector organisations commonly expect such data to stay in Australia. Bedrock makes this easy to break by accident: many newer models are only offered through cross-region inference profiles, and a `global.` or `us.` profile can send a prompt to another country.

Facts checked when choosing models (10 November 2026, `ap-southeast-2`):

- Titan Text Embeddings V2 runs in Sydney itself.
- Claude Haiku 4.5 and Claude Sonnet 4.6 are offered through the `au.` inference profiles, which route only between Sydney (`ap-southeast-2`) and Melbourne (`ap-southeast-4`).
- Cohere Embed v4 was only available through a `global.` profile.

## Options considered

1. **Pick models by quality and cost alone,** accepting `global.` profiles. This gives the widest model choice, but prompts and documents may be processed outside Australia.
2. **Sydney only:** only models hosted in `ap-southeast-2` itself. That rules out current Claude models here.
3. **Australia only:** resources in Sydney, and models either in Sydney or through `au.` profiles.

## Decision

Australia only (option 3).

- **Every resource is in `ap-southeast-2`:**
  - OpenSearch, the Knowledge Base, the Guardrail, Cognito, API Gateway, the Lambdas, DynamoDB, S3, Secrets Manager;
  - CloudWatch logs, metrics and alarms, X-Ray.
- **Embeddings:** Titan Text Embeddings V2 in Sydney. Cohere Embed v4 was rejected because it needed a `global.` profile.
- **Generation:** Claude Haiku 4.5 through the `au.` profile. The eval's judge, Claude Sonnet 4.6, also uses `au.`.
- **Enforced, not just chosen:** the Ask Lambda's role may invoke the model only in `ap-southeast-2` and `ap-southeast-4` (`ASK_PROFILE_REGIONS` in `infra/lib/api-stack.ts`). If someone switched it to a `global.` profile, the calls would be refused rather than quietly leaving Australia.
- **Logs:** Bedrock invocation logs keep full prompts and answers, because the Guardrail's masking doesn't apply to them. So the log group masks email addresses, Australian phone numbers and card details (CloudWatch data protection), and keeps them for 14 days.

## Consequences

- **Easier:** one clear sentence for a reviewer, with the IAM policy and a stack test as evidence.
- **Harder:** fewer models to choose from, and new models often reach `global.` profiles before `au.` ones. The model choice is re-checked when upgrading.
- **Outside this boundary, and known:**
  - **GitHub** (code, CI logs) is outside Australia. It holds no user data or secrets: deploys use OIDC with short-lived credentials (ADR 10).
  - **Bedrock invocation logging is an account and region setting,** not a project resource. Teardown switches it off only if this project switched it on.
  - **The Museum's Collection API** is a third-party service. We only send it object IDs and search parameters, never user data.
- **Not covered:** formal compliance (IRAP, PSPF assessment), customer-managed KMS keys, and backups. A production system would need all three.
