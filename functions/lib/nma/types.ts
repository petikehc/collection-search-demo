/**
 * The parts of the Museum's "simple" JSON format that we read.
 * Field docs: https://github.com/NationalMuseumAustralia/Collection-API/wiki
 * Almost every field is optional in practice, so everything except id is typed as optional.
 */
export interface NmaPage<T> {
  data: T[];
  meta?: { results?: number };
  links?: { next?: string };
}

export interface NmaRef {
  id?: string;
  type?: string;
  title?: string;
  roleName?: string;
  interactionType?: string;
}

export interface NmaTemporal extends NmaRef {
  startDate?: string;
  endDate?: string;
}

export interface NmaMediaVersion {
  type?: string;
  version?: string; // "thumbnail image" | "preview image" | "large image"
  identifier?: string; // image URL on collectionsearch.nma.gov.au
}

export interface NmaMedia {
  id?: string;
  type?: string;
  rights?: string;
  rightsTitle?: string;
  hasVersion?: NmaMediaVersion[];
}

export interface NmaObject {
  id: string;
  type?: string;
  title?: string;
  additionalType?: string[];
  collection?: NmaRef;
  identifier?: string;
  medium?: NmaRef[];
  physicalDescription?: string;
  contentDescription?: string;
  description?: string;
  significanceStatement?: string;
  creator?: NmaRef[];
  spatial?: NmaRef[];
  temporal?: NmaTemporal[];
  hasVersion?: NmaMedia[];
  _meta?: {
    modified?: string;
    issued?: string;
    hasFormat?: string; // the record's page on the Museum's website
    copyright?: string;
    licence?: string;
  };
}
