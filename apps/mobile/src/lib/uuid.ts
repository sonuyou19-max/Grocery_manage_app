/**
 * RFC-4122-shaped v4 UUID. Not cryptographically strong, but more than
 * sufficient for client-generated row ids: collisions across a household's
 * items are astronomically unlikely and the database enforces PK uniqueness.
 * Generating ids on the client lets an optimistic insert use the same id the
 * server row will have — no reconciliation needed.
 */
export function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
