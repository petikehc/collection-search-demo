/** Clients always query the alias, never a concrete index, so reindexing needs no client change. */
export const OBJECTS_ALIAS = 'objects';

/**
 * Hybrid search (docs/adr/0014-hybrid-search.md): the search pipeline that combines
 * keyword and vector scores, set as the objects index's default pipeline.
 */
export const HYBRID_PIPELINE = 'objects-hybrid';
/** Weights for [keyword, vector] scores after L2 normalisation, chosen with `pnpm eval:search`. */
export const HYBRID_WEIGHTS = [0.6, 0.4];
/** Nearest neighbours the vector half contributes. */
export const HYBRID_NEIGHBOURS = 30;
/** How many keyword hits are ranked against the neighbours; also the deepest result reachable. */
export const HYBRID_DEPTH = 200;

/** Titan Text Embeddings V2, hosted in Sydney itself (docs/adr/0012-data-residency.md). */
export const EMBEDDING_MODEL_ID = 'amazon.titan-embed-text-v2:0';
export const EMBEDDING_DIMENSIONS = 1024;
