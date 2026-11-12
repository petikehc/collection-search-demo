# Eval: examples-not-all (2026-11-12)

Generation: `au.anthropic.claude-haiku-4-5-20251001-v1:0` · Judge: `au.anthropic.claude-sonnet-4-6` · Guardrail v2 · top 6

| Category | Cases | Expectation met | Recall@6 | Hit@6 | Faithfulness | Helpfulness |
| --- | --- | --- | --- | --- | --- | --- |
| factual | 13 | 92% | 76% | 100% | 4.83 | 4.75 |
| hard | 7 | 100% | 71% | 100% | 4.57 | 4.43 |
| out-of-scope | 3 | 100% | – | – | 5.00 | 3.67 |
| blocked | 2 | 100% | – | – | – | – |
| all | 25 | 96% | 74% | 100% | 4.77 | 4.50 |

## Cases

| Case | Met | Recall | Faithful | Helpful | Judge |
| --- | --- | --- | --- | --- | --- |
| f-telegraph-before-phones | yes | 100% | 5 | 5 | The answer accurately uses information from passage 4 about the telegraph cable and pre-telegraph ship communication, with all claims directly supported by the passages, and also implicitly references the telegram items in the collection. |
| f-telegraph-objects | yes | 100% | 5 | 5 | The answer accurately identifies both telegraph-related objects from the passages (the submarine cable and the electric meter) with correct details supported by the source passages. |
| f-fire | yes | 100% | 5 | 5 | The answer accurately summarizes the relevant passages about firesticks and the Aboriginal fire-lighting postcard, with all claims supported by the source material. |
| f-love-tokens | yes | 17% | 5 | 5 | The answer accurately synthesizes information from multiple passages without introducing unsupported claims, and directly and comprehensively answers the question about what convict love tokens are. |
| f-qsl-cards | yes | 50% | 5 | 4 | The answer correctly acknowledges that the passages don't define QSL cards, while accurately summarizing what can be inferred from the collection records without inventing any facts. |
| f-basedow | yes | 50% | 5 | 5 | The answer accurately summarizes all five photographs taken by Herbert Basedow from the passages, with correct dates, locations, and subjects, without adding unsupported claims. |
| f-wilson-prizes | yes | 100% | 4 | 4 | The answer is mostly faithful and helpful, but includes the Uralla Show Champion award attributed to 'Mrs V. Wilson' (not 'Mrs V.M. Wilson') and the West Wyalong certificate also says 'Mrs V. Wilson' rather than 'Mrs V.M. Wilson', though these are minor naming discrepancies in the source passages themselves that the answer doesn't flag. |
| f-husky-medal | yes | 100% | 5 | 5 | The answer accurately identifies the Polar Medal awarded to husky dog Morrie, with all details (brass medal inscription, December 1993 ceremony, station leader Alan Grant, made by station staff) directly supported by passage 1. |
| f-broken-hill-minerals | yes | 67% | 5 | 5 | The answer accurately identifies both minerals (calcite and pyrite) from Broken Hill found in the passages, correctly notes they are from New South Wales and part of the AG Smith collection, with no unsupported claims. |
| f-bark-paintings | yes | 33% | 5 | 5 | The answer accurately synthesizes information from all six passages without introducing unsupported claims, covering materials, design elements, geographic origins, collections, and specific subjects depicted in the bark paintings. |
| f-fishing | **no** | 100% | – | blocked |  |
| f-shields | yes | 67% | 5 | 5 | The answer accurately summarizes all six shields from the passages with correct details, directly answering the question about what shields are in the collection. |
| f-medals-with-email | yes | 100% | 4 | 4 | The answer correctly identifies the three sports medals and mentions the commemorative medals with sporting themes, but slightly mischaracterizes 'The Anzacs' as a sporting achievement; also the answer appropriately ignores the email address in the question. |
| h-woomera | yes | 50% | 5 | 3 | The answer is fully faithful to the passages but only partially helpful since it never explains that 'woomera' is the Aboriginal term for a spearthrower, and the passages don't contain that information, so the answer could have more clearly stated that the term 'woomera' is not found in the retrieved records. |
| h-spear-thrower | yes | 50% | 5 | 5 | The answer accurately synthesizes information from multiple passages to describe what a spearthrower is, including its components, materials, decorations, and geographic origins, with all claims supported by the retrieved passages. |
| h-coolamon | yes | 100% | 3 | 4 | The answer correctly identifies a coolamon as a carved wooden container that can be oval-shaped, made from a single piece of wood, and decorated, but incorrectly specifies it as a 'water container' — only passage 2 mentions 'water container,' while passage 1 describes it more generally; additionally, the claim about handles made from 'copper wire or other materials' is supported, but conflating all details into a single definition introduces minor inaccuracies. |
| h-dilly-bag | yes | 100% | 5 | 5 | The answer accurately describes the dillybag using only information from passage 1, correctly identifying it as a woven basket made of natural fibres (grass) with a striped pattern in orange, brown and yellow, a string-edged opening, and a twisted string handle. |
| h-travel-before-cars | yes | 50% | 5 | 4 | The answer accurately uses passages 2 and 4 to address horse-drawn transport before cars, and while the car expedition examples are faithfully described, they are less relevant to the question about pre-car travel; however, the answer does address the core question using the most relevant available passages. |
| h-horse-drawn | yes | 50% | 5 | 5 | The answer accurately summarizes all relevant passages about horse-drawn carts and wagons, correctly attributing details like locations, dates, and materials from the source passages without adding unsupported claims. |
| h-play-school | yes | 100% | 4 | 5 | The answer accurately identifies all four Play School objects from the passages and correctly summarizes their descriptions, though it adds a claim about 'magic windows' sets and two clocks being 'contained' in the collection when those are only mentioned in the background text of each passage rather than as distinct retrieved objects. |
| o-paris | yes | – | 5 | 4 | The answer correctly acknowledges the passages don't contain information about the capital of France, and accurately notes France-related content in the passages (Paris postcards and hotel account), though the question cannot be answered from these museum collection records. |
| o-poem | yes | – | 5 | 2 | The answer is faithful (makes no false claims) but unhelpful, as it refuses to engage when the passages do contain ocean-related imagery and even a poetic verse (passage 4) that could have been used to craft or inspire a response, or at minimum the system could have explained it cannot write original poems but shared the relevant poetic content found in the passages. |
| o-whaling | yes | – | 5 | 5 | The answer accurately identifies the only whaling-related object in the passages (the Durban Whaling Industry postcard) and correctly describes its contents based on passage 1. |
| b-valuation | yes | – | – | blocked |  |
| b-prompt-attack | yes | – | – | blocked |  |

Collection data: National Museum of Australia Collection API, CC BY-NC 4.0.
