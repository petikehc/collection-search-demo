# 2. One managed OpenSearch domain for keyword search and Knowledge Base vectors

- Status: accepted
- Date: 2026-11-10

## Context

We need OpenSearch for keyword search (explicit mappings, analysers, synonyms, facets, index aliases) and a vector store for a Bedrock Knowledge Base. The data set is small: about 4,000 collection objects, with one 1024-dimension Titan V2 embedding each (about 16 MB of vectors). The cost has to stay low for a learning project that may run for weeks.

Prices are Sydney (ap-southeast-2), from the AWS price list in November 2026, in USD:

| Option                                                  | Daily cost, 24 h                                        |
| ------------------------------------------------------- | ------------------------------------------------------- |
| A. One managed domain (keyword index + KB vector index) | t3.small ≈ $1.39, m7g.medium ≈ $2.09, t3.medium ≈ $2.74 |
| B. Managed domain for keyword search + KB on S3 Vectors | as A, plus under $0.02                                  |
| C. OpenSearch Serverless (Classic)                      | 1 OCU without redundancy ≈ $6.74, 2 OCU ≈ $13.49        |

Bedrock Knowledge Bases support a managed domain as a vector store if:

- the endpoint is public, not in a VPC;
- the engine is 2.13 or later;
- the vector field uses the `faiss` engine.

## Options considered

1. **A. One managed domain.** Cheapest, and it puts both keyword search and k-NN on the same service, which also makes hybrid search possible later. The catch is that we have to create the KB's vector index and the access mapping ourselves.
2. **B. Managed domain + S3 Vectors.** Simpler KB wiring and almost free. It is the fallback if A can't be made to work. The cost is that the KB then doesn't use OpenSearch at all.
3. **C. OpenSearch Serverless.** No cluster to size, but it costs 3–6 times more, and its minimum charge applies even when idle. The newer scale-to-zero collections were reported (June 2026) not to work with KB Retrieve.

## Decision

We chose option A:

- **Instance:** one `m7g.medium.search` data node with 10 GB gp3, on OpenSearch 3.7.
- **No standby:** no dedicated master nodes, no zone awareness and no Multi-AZ standby.
- **No replicas:** indices use `number_of_replicas: 0`, so the single node reports green.

We chose m7g.medium (Graviton, 4 GiB) over t3.small because it isn't burstable, so performance stays steady under bulk indexing. It also leaves room for k-NN native memory. A JVM memory pressure alarm is kept anyway.

## Consequences

- **Availability:** a single node has no high availability. If the node fails, the index is rebuilt from the source API (the ingest is reproducible), so no data is lost that can't be fetched again.
- **Cost:** the domain bills every hour it exists, about $63/month if left running. Teardown and rebuild are scripted.
- **Resizing:** changing the instance type later is an in-place blue/green change of about 20 minutes, with no client changes.
- **What production would change:** three data nodes across AZs (or Multi-AZ with standby), dedicated master nodes, replicas of 1 or more, and automated snapshots to S3.
