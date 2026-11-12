# Search eval: cross-fields (2026-11-12)

20 questions and 15 keyword queries, through the deployed `GET /search`.

| Mode | Question recall@10 | Question hit@10 | Question MRR | Question hit@3 | Keyword precision@10 | Mean round trip |
| --- | --- | --- | --- | --- | --- | --- |
| keyword | 30% | 45% | 0.36 | 40% | 100% | 94 ms |
| hybrid | 70% | 100% | 0.69 | 85% | 94% | 189 ms |

## Questions

| Case | Question | Keyword recall@10 | Hybrid recall@10 |
| --- | --- | --- | --- |
| f-telegraph-before-phones | How did people communicate over long distances before telephones? | 0% | 50% |
| f-telegraph-objects | What objects in the collection relate to the telegraph? | 33% | 67% |
| f-fire | What did people use to start fires? | 0% | 100% |
| f-love-tokens | What are convict love tokens? | 40% | 30% |
| f-qsl-cards | What is a QSL card? | 80% | 60% |
| f-basedow | What photographs did Herbert Basedow take? | 0% | 70% |
| f-wilson-prizes | What prizes did Mrs V.M. Wilson win at agricultural shows? | 100% | 100% |
| f-husky-medal | Which medal was awarded to a husky dog? | 100% | 100% |
| f-broken-hill-minerals | What minerals from Broken Hill are in the collection? | 20% | 70% |
| f-bark-paintings | Tell me about bark paintings in the collection. | 30% | 20% |
| f-fishing | What fishing equipment is in the collection? | 100% | 100% |
| f-shields | What shields are in the collection? | 100% | 100% |
| f-medals-with-email | My email is jane.citizen@gmail.com. What sporting medals are in the collection? | 0% | 100% |
| h-woomera | What is a woomera and what was it used for? | 0% | 25% |
| h-spear-thrower | What is a spear thrower? | 0% | 25% |
| h-coolamon | What is a coolamon? | 0% | 100% |
| h-dilly-bag | What is a dilly bag? | 0% | 100% |
| h-travel-before-cars | How did people travel over long distances before cars? | 0% | 50% |
| h-horse-drawn | Show me horse-drawn carts and wagons. | 0% | 40% |
| h-play-school | What objects relate to the Play School TV show? | 0% | 100% |

## Keywords (hybrid mode)

| Query | Objects matching the words | Extra objects by meaning | First 10 that match the words |
| --- | --- | --- | --- |
| woomera | 28 | 9 | 100% |
| kylie | 51 | 13 | at least 100% |
| coolamon | 8 | 28 | 100% |
| dilly bag | 1 | 29 | 100% |
| telegram | 11 | 23 | 100% |
| convict love token | 124 | 0 | at least 90% |
| firestick | 2 | 28 | 100% |
| bark painting | 73 | 0 | at least 100% |
| QSL card | 29 | 2 | 100% |
| spearthrower | 28 | 10 | 100% |
| boomerang | 51 | 12 | at least 100% |
| polar medal | 2 | 29 | 50% |
| photograph | 1490 | 0 | at least 100% |
| postcard | 872 | 0 | at least 70% |
| medal | 454 | 0 | at least 100% |

"At least": the query matches more objects than the 50 the API lists per page, so some of the
first 10 may match the words without being recognised here. The summary figure is a lower bound.
