# Collection Search Demo

A learning project: hands-on with Amazon Bedrock, Amazon OpenSearch Service and Amazon Cognito, using a public museum collection.

It indexes a sample of the National Museum of Australia's public collection data in OpenSearch for keyword search. It also offers an "ask the collection" feature that answers questions with retrieval-augmented generation (a Bedrock Knowledge Base, with a Guardrail).

> **Status:** work in progress. Architecture, setup, cost and teardown instructions will be added as the pieces land.

## Repository layout

| Path        | What it holds                 |
| ----------- | ----------------------------- |
| `infra/`    | AWS CDK app (TypeScript)      |
| `docs/adr/` | Architecture decision records |

## Data, attribution and affiliation

This application was developed using the National Museum of Australia's Collection API.

- The collection metadata is licensed [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) by the National Museum of Australia, so it may be used for non-commercial purposes only. Every record in the app links back to its page on the Museum's website.
- This repository holds no Museum data dumps: the ingest fetches data from the API at run time.
- This project is an independent learning exercise. It is **not affiliated with, endorsed by or connected to the National Museum of Australia**.

## Licence

The code is licensed under MIT (see [LICENSE](LICENSE)). The licence does not cover the Museum's data, which stays under the Museum's own terms.
