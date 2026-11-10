# 1. Record architecture decisions

- Status: accepted
- Date: 2026-11-10

## Context

This project makes several choices about AWS services that have reasonable alternatives (for example, a managed OpenSearch domain versus OpenSearch Serverless). The reasons should be easy to find later, together with what was given up.

## Decision

Record each significant decision as a short Markdown file in `docs/adr/`, numbered in order, using [template.md](template.md). An ADR is never rewritten after it is accepted. A later ADR supersedes it, and both link to each other.

## Consequences

- Decisions and their trade-offs live next to the code that implements them.
- Each ADR takes a few minutes to write, so only decisions with real alternatives get one.
