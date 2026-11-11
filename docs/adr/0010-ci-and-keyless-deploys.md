# 10. CI on every change; deploys from main through GitHub OIDC, with no stored AWS keys

- Status: accepted
- Date: 2026-11-11

## Context

Every change should be checked the same way, on a clean machine, before it reaches `main`. Deploying from a laptop works, but it depends on whoever has credentials, and on what's installed on their machine.

The usual shortcut, an IAM user's access keys stored as GitHub secrets, gives us long-lived keys that:

- don't expire;
- are hard to scope to a branch;
- turn up in leaks.

## Options considered

1. **Access keys as GitHub secrets.** Simple. Long-lived, and anyone who can edit a workflow can use them from any branch.
2. **GitHub OIDC federation.** Each workflow run gets a short-lived token signed by GitHub, which AWS exchanges for credentials lasting one hour (`AssumeRoleWithWebIdentity`). The role's trust policy decides which repository, branch or environment may use it. Nothing to rotate or leak.
3. **A deploy pipeline inside AWS** (CodePipeline, or CDK Pipelines). Strong for multi-account promotion, but more machinery than a one-account demo needs.

## Decision

**Option 2.**

**`ci.yml`** runs on every pull request and every push to `main`, with no AWS access at all. It checks that:

- the generated API types still match `openapi.yaml` (it regenerates them and fails on any difference);
- typecheck (including the Astro site), lint and tests pass;
- `cdk synth` works, and every Lambda bundle loads (`pnpm check:bundles`).

**`deploy.yml`** is manual (`workflow_dispatch`), runs only on `main` and one run at a time, and re-runs the tests. It assumes the deploy role, then runs `cdk deploy` for the app stacks.

**The deploy role (`CollectionSearch-Ci` stack):**

- Trusts GitHub's OIDC provider, with `aud = sts.amazonaws.com` and `sub = repo:<owner>@<ownerId>/<repo>@<repoId>:ref:refs/heads/main`. A fork, a pull request or another branch can't assume it.
- That `sub` is GitHub's **immutable subject**, the default for new repositories, which adds the owner and repository IDs. A repository deleted or renamed and then re-created under the same name gets new IDs, so it can't assume the role either. The first deploy run failed because the role still trusted the older form without IDs: STS answered only "Not authorized to perform sts:AssumeRoleWithWebIdentity", and the subject GitHub actually sends came from `gh api repos/<owner>/<repo>/actions/oidc/customization/sub`.
- Can do one thing: assume the CDK bootstrap roles (deploy, file publishing, lookup). Those roles are what `cdk deploy` uses anyway, so what a deploy may change is decided in one place, the bootstrap.
- Its ARN is a repository **variable**, not written in the workflow file.
- The stack is deployed by hand with `-c githubSubjectPrefix=…`, read from that same `gh api` call. No owner or account is in the code.

**Supply chain:**

- Actions are pinned to commit SHAs, with the release in a comment, because tags can be moved.
- The CI checkout doesn't keep the GitHub token (`persist-credentials: false`).
- Dependencies install from the lockfile only (`--frozen-lockfile`), and only allow-listed packages may run install scripts (`onlyBuiltDependencies`).
- **No release younger than 14 days.** Hijacked releases are usually found and pulled within days. pnpm enforces this (`minimumReleaseAge` in `pnpm-workspace.yaml`): it refuses to resolve a younger version, even one named exactly, unless the package is added to `minimumReleaseAgeExclude`. Versions already in the lockfile still install.
  - The rule was followed by hand for actions but slipped for npm. When it was enforced, 23 of 39 direct dependencies were younger than 14 days (mostly AWS SDK clients). They were kept, with no known advisories (`pnpm audit`), because by 24 November 2026 they're all older than 14 days, and downgrading would have meant more churn and risk. That's the case for a tool over a habit.
- **Dependabot** (`.github/dependabot.yml`) opens weekly, grouped update PRs for actions and npm with the same 14-day cooldown, so pins don't go stale. CI checks each PR. Security updates skip the cooldown. Dependabot PRs can't deploy.
- **Next, not built:** blocking unexpected network egress on the runners (for example StepSecurity Harden-Runner, in audit mode first). It would stop a compromised dependency sending secrets out, at the cost of trusting one more third-party action with the whole runner.

The `Ci` stack is deployed once by hand, and `pnpm teardown` keeps it. The deploy workflow doesn't redeploy it, so a workflow can't widen its own permissions.

## Consequences

- **Easier:**
  - No AWS keys exist to leak or rotate.
  - Every change gets the same checks on a clean machine. A clean install already caught one bug: esbuild was only declared in `infra/`, but CDK runs it from the repository root.
- **The real trust boundary is `main`.** Anyone who can push to `main` can deploy, and through CloudFormation's execution role (which the default bootstrap gives AdministratorAccess) can change anything. Before more than one person works on this, add:
  - branch protection on `main`: pull requests only, CI must pass, a review;
  - a GitHub environment with required reviewers, with the trust condition switched to `environment:<name>`;
  - a narrower bootstrap execution policy (`cdk bootstrap --cloudformation-execution-policies`).
- **Not covered:** multi-account promotion (dev → prod). The deploy workflow also deploys the hosted web front end (ADR 13).
