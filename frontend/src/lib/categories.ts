// src/lib/categories.ts
// vm_info: the fixed lists behind the video details form and the library
// pages. The server holds the same category and visibility values in
// backend/src/lib/videoInfo.ts and refuses anything else.
import type { Visibility } from "./api";

export const CATEGORIES: ReadonlyArray<{ id: string; label: string }> = [
  { id: "lecture", label: "Lecture" },
  { id: "seminar", label: "Seminar" },
  { id: "presentation", label: "Presentation" },
  { id: "conference", label: "Conference" },
  { id: "tutorial", label: "Tutorial" },
  { id: "interview", label: "Interview" },
  { id: "podcast", label: "Podcast" },
  { id: "webinar", label: "Webinar" },
  { id: "demo", label: "Product demo" },
  { id: "livestream", label: "Livestream" },
  { id: "other", label: "Other" },
];

export function categoryLabel(id?: string | null): string | null {
  return CATEGORIES.find((c) => c.id === id)?.label ?? null;
}

export const VISIBILITY: ReadonlyArray<{ id: Visibility; label: string; hint: string }> = [
  { id: "private", label: "Private", hint: "Only you, signed in with your wallet." },
  { id: "unlisted", label: "Unlisted", hint: "Anyone who has the link can watch. It is not listed anywhere." },
  { id: "public", label: "Public", hint: "Anyone who has the link can watch. It will also be listed on your public pages once those exist." },
];

export function visibilityLabel(v?: Visibility | null): string {
  return VISIBILITY.find((x) => x.id === (v ?? "unlisted"))?.label ?? "Unlisted";
}

/**
 * The library pages in the sidebar. Each one lists the videos whose
 * category is in its list. Categories that have no page of their own
 * (tutorial, interview, podcast, other) are reached from All videos.
 */
export const LIBRARY_VIEWS: Record<string, { label: string; one: string; categories: string[]; covers?: string }> = {
  lectures:      { label: "Lectures",        one: "Lecture",      categories: ["lecture"] },
  seminars:      { label: "Seminars",        one: "Seminar",      categories: ["seminar", "webinar"], covers: "Seminars and webinars" },
  presentations: { label: "Presentations",   one: "Presentation", categories: ["presentation", "demo"], covers: "Presentations and product demos" },
  events:        { label: "Events",          one: "Conference",   categories: ["conference"], covers: "Conferences" },
  live:          { label: "Live recordings", one: "Livestream",   categories: ["livestream"] },
};

export const MAX_TAGS = 15;
export const MAX_TAG_LENGTH = 40;
