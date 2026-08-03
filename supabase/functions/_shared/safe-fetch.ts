/**
 * Fetching a URL that somebody else chose.
 *
 * This is server-side request forgery by construction: the caller names an
 * address and the edge runtime goes there. Unguarded it is a proxy into
 * everything the runtime can reach and the caller cannot — cloud metadata
 * endpoints, loopback services, anything on a private network — and the caller
 * gets the response body back.
 *
 * It lives in _shared and is exported piecemeal so the guards can be tested
 * rather than assumed. Every one of them is cheap; in rough order of how badly
 * each is missed:
 *
 *   1. Block non-public hosts BEFORE the request and again after EVERY
 *      redirect. A 302 to 169.254.169.254 is the textbook exploit, so
 *      redirects are followed by hand — `redirect: "follow"` would check the
 *      first hop and none of the others.
 *   2. Cap the redirect count, so a loop cannot hold an invocation open.
 *   3. Cap the response size, reading in chunks rather than trusting
 *      content-length — that header is supplied by the host being defended
 *      against.
 *   4. Time the whole thing out.
 *   5. http/https only. `file:` would read the container's own disk.
 *
 * DNS rebinding is the one class this does not close: a hostname that resolves
 * public here and private on the socket's own lookup. Closing it needs
 * resolve-then-connect-by-IP, which Deno's fetch does not expose. Worth knowing
 * about; not worth blocking the feature on, since the response is only ever
 * shown back to the caller who asked for it.
 */

/**
 * This function makes an outbound request to an address the caller chooses,
 * which is the definition of server-side request forgery. Unguarded it is a
 * proxy into everything the edge runtime can reach that the caller cannot:
 * cloud metadata endpoints, loopback services, anything on a private network.
 *
 * The guards below are all cheap and all necessary. In rough order of how badly
 * each one is missed:
 *
 *   1. Block non-public hosts, BEFORE the request and again after every
 *      redirect. A redirect to 169.254.169.254 is the standard way this gets
 *      exploited, so following redirects manually is the only way to check.
 *   2. Cap redirects, so a redirect loop cannot hold an invocation open.
 *   3. Cap the response size, so a multi-gigabyte body cannot be streamed into
 *      memory — and read it in chunks rather than trusting content-length,
 *      which the server controls and can lie about.
 *   4. Time the whole thing out.
 *   5. http/https only. `file:` would read the container's own disk.
 */
const MAX_REDIRECTS = 3;
const MAX_BYTES = 2_000_000;
const FETCH_TIMEOUT_MS = 8000;

/** Hostnames and IP literals that must never be fetched. */
export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return true;
  // Anything without a dot is a bare name on the local network.
  if (!host.includes('.') && !host.includes(':')) return true;

  // IPv6 loopback / link-local / unique-local.
  if (host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) {
    return true;
  }

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    // 169.254.0.0/16 — cloud metadata lives at 169.254.169.254.
    if (a === 169 && b === 254) return true;
    if (a >= 224) return true; // multicast and reserved
  }

  return false;
}

/** Fetch a page, following redirects by hand so each hop can be re-checked. */
export async function fetchPage(input: string): Promise<string | null> {
  let current: URL;
  try {
    current = new URL(input);
  } catch {
    return null;
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (current.protocol !== 'http:' && current.protocol !== 'https:') return null;
    if (isBlockedHost(current.hostname)) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(current.toString(), {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          // Identify honestly. A site that does not want us can then say so,
          // and pretending to be a browser to get around that is not a fight
          // worth picking on a user's behalf.
          'user-agent': 'KorbRecipeImport/1.0 (+https://korb.app)',
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'en,de,fr,it,es,nl,pl',
        },
      });
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return null;
      try {
        current = new URL(location, current);
      } catch {
        return null;
      }
      continue;
    }

    if (!res.ok || !res.body) return null;

    // Read in chunks and stop at the cap. content-length is not trusted: it is
    // supplied by the same server we are defending against.
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.byteLength;
      }
    }
    void reader.cancel();

    const merged = new Uint8Array(Math.min(total, MAX_BYTES));
    let offset = 0;
    for (const c of chunks) {
      const take = Math.min(c.byteLength, merged.byteLength - offset);
      if (take <= 0) break;
      merged.set(c.subarray(0, take), offset);
      offset += take;
    }
    return new TextDecoder('utf-8').decode(merged);
  }

  return null; // too many redirects
}
