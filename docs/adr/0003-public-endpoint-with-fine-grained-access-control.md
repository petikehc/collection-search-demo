# 3. Public domain endpoint with fine-grained access control, not a VPC

- Status: accepted
- Date: 2026-11-10

## Context

An OpenSearch Service domain is reached either through a VPC endpoint or through a public endpoint. A VPC is the usual default for private data. In this project, though:

- **Bedrock Knowledge Bases require a public endpoint.** They can't use a domain in a VPC as a vector store.
- **A VPC isn't free.** It would need the Lambdas inside it too, plus NAT gateways or interface endpoints (each billed hourly) for them to reach Bedrock, S3 and the Museum's API.

The data itself is public collection metadata, but the domain must still be protected from writes, deletes and scraping.

## Options considered

1. **VPC domain.** Network isolation, but it's incompatible with the KB, and adds NAT or endpoint cost and Lambda cold-start overhead.
2. **Public endpoint, open access policy, FGAC with a username and password.** Allows the Dashboards login, but the endpoint then accepts unsigned requests from anywhere. Only a password stands between the internet and the security API.
3. **Public endpoint, account-only access policy, FGAC with an IAM master role.** Every request must be SigV4-signed by an IAM principal in this account, then mapped to a narrow OpenSearch role.

## Decision

We chose option 3. The domain is locked down in layers:

| Layer                    | Control                                                                                                                                                                                                                                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Transport                | HTTPS enforced, TLS 1.2 minimum (`Policy-Min-TLS-1-2-2019-07`), node-to-node encryption                                                                                                                                                                                                                                                                |
| Storage                  | Encryption at rest (AWS-owned KMS key)                                                                                                                                                                                                                                                                                                                 |
| Endpoint (access policy) | Allows `es:ESHttp*` only to this account's IAM principals (`arn:aws:iam::<account>:root`). This delegates to IAM, so a principal also needs its own identity policy granting `es:ESHttp*` on the domain. Unsigned and anonymous requests are rejected with 403.                                                                                        |
| OpenSearch (FGAC)        | Fine-grained access control on, internal user database off, anonymous auth off. The master user is the `OpenSearchAdminRole` IAM role. Each workload role (ingest Lambda, search Lambda, KB service role) is mapped to its own OpenSearch role with only the index and cluster permissions it needs, e.g. read-only on the `objects` alias for search. |
| Admin access             | Humans assume `OpenSearchAdminRole` (trusted by the account, so it also needs `sts:AssumeRole` in the caller's own policy). `pnpm os` sends signed requests as that role.                                                                                                                                                                              |

## Consequences

- **No Dashboards login.** OpenSearch Dashboards isn't usable through a browser, because a browser can't sign requests. If needed, add Cognito authentication for Dashboards, or a second access-policy statement allowing an internal user from a fixed IP range.
- **No passwords.** Nothing for the domain is stored in Secrets Manager.
- **Two layers to grant.** Every new consumer needs both an IAM policy and an FGAC role mapping, which a small custom resource manages.
- **A second admin, observed after deployment:** the CDK CloudFormation execution role (`cdk-hnb659fds-cfn-exec-role-…`) is also mapped to `all_access` and `security_manager`. AWS doesn't document this; it appears the service maps the principal that created the domain. We leave it in place: only `cloudformation.amazonaws.com` can assume that role, CloudFormation never sends HTTP requests to the domain, and overwriting an AWS-created mapping risks breaking later stack updates. Production would deploy the domain with a dedicated, narrowly trusted execution role and audit the security mappings after each deploy.
- **Not done yet:** audit logging (FGAC audit logs to CloudWatch) would be the next step for a production domain. It is off here to keep log ingestion costs at zero. A customer-managed KMS key would allow key rotation control and CloudTrail visibility of key use.
