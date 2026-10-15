/**
 * Re-sign a .package with a new (or reused) signing identity.
 *
 * Package signing, as found in Orchestrator 8.x/9.x exports:
 *   - every file in the package has a signature at signatures/<same path>: a raw RSA
 *     PKCS#1 v1.5 signature over the file's bytes with SHA-256
 *   - the signer's certificate is stored as certificates/<RFC 2253 subject>.cer, and is signed too
 *   - dunes-meta-inf records the signer (pkg-signer) and owner (pkg-owner) by that subject
 * Layout written here matches Orchestrator's own: content files, the certificate, then the
 * signatures in the same order, the certificate's signature last.
 */
import JSZip from "jszip";
import { decodeSame } from "./rebuild";
import type { SigningIdentity } from "./x509";

export interface ResignOptions {
  /** Also record the new identity as the package owner (pkg-owner). Default: keep the original owner. */
  setOwner?: boolean;
}

export interface ResignResult {
  blob: Blob;
  files: number;
  previousSigner?: string;
}

const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function setEntry(xml: string, key: string, value: string): string {
  const re = new RegExp(`(<entry key="${key}">)[\\s\\S]*?(</entry>)`);
  if (re.test(xml)) return xml.replace(re, `$1${xmlEsc(value)}$2`);
  return xml.replace(/<\/properties>/, `<entry key="${key}">${xmlEsc(value)}</entry>\n</properties>`);
}

export async function resignPackage(
  input: ArrayBuffer | Uint8Array | JSZip,
  id: SigningIdentity,
  opts: ResignOptions = {},
  onProgress?: (done: number, total: number) => void,
): Promise<ResignResult> {
  const zip = input instanceof JSZip ? input : await JSZip.loadAsync(input);
  const entries = Object.values(zip.files).filter((f) => !f.dir && !f.name.startsWith("signatures/") && !f.name.startsWith("certificates/"));
  if (!entries.some((f) => f.name === "dunes-meta-inf")) throw new Error("This isn't an Orchestrator package (no dunes-meta-inf).");

  const sign = async (b: Uint8Array) => new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", id.signKey, b as BufferSource));
  const out = new JSZip();
  const signed: [string, Uint8Array][] = [];
  let previousSigner: string | undefined;
  const total = entries.length * 2 + 2;
  let done = 0;

  for (const f of entries) {
    let bytes = await f.async("uint8array");
    if (f.name === "dunes-meta-inf") {
      const { text, encode } = decodeSame(bytes);
      previousSigner = /<entry key="pkg-signer">([\s\S]*?)<\/entry>/.exec(text)?.[1];
      let t = setEntry(text, "pkg-signer", id.subjectName);
      if (opts.setOwner) t = setEntry(t, "pkg-owner", id.subjectName);
      bytes = encode(t);
    }
    out.file(f.name, bytes, { date: f.date, binary: true, createFolders: false });
    signed.push([f.name, bytes]);
    onProgress?.(++done, total);
  }

  const certPath = `certificates/${id.subjectName}.cer`;
  out.file(certPath, id.certDer, { binary: true, createFolders: false });
  signed.push([certPath, id.certDer]);
  onProgress?.(++done, total);

  for (const [name, bytes] of signed) {
    out.file(`signatures/${name}`, await sign(bytes), { binary: true, createFolders: false });
    onProgress?.(++done, total);
  }

  const blob = await out.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 }, mimeType: "application/zip" });
  onProgress?.(total, total);
  return { blob, files: entries.length, previousSigner };
}

/** "com.example.package" -> "com.example-signed.package" (also replaces an existing -modified/-signed suffix sensibly) */
export function signedFileName(fileName: string): string {
  return fileName.replace(/(-signed)?(\.package)?$/i, "-signed.package");
}
