# 11. Spec-first API: one OpenAPI file builds the gateway and types the code

- Status: accepted
- Date: 2026-11-11

## Context

The API has three kinds of client: the Astro server, the command-line scripts and the eval. It has three Lambdas behind it. Each side needs the same request and response shapes. API Gateway also needs to know the routes, which ones need a token and which scope, and what to validate before a Lambda (and a model) runs.

If those are written in several places, they drift. A field gets renamed in a Lambda but not in the web client, or a route gets a scope in the code but not at the gateway.

## Options considered

1. **Code-first:** define routes in CDK (`RestApi` with `addResource`/`addMethod`) and the types in TypeScript. This is the familiar CDK way, but there's no contract a reviewer or another team can read, and the API documentation would be generated or written separately, after the fact.
2. **Code-first with a generated spec** (decorators or a schema library that emits OpenAPI). One source, but the spec is a by-product, and the tooling shapes the API.
3. **Spec-first:** `openapi.yaml` is the contract. CDK imports it with `SpecRestApi`, and `openapi-typescript` generates the types both sides use.

## Decision

Spec-first (option 3).

- **`openapi.yaml`** holds the routes, parameters, request and response schemas, and security:
  - `apiKey` on every route;
  - `cognito` with the `ask` or `favourites` scope on the routes that need a user.
  - The error responses say exactly when the gateway returns 401 or 403. These were checked against the live API, which corrected one wrong assumption (ADR 9).
- **The spec has no AWS details,** so it stays a readable contract with no ARNs or account details, and it would work with another gateway. CDK reads it and adds them at synth time (`withIntegrations` in `infra/lib/api-stack.ts`):
  - the Lambda integrations;
  - the Cognito authoriser with the user pool ARN;
  - request validators;
  - a mock integration for `/health`.
- **Validation at the gateway:** required parameters and request bodies are checked against the schemas before a Lambda runs, so a malformed `/ask` never costs a model call. The Lambdas still check ranges and formats, because the REST validator doesn't check everything (for example, numeric ranges on query parameters).
- **Generated types:** `pnpm generate:api` writes `functions/lib/api/types.gen.ts`. The Lambdas, the query builder and the Astro API client all import from it. **CI fails if the committed types don't match the spec,** so a change to the contract shows up in every caller as a type error.

## Consequences

- **Easier:**
  - One reviewable file answers "what does this API accept, return and require?"
  - A contract change is a type error in every caller, not a runtime surprise.
  - Gateway behaviour (auth, validation) is visible in the spec, not spread across CDK calls.
- **Harder:**
  - The AWS extensions are added by code that indexes into the spec by path and method. A renamed path fails at synth time rather than in the editor. Stack tests check the integrations and authoriser are in place.
  - API Gateway REST supports only part of OpenAPI 3 validation, so some rules are written twice: once in the spec for documentation and clients, and once in the Lambda for enforcement.
- **Revisit:** if more teams consumed the API, publish the spec, generate client SDKs from it, and run contract tests against the deployed stage.
