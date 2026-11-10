# 5. Collection data: what we store, how we stay current, and how we credit the Museum

- Status: accepted
- Date: 2026-11-10

## Context

The data comes from the National Museum of Australia's Collection API. Its terms of use (read November 2026) say:

- The metadata is licensed CC BY-NC 4.0: non-commercial use, with attribution. Apps must show "… was developed using the National Museum of Australia's Collection API", and every record must link back to its page on the Museum's website.
- Real-time calls to the API are preferred. Where data is stored, it should be kept up to date and show when it was last updated.
- Images may only be shown alongside their object record, using the image URL the API returns, not a local copy.

Search (facets, synonyms, relevance) and retrieval for the Knowledge Base need an index we control, so some data has to be stored. Without a key, the API allows about 60 requests a minute.

## Options considered

**What to store:**

1. **Nothing; query the API live for every search.** Fully current, but no facets, synonyms or vector search, and 60 requests a minute would be shared by every user.
2. **Full raw records.** Simple, but it stores more than search needs, and the copy goes stale everywhere it's shown.
3. **Only what search needs, plus a link back and a timestamp, with the full record fetched live.** The index holds searchable fields and image URLs. The object page calls the API live.

**How to refresh:**

1. **Incremental sync** with the API's `datestamp` filter (records changed since the last run) plus `status_code=410` (withdrawn records), applied as partial updates to the live index.
2. **A full re-ingest of the sample** into a new index, then the alias swap (ADR 0004).

## Decision

- **Store only what search needs** (`CollectionObject`): titles, descriptions, types, places, materials, years, and thumbnail and preview URLs with their rights statements. Every document carries `sourceUrl` (the record's page on the Museum's website) and `retrievedAt`. Records without a link back are dropped at ingest.
- **Fetch the full record live** on the object page (`/object/[id]`) via `NmaClient.getObject`, honouring the API's caching headers. A withdrawn record (410) shows as unavailable.
- **Images are hotlinked** from `collectionsearch.nma.gov.au`, using the URL from the API, never copied. They are shown with their rights label (no statement means "All Rights Reserved").
- **Refresh by full re-ingest, daily at 3 am Sydney time,** using EventBridge Scheduler with the `Australia/Sydney` time zone, so daylight saving doesn't shift it. The schedule is deployed **disabled** and enabled with `cdk deploy -c dailyRefresh=true`. For a sample of about 3,750 objects, a full run takes about 45 seconds and about 42 API calls. It is idempotent, drops withdrawn records automatically, and reuses the tested alias swap.
- **Attribution** appears in every API response (`attribution`) and on every page of the web app. The README states that the project is not affiliated with the Museum. No Museum logos are used, and no hostname contains "nma" or "nationalmuseum".
- **No Museum data is committed** to the repository, apart from a tiny trimmed and attributed test fixture. The ingest fetches at run time.

## Consequences

- Search results can be up to a day old (or older while the schedule is disabled). Each result shows `retrievedAt`, and the object page is always live.
- The API rate limit is used about 42 times a day, not once per search.
- **At full-collection scale** (about 97,000 objects, about 1,000 requests for a full sweep), switch to incremental sync (`datestamp` plus 410 handling) applied to the live index. Keep the full reindex for mapping changes. A Museum API key would also lift the rate limit.
- Non-commercial use only: this is a learning project and must not be offered as a commercial service.
