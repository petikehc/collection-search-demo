# 13. Hosting the web front end: Lambda behind an HTTP API on a custom domain

- Status: accepted
- Date: 2026-11-11

## Context

The Astro front end ran only on `localhost`. To share it, it needs a public HTTPS address that stays the same across teardowns and rebuilds, because the stacks are torn down between demos to save the cost of the OpenSearch domain.

It has to stay server-rendered:

- **It holds secrets:** the API key and the Cognito client secret.
- **It keeps tokens in httpOnly cookies** and verifies them on every request (the backend-for-frontend pattern in ADR 9), so page scripts never see a token.
- **Object pages read the Museum's API live** on each request (ADR 5).

The site's DNS (`idoescode.com`) is hosted outside AWS.

## Options considered

1. **Static hosting** (GitHub Pages, S3). Cheapest, but the secrets would ship to every browser and tokens would live in page JavaScript. That means rebuilding the app around a public client and a weaker security model. Rejected.
2. **Lambda with a function URL.** Simplest, but function URLs can't have a custom domain, so the address would change on every rebuild.
3. **CloudFront in front of a Lambda function URL.** Supports a custom domain, caching and a web application firewall. But CloudFront's signed access to function URLs (origin access control) requires the client to send a SHA-256 of every POST body. Plain HTML forms don't, and this app's sign-out, Ask and favourites are forms. TLS would also end at the visitor's nearest edge location, which for overseas visitors is outside Australia.
4. **API Gateway HTTP API in front of Lambda, with a regional custom domain.** Supports a custom domain and works with forms unchanged. Everything stays in Sydney. Throttling and access logs are built in. About $1.29 per million requests.
5. **An always-on container** (App Runner, ECS on Fargate). Works, but costs $5–25 a month to run all the time, for a demo that's mostly idle.
6. **A managed front-end platform** (Vercel, Netlify). The easiest Astro hosting, but the API key, the client secret and user sessions would live with a third party, outside the Australian residency boundary (ADR 12).

## Decision

**Option 4**, at `https://collection-search.idoescode.com`.

- **`CollectionSearch-Web`:** the Astro Node server runs in Lambda through the [AWS Lambda Web Adapter](https://github.com/awslabs/aws-lambda-web-adapter), which turns each invocation into a plain HTTP request to the server.
  - The adapter layer is pinned to one version (v1.1.0).
  - The HTTP API's default `execute-api` endpoint is switched off, so the custom domain is the only way in.
  - Stage throttling is 20 requests per second (burst 40). Reserved concurrency is 5, a ceiling on cost and on the load passed to our API and the Museum's.
  - Access logs record the path but not the query string, so search terms aren't logged.
  - The Lambda's environment holds only the secrets' ARNs, and its role can read only those two secrets.
  - Alarms on Lambda errors and 5xx go to the existing alarm email.
- **`CollectionSearch-Domain`, kept by teardown like `Ci`:**
  - the ACM certificate (DNS validation);
  - the regional custom domain name (TLS 1.2+).

  Both are free to keep. Keeping them means the two DNS records, made by hand, stay valid, and a rebuild just maps the new site onto the same domain.
- **The build happens during `cdk synth`.** The Astro build runs as the asset's bundling step, hashed on its output, so a deploy always ships the current code, including the shared code it imports from `functions/`. `astro build` bundles every dependency, so the asset is the 2.1 MB build plus a start script, with no `node_modules`.
- **One codebase for local and hosted:**
  - Sign-in and sign-out URLs come from the request's own origin.
  - Cognito registers both `http://localhost:4321` and the https origin.
  - Config comes from environment variables in Lambda, and from the stack outputs locally.

## What we found

- **Behind a proxy, Astro distrusts the Host header by default, which breaks every form.** Without `security.allowedDomains`, Astro builds each request's URL as `http://localhost:8080`, whatever the browser asked for:
  - its origin check then refuses every form post, including same-origin ones (reproduced locally: 403);
  - cookies lose `Secure`.

  Allowing only our domain (https) fixes both, while a forged Host header still gets 403.
- **Bundling every dependency broke the dev server** (`require is not defined`): some CommonJS packages can't run through Vite's dev pipeline. A small inline integration applies it to `astro build` only.
- **The live checks found one gap:** no `Strict-Transport-Security` header. It's now sent on HTTPS for a year.
- **A slow Museum API mattered more once the site was public.** A hung fetch would hold a request, and one of only five Lambda slots, for up to 30 seconds. The Museum client now gives up after 5 seconds and doesn't retry a timeout.

## How it was verified

Against the live site:

- search (including a synonym) and object pages return 200;
- a cross-site POST gets 403, and a same-origin POST works;
- cookies are `Secure; HttpOnly; SameSite=Lax`;
- `returnTo=//evil.example` stays local;
- sign-in uses the https callback;
- a forged callback gets 400;
- plain http isn't served;
- the default `execute-api` URL returns 404;
- HSTS is present.

In the browser: sign-in through managed login, Ask with citations, adding and removing a favourite, and sign-out followed by a password prompt.

Timing: the first request after a deploy took 1.6 s (Lambda init 267 ms). Warm pages take 0.2–0.5 s.

`pnpm check:bundles` starts the server from the synthesised asset, with no `node_modules` and no AWS credentials, and expects a 404 for an unknown path. So CI catches a build that only works with the repository's dependencies installed.

## Consequences

- **Easier:**
  - The demo is one link, and it survives teardown and rebuild.
  - Hosting costs nothing measurable at demo traffic.
  - It's deployed by the same CDK app and GitHub Actions workflow as everything else.
- **Harder:**
  - Cold starts add about 1.5 s to the first request after an idle spell.
  - The two DNS records live outside AWS, made by hand once.
  - Search is now open to anyone, though throttled and capped. Ask and favourites stay invite-only.
- **Revisit:** CloudFront in front, for caching static pages and a web application firewall, if traffic ever justified it, with a fix for the POST body hash.
