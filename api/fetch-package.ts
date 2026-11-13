/**
 * Fallback download proxy for "Open from URL", used only when a site blocks direct browser
 * downloads (no CORS headers). Kept deliberately small and locked down for the Hobby plan:
 *   - only requests made from vRO Peekage itself (Sec-Fetch-Site: same-origin)
 *   - only public http(s) addresses: localhost, private, link-local and other internal ranges
 *     are refused, and every redirect hop is checked again
 *   - at most 4.4 MB (Vercel's response limit is 4.5 MB), 20 s, and the file must be a zip
 *   - responses are cached at the CDN for an hour, so a popular share link costs one call an hour
 * Nothing is stored; the bytes are streamed through to the browser, which parses them locally.
 *
 * Runs on Vercel (as /api/fetch-package) and on Cloudflare Pages (functions/api/fetch-package.ts
 * calls GET below). Host names are checked with resolve4/resolve6 rather than lookup, because
 * Cloudflare's Workers runtime does not implement dns.lookup.
 */
import { resolve4, resolve6 } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_BYTES = 4.4 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 20_000;

function fail(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function privateV4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

function privateIp(ip: string): boolean {
  if (isIP(ip) === 4) return privateV4(ip);
  const v6 = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped) return privateV4(mapped[1]);
  return v6 === "::" || v6 === "::1" || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || /^ff/.test(v6);
}

async function assertPublic(u: URL): Promise<void> {
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Only http and https links are supported.");
  if (u.username || u.password) throw new Error("Links with a user name or password aren't supported.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.local|.*\.internal|.*\.lan)$/i.test(host)) throw new Error("That address isn't publicly reachable.");
  const addrs = isIP(host) ? [host] : await resolveAll(host);
  if (!addrs.length) throw new Error("Couldn't find that address.");
  if (addrs.some(privateIp)) throw new Error("That address isn't publicly reachable.");
}

// Every IPv4 and IPv6 address the name resolves to; a name with only one kind still works.
async function resolveAll(host: string): Promise<string[]> {
  const [v4, v6] = await Promise.allSettled([resolve4(host), resolve6(host)]);
  return [
    ...(v4.status === "fulfilled" ? v4.value : []),
    ...(v6.status === "fulfilled" ? v6.value : []),
  ];
}

export async function GET(request: Request): Promise<Response> {
  // Only serve vRO Peekage's own pages, so the proxy can't be borrowed by other sites.
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return fail(403, "This proxy only serves vRO Peekage.");

  const raw = new URL(request.url).searchParams.get("url");
  if (!raw) return fail(400, "Missing ?url=");
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return fail(400, "That isn't a valid URL.");
  }

  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let res: Response | undefined;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertPublic(target);
      res = await fetch(target, { redirect: "manual", signal, headers: { "user-agent": "vRO-Peekage/1 (+https://vro-peekage.vercel.app)" } });
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (!loc) break;
      target = new URL(loc, target);
      res = undefined;
    }
  } catch (e) {
    return fail(502, (e as Error).name === "TimeoutError" ? "The download took too long." : (e as Error).message || "Couldn't reach that address.");
  }
  if (!res) return fail(502, "Too many redirects.");
  if (!res.ok || !res.body) return fail(502, `The site answered ${res.status} ${res.statusText}.`);

  const declared = Number(res.headers.get("content-length") || 0);
  if (declared > MAX_BYTES) return fail(413, "too-large");

  // Read with a hard cap, then check it really is a zip ("PK" signature).
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      return fail(413, "too-large");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    body.set(c, off);
    off += c.byteLength;
  }
  if (size < 4 || body[0] !== 0x50 || body[1] !== 0x4b) return fail(415, "That link didn't return a .package (zip) file.");

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(size),
      "cache-control": "public, max-age=0, s-maxage=3600",
      "x-final-url": target.toString(),
    },
  });
}
