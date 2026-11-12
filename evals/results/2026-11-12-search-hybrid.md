# Search eval: hybrid (2026-11-12)

20 questions and 15 keyword queries, through the deployed `GET /search`.

| Mode    | Question recall@10 | Question hit@10 | Keyword precision@10 | Mean round trip |
| ------- | ------------------ | --------------- | -------------------- | --------------- |
| keyword | 27%                | 35%             | 100%                 | 73 ms           |
| hybrid  | 85%                | 100%            | 95%                  | 66 ms           |

## Questions

| Case                      | Question                                                                        | Keyword recall@10 | Hybrid recall@10 |
| ------------------------- | ------------------------------------------------------------------------------- | ----------------- | ---------------- |
| f-telegraph-before-phones | How did people communicate over long distances before telephones?               | 0%                | 50%              |
| f-telegraph-objects       | What objects in the collection relate to the telegraph?                         | 0%                | 33%              |
| f-fire                    | What did people use to start fires?                                             | 0%                | 100%             |
| f-love-tokens             | What are convict love tokens?                                                   | 100%              | 100%             |
| f-qsl-cards               | What is a QSL card?                                                             | 100%              | 100%             |
| f-basedow                 | What photographs did Herbert Basedow take?                                      | 0%                | 80%              |
| f-wilson-prizes           | What prizes did Mrs V.M. Wilson win at agricultural shows?                      | 100%              | 100%             |
| f-husky-medal             | Which medal was awarded to a husky dog?                                         | 100%              | 100%             |
| f-broken-hill-minerals    | What minerals from Broken Hill are in the collection?                           | 10%               | 90%              |
| f-bark-paintings          | Tell me about bark paintings in the collection.                                 | 20%               | 40%              |
| f-fishing                 | What fishing equipment is in the collection?                                    | 100%              | 100%             |
| f-shields                 | What shields are in the collection?                                             | 0%                | 100%             |
| f-medals-with-email       | My email is jane.citizen@gmail.com. What sporting medals are in the collection? | 0%                | 100%             |
| h-woomera                 | What is a woomera and what was it used for?                                     | 0%                | 75%              |
| h-spear-thrower           | What is a spear thrower?                                                        | 0%                | 100%             |
| h-coolamon                | What is a coolamon?                                                             | 0%                | 100%             |
| h-dilly-bag               | What is a dilly bag?                                                            | 0%                | 100%             |
| h-travel-before-cars      | How did people travel over long distances before cars?                          | 0%                | 50%              |
| h-horse-drawn             | Show me horse-drawn carts and wagons.                                           | 0%                | 90%              |
| h-play-school             | What objects relate to the Play School TV show?                                 | 0%                | 100%             |

## Keywords (hybrid mode)

| Query              | Objects matching the words | Extra objects by meaning | First 10 that match the words |
| ------------------ | -------------------------- | ------------------------ | ----------------------------- |
| woomera            | 15                         | 22                       | 80%                           |
| kylie              | 59                         | 6                        | at least 100%                 |
| coolamon           | 4                          | 29                       | 100%                          |
| dilly bag          | 1                          | 29                       | 100%                          |
| telegram           | 10                         | 22                       | 100%                          |
| convict love token | 63                         | 0                        | at least 100%                 |
| firestick          | 2                          | 28                       | 100%                          |
| bark painting      | 40                         | 0                        | 100%                          |
| QSL card           | 19                         | 11                       | 100%                          |
| spearthrower       | 15                         | 22                       | 80%                           |
| boomerang          | 59                         | 6                        | at least 100%                 |
| polar medal        | 1                          | 29                       | 100%                          |
| photograph         | 1464                       | 0                        | at least 70%                  |
| postcard           | 916                        | 0                        | at least 100%                 |
| medal              | 427                        | 4                        | at least 100%                 |

"At least": the query matches more objects than the 50 the API lists per page, so some of the
first 10 may match the words without being recognised here. The summary figure is a lower bound.
