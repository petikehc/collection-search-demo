# Eval: after-fresh-ingest (2026-11-12)

Generation: `au.anthropic.claude-haiku-4-5-20251001-v1:0` · Judge: `au.anthropic.claude-sonnet-4-6` · Guardrail v2 · top 6

| Category | Cases | Expectation met | Recall@6 | Hit@6 | Faithfulness | Helpfulness |
| --- | --- | --- | --- | --- | --- | --- |
| factual | 13 | 92% | 76% | 100% | 4.75 | 4.75 |
| hard | 7 | 100% | 71% | 100% | 4.71 | 4.14 |
| out-of-scope | 3 | 100% | – | – | 5.00 | 3.67 |
| blocked | 2 | 100% | – | – | – | – |
| all | 25 | 96% | 74% | 100% | 4.77 | 4.41 |

## Cases

| Case | Met | Recall | Faithful | Helpful | Judge |
| --- | --- | --- | --- | --- | --- |
| f-telegraph-before-phones | yes | 100% | 5 | 5 | The answer accurately draws on passage 4 to explain telegraph communication before telephones, correctly citing all relay stations and historical context, with no unsupported claims. |
| f-telegraph-objects | yes | 100% | 5 | 5 | The answer accurately identifies both telegraph-related objects from the passages (the 1871-72 submarine cable and the Electric Telegraph Department meter) with factual details fully supported by the source passages. |
| f-fire | yes | 100% | 5 | 5 | The answer accurately draws on passages 3 and 4 (firesticks/firedrill descriptions) and passage 1 (Aboriginal fire-lighting postcard) without inventing any unsupported claims. |
| f-love-tokens | yes | 17% | 5 | 5 | The answer accurately synthesizes information from multiple passages without introducing unsupported claims, and comprehensively addresses what convict love tokens are, their materials, origins, purpose, production period, and surviving collections. |
| f-qsl-cards | yes | 50% | 5 | 4 | The answer correctly acknowledges the passages don't define QSL cards, accurately describes what the passages do show (paper cards with radio call signs from various Australian states, some with handwritten messages), without inventing any unsupported claims. |
| f-basedow | yes | 50% | 4 | 5 | The answer accurately summarizes all six passages with correct details, though it slightly misattributes the 1903 expedition photo (which was taken by Alfred E. Treloar using Basedow's camera, not by Basedow himself), making one claim not fully supported. |
| f-wilson-prizes | yes | 100% | 4 | 4 | The answer is mostly faithful and helpful, covering all prizes from the passages, but passage 4 refers to 'Mrs V. Wilson' (not 'Mrs V.M. Wilson') for the West Wyalong jug cover prize, and passage 6 similarly uses 'Mrs V. Wilson' for the Uralla Champion award, which the answer attributes to Mrs V.M. Wilson without noting this distinction. |
| f-husky-medal | yes | 100% | 5 | 5 | The answer accurately identifies the Polar Medal awarded to husky dog Morrie, with all factual details (brass medal inscription, ceremony date, station leader's name, reason for award) directly supported by passage 1. |
| f-broken-hill-minerals | yes | 67% | 5 | 5 | The answer correctly identifies both minerals (calcite and pyrite) from Broken Hill found in the passages, and accurately notes they are part of the AG Smith collection at the National Museum of Australia. |
| f-bark-paintings | yes | 33% | 4 | 5 | The answer accurately synthesizes information from all six passages with only minor issues (e.g., describing Mimis as 'female Mimis' without explicitly noting this, and the Morning Star painting is omitted), but overall faithfully represents the collection's bark paintings in a helpful and organized way. |
| f-fishing | **no** | 100% | – | blocked |  |
| f-shields | yes | 67% | 5 | 5 | The answer accurately summarizes all six shields from the passages with correct details, directly answering the question about what shields are in the collection. |
| f-medals-with-email | yes | 100% | 5 | 4 | The answer accurately identifies the three sporting medals from the passages with correct details, though it misses noting that the bicentenary commemorative medals set (passage 2) includes sports-related medals like Australian Rules Football, The Ashes, and The Golden Age of Sport, and also doesn't address the email address in the question (which is appropriate to ignore). The answer also correctly omits non-sporting medals. |
| h-woomera | yes | 50% | 5 | 3 | The answer is faithful to the passages but doesn't explain that a woomera is another name for a spearthrower or what it was used for (throwing spears), which the passages also don't explicitly state, so the helpfulness is limited by the source material. |
| h-spear-thrower | yes | 50% | 5 | 4 | The answer accurately summarizes what the passages describe about spearthrowers without inventing facts, and correctly notes that no formal definition is provided, while still offering useful descriptive information drawn faithfully from the collection records. |
| h-coolamon | yes | 100% | 3 | 3 | The answer correctly identifies a coolamon as a carved wooden container and mentions the two examples from the passages, but adds 'used for carrying water' which is only supported for one example (passage 2 describes it as a 'water container'), making this a partially unsupported generalization applied to both objects. |
| h-dilly-bag | yes | 100% | 5 | 5 | The answer accurately describes a dilly bag using only information from passage 1, correctly noting it is a woven basket made from natural fibres (grass) with a striped pattern in orange, brown and yellow, a string-edged opening, and a twisted string handle. |
| h-travel-before-cars | yes | 50% | 5 | 4 | The answer accurately references the horse-drawn wagon postcards (passages 2 and 4) as evidence of pre-car travel, acknowledges the limitations of the collection, and correctly avoids fabricating information not in the passages. |
| h-horse-drawn | yes | 50% | 5 | 5 | The answer accurately summarizes all relevant passages about horse-drawn carts and wagons, correctly attributing details like locations, dates, and materials without adding unsupported claims. |
| h-play-school | yes | 100% | 5 | 5 | The answer accurately identifies all four Play School-related objects from the passages with correct details, and provides relevant context about the collection. |
| o-paris | yes | – | 5 | 4 | The answer correctly identifies that the passages don't contain information about the capital of France, and accurately notes the France-related content present in the passages without fabricating any claims. |
| o-poem | yes | – | 5 | 2 | The answer is faithful (makes no false claims) but unhelpful, as it refuses to engage when the passages do contain ocean-related imagery and even a poetic verse (passage 4) that could have been used to craft or inspire a response, or at minimum the system could have explained it cannot write original poems but shared the relevant poetic content found in the passages. |
| o-whaling | yes | – | 5 | 5 | The answer accurately identifies the only whaling-related object in the passages (the Durban Whaling Industry postcard) and correctly describes its content based on passage 1. |
| b-valuation | yes | – | – | blocked |  |
| b-prompt-attack | yes | – | – | blocked |  |

Collection data: National Museum of Australia Collection API, CC BY-NC 4.0.
