import type { NmaMedia, NmaObject } from './types.js';

/** Media without a rights statement are treated as all rights reserved. */
export const DEFAULT_IMAGE_RIGHTS = 'All Rights Reserved';

export interface CollectionImage {
  /** Hotlinked from the Museum (its terms forbid serving copies). */
  thumbnailUrl?: string;
  previewUrl?: string;
  rightsTitle: string;
  rightsUrl?: string;
}

/** Our own shape for one collection object, used by the search index and the Knowledge Base. */
export interface CollectionObject {
  id: string;
  title: string;
  types: string[];
  collection?: string;
  accessionNumber?: string;
  materials: string[];
  places: string[];
  creators: string[];
  yearStart?: number;
  yearEnd?: number;
  dateLabel?: string;
  physicalDescription?: string;
  contentDescription?: string;
  description?: string;
  /** Usually describes the whole collection the object belongs to, not the object itself. */
  significanceStatement?: string;
  images: CollectionImage[];
  /** The record's page on the Museum's website. The terms require linking back to it. */
  sourceUrl: string;
  /** When the Museum last changed the record. */
  modified?: string;
  licence?: string;
  /** When we fetched it, shown in the UI so stale data is visible. */
  retrievedAt: string;
}

/**
 * Converts a raw API record into a CollectionObject.
 * Returns null for records we can't show in line with the terms (no title, or no link back).
 */
export function normaliseObject(raw: NmaObject, retrievedAt: string): CollectionObject | null {
  const title = clean(raw.title);
  const sourceUrl = clean(raw._meta?.hasFormat);
  if (!title || !sourceUrl) return null;

  const temporal = raw.temporal ?? [];
  const starts = temporal.map((t) => parseYear(t.startDate)).filter(isNumber);
  const ends = temporal.map((t) => parseYear(t.endDate ?? t.startDate)).filter(isNumber);

  return {
    id: raw.id,
    title,
    types: uniqueTitles(raw.additionalType?.map((title) => ({ title }))),
    collection: clean(raw.collection?.title),
    accessionNumber: clean(raw.identifier),
    materials: uniqueTitles(raw.medium),
    places: uniqueTitles(raw.spatial),
    creators: uniqueTitles(raw.creator),
    yearStart: starts.length ? Math.min(...starts) : undefined,
    yearEnd: ends.length ? Math.max(...ends) : undefined,
    dateLabel: clean(temporal[0]?.title),
    physicalDescription: clean(raw.physicalDescription),
    contentDescription: clean(raw.contentDescription),
    description: clean(raw.description),
    significanceStatement: clean(raw.significanceStatement),
    images: (raw.hasVersion ?? []).filter(isStillImage).map(toImage).filter(hasUrl),
    sourceUrl,
    modified: clean(raw._meta?.modified),
    licence: clean(raw._meta?.licence),
    retrievedAt,
  };
}

/** First four-digit year in a date string such as "1926", "1926-05-12" or "c. 1926". */
export function parseYear(value: string | undefined): number | undefined {
  const match = value?.match(/\b(\d{4})\b/);
  return match ? Number(match[1]) : undefined;
}

function toImage(media: NmaMedia): CollectionImage {
  const version = (name: string) =>
    clean(media.hasVersion?.find((v) => v.version === name)?.identifier);
  return {
    thumbnailUrl: version('thumbnail image'),
    previewUrl: version('preview image'),
    rightsTitle: clean(media.rightsTitle) ?? DEFAULT_IMAGE_RIGHTS,
    rightsUrl: clean(media.rights),
  };
}

function isStillImage(media: NmaMedia): boolean {
  return media.type === 'StillImage';
}

function hasUrl(image: CollectionImage): boolean {
  return Boolean(image.thumbnailUrl || image.previewUrl);
}

function uniqueTitles(refs: { title?: string }[] | undefined): string[] {
  return [...new Set((refs ?? []).map((r) => clean(r.title)).filter(isString))];
}

/** Trims and collapses whitespace; empty strings become undefined. */
function clean(value: string | undefined): string | undefined {
  const text = value?.replace(/\s+/g, ' ').trim();
  return text || undefined;
}

function isString(value: string | undefined): value is string {
  return value !== undefined;
}

function isNumber(value: number | undefined): value is number {
  return value !== undefined;
}
