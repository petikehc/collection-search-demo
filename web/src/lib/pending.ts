/** A bookmark asked for while signed out, kept through sign-in and saved on the way back. */
export interface PendingBookmark {
  objectId: string;
  title: string;
}

/**
 * Reads one from a bookmark form, or returns undefined. Checked like the API checks it (digits
 * for the ID, 1–300 characters of title), because the sign-in cookie that carries it is set
 * from what the browser sent.
 */
export function parsePendingBookmark(form: FormData): PendingBookmark | undefined {
  if (form.get('action') !== 'add') return undefined;
  const objectId = String(form.get('objectId') ?? '');
  const title = String(form.get('title') ?? '').trim();
  if (!/^[0-9]{1,12}$/.test(objectId) || title.length < 1 || title.length > 300) return undefined;
  return { objectId, title };
}
