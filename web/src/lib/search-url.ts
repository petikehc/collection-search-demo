/**
 * The results page's parameters, read from and written to its URL. One place for both, so
 * every link (filters, chips, pages, the selected object) keeps the rest of the search.
 */
export interface SearchState {
  q?: string;
  type?: string;
  place?: string;
  yearFrom?: number;
  yearTo?: number;
  hasImage?: boolean;
  page?: number;
  /** The object shown in the right-hand pane. */
  id?: string;
}

const int = (value: string | null) => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : undefined;
};

export function readSearch(params: URLSearchParams): SearchState {
  const text = (name: string) => params.get(name)?.trim() || undefined;
  const id = text('id');
  return {
    q: text('q'),
    type: text('type'),
    place: text('place'),
    yearFrom: int(params.get('yearFrom')),
    yearTo: int(params.get('yearTo')),
    hasImage: params.get('hasImage') === 'true' ? true : undefined,
    page: int(params.get('page')),
    id: id && /^[0-9]{1,12}$/.test(id) ? id : undefined,
  };
}

/** `/search?…` for this state with some fields changed (undefined removes one). */
export function searchUrl(state: SearchState, changes: Partial<SearchState> = {}): string {
  const next = { ...state, ...changes };
  const params = new URLSearchParams();
  for (const key of [
    'q',
    'type',
    'place',
    'yearFrom',
    'yearTo',
    'hasImage',
    'page',
    'id',
  ] as const) {
    const value = next[key];
    if (value !== undefined && value !== '' && value !== false) params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `/search?${query}` : '/search';
}

/** Changing a filter starts again at page 1 with nothing selected. */
export function withFilter(state: SearchState, changes: Partial<SearchState>): string {
  return searchUrl(state, { page: undefined, id: undefined, ...changes });
}
