import { useRef, useState } from "react";
import JSZip from "jszip";
import { createSigningIdentity, loadSigningIdentity, readCertificate, toPem, type SigningIdentity, type Subject } from "../lib/x509";
import { resignPackage, signedFileName } from "../lib/resign";
import { formatBytes } from "../lib/parser";

/** Characters that would end up escaped in the certificate's file name inside the package. */
const BAD_CHARS = /[,+"\\<>;=#/]/;

function download(name: string, data: Blob | Uint8Array | string, type = "application/octet-stream") {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const fmtDate = (d: Date) => d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

interface Done {
  fileName: string;
  blob: Blob;
  files: number;
  pkgName: string;
  previousSigner?: string;
  id: SigningIdentity;
  generated: boolean;
}

export function SignTool({ onHome }: { onHome: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [pkgName, setPkgName] = useState("");
  const [currentSigner, setCurrentSigner] = useState<{ name: string; until?: Date } | null>(null);
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [subject, setSubject] = useState<Required<Pick<Subject, "CN" | "OU" | "O">> & { C: string }>({ CN: "vRO Package Signer", OU: "Automation", O: "Orchestrator", C: "" });
  const [pem, setPem] = useState("");
  const [setOwner, setSetOwner] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const pkgInput = useRef<HTMLInputElement>(null);
  const pemInput = useRef<HTMLInputElement>(null);

  const fieldErrors: Partial<Record<keyof typeof subject, string>> = {};
  for (const k of ["CN", "OU", "O"] as const) if (BAD_CHARS.test(subject[k])) fieldErrors[k] = 'Avoid , + " \\ < > ; = # /';
  if (!subject.CN.trim()) fieldErrors.CN = "Required";
  if (subject.C && !/^[A-Za-z]{2}$/.test(subject.C)) fieldErrors.C = "Two letters, e.g. IN";
  const formOk = mode === "new" ? Object.keys(fieldErrors).length === 0 : pem.includes("PRIVATE KEY") && pem.includes("CERTIFICATE");

  const pickPackage = async (f: File) => {
    setError(null);
    setDone(null);
    try {
      const zip = await JSZip.loadAsync(await f.arrayBuffer());
      const meta = await zip.file("dunes-meta-inf")?.async("string");
      if (!meta) throw new Error("This isn't an Orchestrator package (no dunes-meta-inf).");
      setPkgName(/<entry key="pkg-name">([\s\S]*?)<\/entry>/.exec(meta)?.[1] || f.name);
      const certFile = Object.keys(zip.files).find((n) => n.startsWith("certificates/") && n.endsWith(".cer"));
      if (certFile) {
        const info = readCertificate(await zip.file(certFile)!.async("uint8array"));
        setCurrentSigner({ name: info.subjectName, until: info.notAfter });
      } else setCurrentSigner(null);
      setFile(f);
    } catch (e) {
      setFile(null);
      setError((e as Error).message.includes("end of central directory") ? "That file isn't a valid .package (zip) archive." : (e as Error).message);
    }
  };

  const run = async () => {
    if (!file || !formOk) return;
    setError(null);
    setDone(null);
    try {
      let id: SigningIdentity;
      if (mode === "new") {
        setBusy("Creating a new key and certificate…");
        const s: Subject = { CN: subject.CN.trim(), OU: subject.OU.trim() || undefined, O: subject.O.trim() || undefined, C: subject.C.trim().toUpperCase() || undefined };
        id = await createSigningIdentity(s, 10);
      } else {
        setBusy("Checking your key and certificate…");
        id = await loadSigningIdentity(pem);
      }
      setBusy("Signing…");
      const r = await resignPackage(await file.arrayBuffer(), id, { setOwner }, (d, t) => setBusy(`Signing… ${Math.round((d / t) * 100)}%`));
      setDone({ fileName: signedFileName(file.name), blob: r.blob, files: r.files, pkgName, previousSigner: r.previousSigner, id, generated: mode === "new" });
      download(signedFileName(file.name), r.blob);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const downloadKeyBundle = async () => {
    if (!done?.id.pkcs8) return;
    const z = new JSZip();
    const base = done.id.subjectName.replace(/^.*CN=/, "").replace(/[^\w.-]+/g, "-").toLowerCase() || "package-signer";
    z.file(`${base}-key.pem`, toPem("PRIVATE KEY", done.id.pkcs8));
    z.file(`${base}-cert.pem`, toPem("CERTIFICATE", done.id.certDer));
    z.file(`${base}.cer`, done.id.certDer);
    z.file(
      "README.txt",
      [
        "Package signing key for VMware Orchestrator packages",
        "",
        `Subject:     ${done.id.subjectName}`,
        `Valid:       ${done.id.notBefore.toISOString()} to ${done.id.notAfter.toISOString()}`,
        `SHA-1:       ${done.id.fingerprintSha1}`,
        "",
        `${base}-key.pem   private key (PKCS#8, unencrypted). KEEP IT PRIVATE.`,
        `${base}-cert.pem  certificate (PEM)`,
        `${base}.cer       certificate (DER), the form stored inside a .package`,
        "",
        "Sign more packages with the same identity:",
        "  vRO Peekage > Re-sign a package > Use my existing key, and choose both .pem files.",
        "",
        "Use it with Build Tools for VMware Aria / keytool (JCEKS keystore, alias _dunesrsa_alias_):",
        `  openssl pkcs12 -export -inkey ${base}-key.pem -in ${base}-cert.pem -name _dunesrsa_alias_ -out package-signing.p12`,
        "  keytool -importkeystore -srckeystore package-signing.p12 -srcstoretype PKCS12 \\",
        "          -destkeystore package-signing-cert.jks -deststoretype JCEKS",
        "",
      ].join("\n"),
    );
    download(`${base}-signing-key.zip`, await z.generateAsync({ type: "blob" }));
  };

  return (
    <main className="sign">
      <div className="sign-wrap">
        <button className="link small" onClick={onHome}>← Back to vRO Peekage</button>
        <h1 className="sign-title">Re-sign a package</h1>
        <p className="sign-lede">
          Give any Orchestrator <code>.package</code> a fresh publisher certificate valid for <strong>10 years</strong>. Every file in the package is signed again, so the package is fully valid and
          Orchestrator shows your publisher name on import. Everything happens in this browser tab: the key is created here and the package is never uploaded.
        </p>

        <section className="card sign-step">
          <h3><span className="sign-n">1</span> Package</h3>
          <input ref={pkgInput} type="file" accept=".package,application/zip" hidden onChange={(e) => e.target.files?.[0] && pickPackage(e.target.files[0])} />
          {file ? (
            <div className="sign-file">
              <div>
                <strong>{pkgName}</strong> <span className="muted small">{file.name} · {formatBytes(file.size)}</span>
                <div className="small muted">
                  Current publisher: {currentSigner ? <><code>{currentSigner.name}</code>{currentSigner.until && <> · valid until {fmtDate(currentSigner.until)}</>}</> : "unsigned"}
                </div>
              </div>
              <button className="btn-ghost sm" onClick={() => pkgInput.current?.click()}>Change</button>
            </div>
          ) : (
            <button className="btn" onClick={() => pkgInput.current?.click()}>Choose a .package file</button>
          )}
        </section>

        <section className="card sign-step">
          <h3><span className="sign-n">2</span> Publisher certificate</h3>
          <div className="sign-modes" role="radiogroup">
            <label className={mode === "new" ? "on" : ""}>
              <input type="radio" checked={mode === "new"} onChange={() => setMode("new")} /> Create a new certificate <span className="muted small">(RSA 2048, SHA-512, 10 years)</span>
            </label>
            <label className={mode === "existing" ? "on" : ""}>
              <input type="radio" checked={mode === "existing"} onChange={() => setMode("existing")} /> Use my existing key and certificate
            </label>
          </div>

          {mode === "new" ? (
            <div className="sign-grid">
              {([
                ["CN", "Common name", "Shown as the publisher in Orchestrator"],
                ["O", "Organization", ""],
                ["OU", "Organizational unit", ""],
                ["C", "Country (optional)", "Two letters"],
              ] as const).map(([k, label, hint]) => (
                <label key={k} className="sign-field">
                  <span>{label}</span>
                  <input
                    className={`input${fieldErrors[k] ? " invalid" : ""}`}
                    value={subject[k]}
                    maxLength={k === "C" ? 2 : 64}
                    onChange={(e) => setSubject({ ...subject, [k]: e.target.value })}
                    placeholder={k === "C" ? "IN" : ""}
                    spellCheck={false}
                  />
                  <small className={fieldErrors[k] ? "val-err" : "muted"}>{fieldErrors[k] ?? hint}</small>
                </label>
              ))}
            </div>
          ) : (
            <div className="sign-existing">
              <p className="small muted">
                Choose or paste the <code>-key.pem</code> and <code>-cert.pem</code> from a signing key you downloaded here before (or any unencrypted PKCS#8 key with its certificate). Using the same key keeps the same publisher across packages.
              </p>
              <input
                ref={pemInput}
                type="file"
                accept=".pem,.crt,.key,.txt"
                multiple
                hidden
                onChange={async (e) => setPem((await Promise.all([...(e.target.files ?? [])].map((f) => f.text()))).join("\n"))}
              />
              <button className="btn sm" onClick={() => pemInput.current?.click()}>Choose .pem files</button>
              <textarea className="input mono" rows={5} value={pem} onChange={(e) => setPem(e.target.value)} placeholder={"-----BEGIN PRIVATE KEY-----\n…\n-----BEGIN CERTIFICATE-----\n…"} spellCheck={false} />
            </div>
          )}

          <label className="sign-check">
            <input type="checkbox" checked={setOwner} onChange={(e) => setSetOwner(e.target.checked)} /> Also make this certificate the package <strong>owner</strong>
            <span className="muted small"> (normally the owner stays the server that created the package)</span>
          </label>
        </section>

        {error && <div className="callout warn">{error}</div>}
        <div className="sign-actions">
          <button className="btn primary lp-btn" disabled={!file || !formOk || !!busy} onClick={run}>
            {busy ?? "Sign package"}
          </button>
        </div>

        {done && (
          <section className="card sign-done" aria-live="polite">
            <h3>✓ Signed {done.pkgName}</h3>
            <p className="small">{done.files} files signed. Your download should have started.</p>
            <table className="io-out sign-cert">
              <tbody>
                <tr><th>Publisher</th><td className="mono">{done.id.subjectName}</td></tr>
                <tr><th>Valid</th><td>{fmtDate(done.id.notBefore)} → {fmtDate(done.id.notAfter)}</td></tr>
                <tr><th>SHA-1 fingerprint</th><td className="mono small">{done.id.fingerprintSha1}</td></tr>
                {done.previousSigner && <tr><th>Replaced</th><td className="mono small muted">{done.previousSigner}</td></tr>}
              </tbody>
            </table>
            <div className="sign-actions">
              <button className="btn" onClick={() => download(done.fileName, done.blob)}>Download {done.fileName} again</button>
              {done.generated && <button className="btn" onClick={downloadKeyBundle}>Download signing key</button>}
            </div>
            {done.generated && (
              <p className="callout small">
                <strong>Keep the signing key if you'll sign more packages.</strong> It's the only copy: it was created in this tab and isn't stored anywhere. With it, later packages can be signed as the
                same publisher. Without it, each run creates a new publisher. Store it like a password.
              </p>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
