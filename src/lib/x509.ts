/**
 * Minimal X.509 support for package signing, using only the browser's Web Crypto API.
 *
 * Builds the same kind of self-signed certificate Orchestrator creates for itself (and that the
 * vROCertTool keytool recipe produces): RSA 2048, SHA512withRSA, key usage digitalSignature +
 * keyEncipherment, extended key usage serverAuth, valid for 10 years.
 */

/* ------------------------------------------------------------------ */
/* DER encoding                                                        */
/* ------------------------------------------------------------------ */

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function len(n: number): Uint8Array {
  if (n < 0x80) return Uint8Array.of(n);
  const bytes: number[] = [];
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>= 8;
  }
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

const tlv = (tag: number, ...content: Uint8Array[]) => {
  const body = concat(...content);
  return concat(Uint8Array.of(tag), len(body.length), body);
};
const seq = (...c: Uint8Array[]) => tlv(0x30, ...c);
const set = (...c: Uint8Array[]) => tlv(0x31, ...c);
const utf8 = (s: string) => tlv(0x0c, new TextEncoder().encode(s));
const printable = (s: string) => tlv(0x13, new TextEncoder().encode(s));
const bool = (v: boolean) => tlv(0x01, Uint8Array.of(v ? 0xff : 0));
const octets = (b: Uint8Array) => tlv(0x04, b);
const bits = (b: Uint8Array, unused = 0) => tlv(0x03, Uint8Array.of(unused), b);
const nul = () => Uint8Array.of(0x05, 0x00);
const explicit = (n: number, c: Uint8Array) => tlv(0xa0 | n, c);

function integer(b: Uint8Array): Uint8Array {
  let i = 0;
  while (i < b.length - 1 && b[i] === 0) i++;
  let v: Uint8Array = b.slice(i);
  if (v[0] & 0x80) v = concat(Uint8Array.of(0), v);
  return tlv(0x02, v);
}

function oid(dotted: string): Uint8Array {
  const p = dotted.split(".").map(Number);
  const out = [40 * p[0] + p[1]];
  for (const n of p.slice(2)) {
    const stack = [n & 0x7f];
    let v = Math.floor(n / 128);
    while (v > 0) {
      stack.unshift((v & 0x7f) | 0x80);
      v = Math.floor(v / 128);
    }
    out.push(...stack);
  }
  return tlv(0x06, Uint8Array.from(out));
}

function time(d: Date): Uint8Array {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  const y = d.getUTCFullYear();
  const body = `${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  // UTCTime until 2049, GeneralizedTime after (RFC 5280)
  return y < 2050 ? tlv(0x17, new TextEncoder().encode(p(y % 100) + body)) : tlv(0x18, new TextEncoder().encode(p(y, 4) + body));
}

const OID = {
  CN: "2.5.4.3",
  OU: "2.5.4.11",
  O: "2.5.4.10",
  L: "2.5.4.7",
  ST: "2.5.4.8",
  C: "2.5.4.6",
  sha512WithRSA: "1.2.840.113549.1.1.13",
  keyUsage: "2.5.29.15",
  extKeyUsage: "2.5.29.37",
  serverAuth: "1.3.6.1.5.5.7.3.1",
  subjectKeyId: "2.5.29.14",
} as const;

export interface Subject {
  CN: string;
  OU?: string;
  O?: string;
  L?: string;
  ST?: string;
  C?: string;
}

/** Name in the same attribute order Orchestrator uses: CN, OU, O (then L, ST, C). */
function encodeName(s: Subject): Uint8Array {
  const rdns: Uint8Array[] = [];
  const add = (key: keyof typeof OID, value?: string) => {
    if (!value) return;
    rdns.push(set(seq(oid(OID[key]), key === "C" ? printable(value) : utf8(value))));
  };
  add("CN", s.CN);
  add("OU", s.OU);
  add("O", s.O);
  add("L", s.L);
  add("ST", s.ST);
  add("C", s.C);
  return seq(...rdns);
}

/** RFC 2253 string (reverse attribute order), the form Orchestrator writes in dunes-meta-inf and the .cer name. */
export function rfc2253(s: Subject): string {
  const esc = (v: string) => v.replace(/([,+"\\<>;=])/g, "\\$1").replace(/^([ #])/, "\\$1").replace(/ $/, "\\ ");
  const parts: string[] = [];
  for (const k of ["C", "ST", "L", "O", "OU", "CN"] as const) if (s[k]) parts.push(`${k}=${esc(s[k]!)}`);
  return parts.join(",");
}

/* ------------------------------------------------------------------ */
/* Certificate generation                                              */
/* ------------------------------------------------------------------ */

export interface SigningIdentity {
  /** RSASSA-PKCS1-v1_5 / SHA-256 key, used to sign package files */
  signKey: CryptoKey;
  /** DER certificate */
  certDer: Uint8Array;
  /** RFC 2253 subject, e.g. "O=Company,OU=Org,CN=Pkg Sign Team" */
  subjectName: string;
  notBefore: Date;
  notAfter: Date;
  /** PKCS#8 private key, only when generated here (so it can be downloaded) */
  pkcs8?: Uint8Array;
  fingerprintSha1: string;
}

const RSA_PARAMS = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: Uint8Array.of(1, 0, 1) } as const;

async function sha1Hex(b: Uint8Array): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-1", b as BufferSource));
  return [...h].map((x) => x.toString(16).padStart(2, "0")).join(":");
}

/** Generate a new RSA-2048 key and a self-signed certificate valid for `years` years. */
export async function createSigningIdentity(subject: Subject, years = 10): Promise<SigningIdentity> {
  const pair = (await crypto.subtle.generateKey({ ...RSA_PARAMS, hash: "SHA-512" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));

  const notBefore = new Date(Math.floor(Date.now() / 1000) * 1000);
  const notAfter = new Date(notBefore); notAfter.setUTCFullYear(notAfter.getUTCFullYear() + years); // exactly N calendar years
  const serial = crypto.getRandomValues(new Uint8Array(16));
  serial[0] &= 0x7f;
  const keyId = new Uint8Array(await crypto.subtle.digest("SHA-1", spki)).slice(0, 20);
  const name = encodeName(subject);
  const algo = seq(oid(OID.sha512WithRSA), nul());

  const extensions = explicit(
    3,
    seq(
      // digitalSignature (bit 0) + keyEncipherment (bit 2) -> 1010 0000, 5 unused bits
      seq(oid(OID.keyUsage), bool(true), octets(bits(Uint8Array.of(0xa0), 5))),
      seq(oid(OID.extKeyUsage), bool(true), octets(seq(oid(OID.serverAuth)))),
      seq(oid(OID.subjectKeyId), octets(octets(keyId))),
    ),
  );
  const tbs = seq(explicit(0, integer(Uint8Array.of(2))), integer(serial), algo, name, seq(time(notBefore), time(notAfter)), name, spki, extensions);
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, tbs as BufferSource));
  const certDer = seq(tbs, algo, bits(signature));

  const signKey = await crypto.subtle.importKey("pkcs8", pkcs8 as BufferSource, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  return { signKey, certDer, subjectName: rfc2253(subject), notBefore, notAfter, pkcs8, fingerprintSha1: await sha1Hex(certDer) };
}

/* ------------------------------------------------------------------ */
/* Reusing an existing key + certificate (PEM)                         */
/* ------------------------------------------------------------------ */

function pemBlocks(text: string): { label: string; der: Uint8Array }[] {
  const out: { label: string; der: Uint8Array }[] = [];
  const re = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/g;
  for (let m; (m = re.exec(text)); ) {
    const bin = atob(m[2].replace(/\s+/g, ""));
    out.push({ label: m[1], der: Uint8Array.from(bin, (c) => c.charCodeAt(0)) });
  }
  return out;
}

export function toPem(label: string, der: Uint8Array): string {
  let bin = "";
  for (const b of der) bin += String.fromCharCode(b);
  const b64 = btoa(bin).replace(/.{1,64}/g, "$&\n");
  return `-----BEGIN ${label}-----\n${b64}-----END ${label}-----\n`;
}

/** Tiny DER reader: enough to pull subject and validity out of a certificate. */
interface Node {
  tag: number;
  start: number;
  hdr: number;
  len: number;
}
function read(b: Uint8Array, pos: number): Node {
  const tag = b[pos];
  let l = b[pos + 1];
  let hdr = 2;
  if (l & 0x80) {
    const n = l & 0x7f;
    l = 0;
    for (let i = 0; i < n; i++) l = (l << 8) | b[pos + 2 + i];
    hdr += n;
  }
  return { tag, start: pos, hdr, len: l };
}
function children(b: Uint8Array, n: Node): Node[] {
  const out: Node[] = [];
  let p = n.start + n.hdr;
  const end = p + n.len;
  while (p < end) {
    const c = read(b, p);
    out.push(c);
    p = c.start + c.hdr + c.len;
  }
  return out;
}
const body = (b: Uint8Array, n: Node) => b.slice(n.start + n.hdr, n.start + n.hdr + n.len);

function decodeOid(b: Uint8Array): string {
  const out = [Math.floor(b[0] / 40), b[0] % 40];
  let v = 0;
  for (const x of b.slice(1)) {
    v = v * 128 + (x & 0x7f);
    if (!(x & 0x80)) {
      out.push(v);
      v = 0;
    }
  }
  return out.join(".");
}

function parseTime(b: Uint8Array, n: Node): Date {
  const s = new TextDecoder().decode(body(b, n));
  const full = n.tag === 0x17 ? (Number(s.slice(0, 2)) < 50 ? "20" : "19") + s : s;
  return new Date(Date.UTC(+full.slice(0, 4), +full.slice(4, 6) - 1, +full.slice(6, 8), +full.slice(8, 10), +full.slice(10, 12), +full.slice(12, 14)));
}

export function readCertificate(der: Uint8Array): { subject: Subject; subjectName: string; notBefore: Date; notAfter: Date } {
  const cert = read(der, 0);
  const tbs = children(der, cert)[0];
  let f = children(der, tbs);
  if (f[0].tag === 0xa0) f = f.slice(1); // version
  const [, , , validity, subjectNode] = f;
  const [nb, na] = children(der, validity);
  const names: Record<string, string> = { [OID.CN]: "CN", [OID.OU]: "OU", [OID.O]: "O", [OID.L]: "L", [OID.ST]: "ST", [OID.C]: "C" };
  const subject: Subject = { CN: "" };
  for (const rdn of children(der, subjectNode)) {
    for (const atv of children(der, rdn)) {
      const [o, v] = children(der, atv);
      const key = names[decodeOid(body(der, o))];
      if (key) (subject as unknown as Record<string, string>)[key] = new TextDecoder().decode(body(der, v));
    }
  }
  return { subject, subjectName: rfc2253(subject), notBefore: parseTime(der, nb), notAfter: parseTime(der, na) };
}

/** Load an existing identity from PEM text containing an unencrypted PKCS#8 private key and its certificate. */
export async function loadSigningIdentity(pemText: string): Promise<SigningIdentity> {
  const blocks = pemBlocks(pemText);
  const keyBlock = blocks.find((b) => b.label === "PRIVATE KEY");
  const certBlock = blocks.find((b) => b.label === "CERTIFICATE");
  if (blocks.some((b) => b.label === "ENCRYPTED PRIVATE KEY" || b.label === "RSA PRIVATE KEY") && !keyBlock)
    throw new Error("The private key must be an unencrypted PKCS#8 key (BEGIN PRIVATE KEY). Convert it with: openssl pkcs8 -topk8 -nocrypt -in key.pem -out key-pkcs8.pem");
  if (!keyBlock) throw new Error("No private key found (expected a -----BEGIN PRIVATE KEY----- block).");
  if (!certBlock) throw new Error("No certificate found (expected a -----BEGIN CERTIFICATE----- block).");
  const signKey = await crypto.subtle.importKey("pkcs8", keyBlock.der as BufferSource, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const info = readCertificate(certBlock.der);
  // make sure the key belongs to the certificate: sign and verify a probe with the certificate's public key
  const spkiNode = (() => {
    const cert = read(certBlock.der, 0);
    let f = children(certBlock.der, children(certBlock.der, cert)[0]);
    if (f[0].tag === 0xa0) f = f.slice(1);
    const n = f[5];
    return certBlock.der.slice(n.start, n.start + n.hdr + n.len);
  })();
  const pub = await crypto.subtle.importKey("spki", spkiNode as BufferSource, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const probe = new TextEncoder().encode("vro-peekage-key-check");
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", signKey, probe);
  if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", pub, sig, probe))) throw new Error("The private key doesn't belong to this certificate.");
  return { signKey, certDer: certBlock.der, subjectName: info.subjectName, notBefore: info.notBefore, notAfter: info.notAfter, fingerprintSha1: await sha1Hex(certBlock.der) };
}
