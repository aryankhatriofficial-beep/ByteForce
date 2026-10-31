/** Methodology & docs content. Kept as data so the docs page, search and command palette share it. */
export interface DocBlock {
  kind: "p" | "list" | "code" | "callout" | "status-table";
  text?: string;
  items?: string[];
  lang?: string;
  tone?: "info" | "warn";
}

export interface DocSection {
  id: string;
  group: string;
  title: string;
  keywords: string;
  blocks: DocBlock[];
}

export const DOC_SECTIONS: DocSection[] = [
  {
    id: "overview", group: "Start", title: "What PyVerify does", keywords: "intro overview purpose ps04 integrity",
    blocks: [
      { kind: "p", text: "PyVerify answers one narrow question with evidence: is this published Python artifact the one its publisher built, and does its contents agree with what it declares about itself? It retrieves the artifact from PyPI, verifies it without installing or executing it, and reports every check as PASS, WARNING, FAIL, UNAVAILABLE or SKIPPED." },
      { kind: "callout", tone: "warn", text: "PyVerify is an integrity and provenance tool, not a malware scanner. A package that passes every check can still contain harmful code that its legitimate publisher shipped." },
    ],
  },
  {
    id: "quickstart", group: "Start", title: "Running a verification", keywords: "how to use verify studio input",
    blocks: [
      { kind: "p", text: "Open Verify Studio and type a project name. Its releases and published files load from pypi.org; pick a version and the exact artifact. Optionally switch attestation verification off, or add the publisher repository (owner/name) and workflow filename you expect." },
      { kind: "code", lang: "text", text: "sampleproject\nsampleproject==4.0.0\nsampleproject-4.0.0-py3-none-any.whl" },
      { kind: "p", text: "Pasting name==version or a wheel filename fills the form. Ranges such as >=2 are rejected on purpose: verification is always about one concrete file." },
    ],
  },
  {
    id: "digest", group: "Checks", title: "Artifact digest & size", keywords: "sha256 hash size download integrity",
    blocks: [
      { kind: "p", text: "The backend reads the file's published SHA-256 and size from PyPI's JSON API, downloads the file over HTTPS with a hard byte limit, and recomputes both. A mismatch is a FAIL." },
      { kind: "list", items: ["Proves: the bytes you analyse are exactly the bytes PyPI serves for that filename.", "Does not prove: that those bytes are benign, or that PyPI itself was not compromised before publication."] },
    ],
  },
  {
    id: "metadata", group: "Checks", title: "Wheel metadata", keywords: "METADATA WHEEL tags requires-dist",
    blocks: [
      { kind: "p", text: "METADATA and WHEEL are parsed straight from the archive — nothing is installed or imported. Name and version are compared against the filename; tags, Requires-Python and Requires-Dist are surfaced for review." },
    ],
  },
  {
    id: "record", group: "Checks", title: "RECORD integrity", keywords: "record hash size missing unexpected duplicate",
    blocks: [
      { kind: "p", text: "Every wheel ships a RECORD listing each file with its hash and size. PyVerify streams each archive member, hashes it, and reports five classes of problem:" },
      { kind: "list", items: ["Hash mismatch — content differs from the declared hash.", "Size mismatch — byte length differs.", "Missing — listed in RECORD, absent from the archive.", "Unexpected — present in the archive, not listed in RECORD.", "Duplicate — the same path listed more than once."] },
      { kind: "callout", tone: "info", text: "RECORD is written by the build backend at build time. A consistent RECORD proves internal consistency, not that the build inputs were trustworthy." },
    ],
  },
  {
    id: "inventory", group: "Checks", title: "Safe archive inventory", keywords: "zip tar listing bounds extraction",
    blocks: [
      { kind: "p", text: "Wheel (zip) and sdist (tar.gz) contents are listed from the archive index with bounds on entry count and total uncompressed size. Members are hashed in memory as streams; nothing is extracted to disk and nothing is executed. Inventories that exceed bounds are reported as truncated." },
    ],
  },
  {
    id: "provenance", group: "Checks", title: "PEP 740 attestations", keywords: "sigstore attestation provenance signature certificate rekor",
    blocks: [
      { kind: "p", text: "When PyPI exposes PEP 740 provenance for a file, the backend retrieves the attestation bundle and verifies it with Sigstore: the signature, the certificate chain to the Fulcio root, the transparency-log inclusion, and that the attested subject digest equals the artifact's SHA-256." },
      { kind: "callout", tone: "warn", text: "Missing provenance is UNAVAILABLE, not FAIL. Most packages on PyPI do not publish attestations yet. Absence is missing evidence — it is not evidence of malice." },
    ],
  },
  {
    id: "policy", group: "Checks", title: "Publisher trust policy", keywords: "trusted publisher repository workflow policy identity",
    blocks: [
      { kind: "p", text: "A policy states which repository — and optionally which workflow filename — you expect to have published the artifact. The verified certificate identity from the attestation is compared against it." },
      { kind: "list", items: ["Checked: repository, and workflow filename when you supply one.", "Not checked: branch/tag protections, environment approvals, who triggered the run, or other identity attributes.", "Without a verified attestation, the policy is UNAVAILABLE — it cannot pass by default."] },
    ],
  },
  {
    id: "consistency", group: "Checks", title: "Release consistency", keywords: "sdist wheel compare python files",
    blocks: [
      { kind: "p", text: "For releases that publish both an sdist and a wheel, Python files present in both are compared by content. Files present in only one side are listed — tests and docs commonly exist only in the sdist." },
      { kind: "callout", tone: "info", text: "This is a static comparison. It does not rebuild the wheel and does not prove a reproducible build." },
    ],
  },
  {
    id: "source-trace", group: "Checks", title: "Verified source trace", keywords: "slsa provenance commit repository snapshot",
    blocks: [
      { kind: "p", text: "Source trace is a separate backend workflow, not part of a standard verification. If — and only if — a cryptographically verified attestation carries an SLSA Provenance v1 predicate, it resolves the source repository and pinned commit, fetches a snapshot at that commit, and compares the wheel's Python files with the source." },
      { kind: "list", items: ["Until that workflow has actually run, the evidence map shows source trace as Not checked.", "Without a verified SLSA v1 predicate the trace cannot run.", "Generated or compiled files legitimately differ from source.", "A match is strong evidence of correspondence for those files, not a complete source-to-binary guarantee."] },
    ],
  },
  {
    id: "statuses", group: "Interpreting", title: "Stage statuses", keywords: "pass warning fail unavailable not checked not applicable not configured meaning",
    blocks: [
      { kind: "status-table" },
      { kind: "p", text: "Every status has its own shape on the evidence map as well as its colour and label. Unknown statuses from the backend are shown as Unavailable — never as Verified." },
    ],
  },
  {
    id: "verdicts", group: "Interpreting", title: "Reading a verdict", keywords: "verdict pass warning fail overall interpretation",
    blocks: [
      { kind: "list", items: [
        "FAIL — at least one stage found evidence that contradicts what was expected (a digest, RECORD entry or publisher policy did not match). Treat the artifact as altered or mis-attributed until explained.",
        "WARNING — nothing contradicted expectations, but some evidence is missing or unavailable (most often: no attestation published). Decide whether that gap is acceptable for your use.",
        "PASS — every stage that was evaluated verified. Stages that were not checked or not configured do not count for or against it.",
      ] },
      { kind: "callout", tone: "warn", text: "A PASS is a statement about evidence, not safety. A legitimate publisher can still ship harmful code, and PyVerify does not analyse behaviour." },
    ],
  },
  {
    id: "limits", group: "Interpreting", title: "What PyVerify does not prove", keywords: "limitations not safe malware guarantee",
    blocks: [
      { kind: "list", items: [
        "A valid hash does not prove a package is safe.",
        "Missing provenance is not proof of malice.",
        "Static file comparison does not guarantee reproducible builds or complete source-to-binary correspondence.",
        "Source trace is conditional on a verified SLSA Provenance v1 predicate.",
        "Publisher policy does not establish every possible identity or workflow attribute.",
        "Dependencies are not verified transitively by a single report.",
      ] },
    ],
  },
  {
    id: "api", group: "Using PyVerify", title: "API usage", keywords: "api endpoint post verify health curl request json",
    blocks: [
      { kind: "p", text: "The interface talks to the PyVerify backend (default http://127.0.0.1:8765). Liveness is checked with GET /api/health; a verification is one POST with the exact project, version and filename." },
      { kind: "code", lang: "bash", text: "curl -s http://127.0.0.1:8765/api/health\n\ncurl -s -X POST http://127.0.0.1:8765/api/v1/verify \\\n  -H 'Content-Type: application/json' \\\n  -d '{\"project\": \"sampleproject\", \"version\": \"4.0.0\", \"filename\": \"sampleproject-4.0.0-py3-none-any.whl\"}'" },
      { kind: "callout", tone: "info", text: "Optional attestation and publisher-policy fields are sent only when you set them in Verify Studio. Their exact field names are defined in one place in the frontend (src/lib/api/endpoints.ts) so they can be matched to the backend." },
    ],
  },
  {
    id: "formats", group: "Using PyVerify", title: "Supported artifact formats", keywords: "wheel sdist tar.gz zip formats",
    blocks: [
      { kind: "list", items: [
        "Wheels (.whl) — every stage applies, including RECORD validation and metadata inspection.",
        "Source distributions (.tar.gz) — digest, inventory and attestations apply; RECORD and wheel metadata do not (shown as Not applicable).",
        "Legacy formats (.zip sdists, eggs) — only what the backend reports is shown; nothing is inferred.",
      ] },
    ],
  },
  {
    id: "security", group: "Using PyVerify", title: "Security model", keywords: "security trust boundary execution sandbox csp",
    blocks: [
      { kind: "list", items: [
        "Nothing is installed, imported or executed — by the backend or by this interface.",
        "Downloads are HTTPS-only with a hard size limit; archives are listed and streamed within bounds, never extracted to disk.",
        "PyPI is trusted for availability, not content: every byte is checked against the published digest.",
        "Signing identities are trusted only through Sigstore verification, never from metadata fields.",
        "This interface sends no credentials, stores no secrets and only connects to the PyVerify backend and pypi.org (read-only metadata), enforced by its Content-Security-Policy.",
        "Files you drop for local comparison are hashed in your browser and never uploaded.",
      ] },
    ],
  },
  {
    id: "demo-mode", group: "Using PyVerify", title: "Connection, offline and demo mode", keywords: "demo fixtures live backend offline disconnected",
    blocks: [
      { kind: "p", text: "The navigation shows the backend connection. If it is offline, verification is disabled with a retry action — nothing is faked. Release metadata from pypi.org still loads." },
      { kind: "p", text: "Demo fixtures are opt-in from the connection menu or the command palette: fictional packages (kestrel-http, lumen-cli, quartzite, vellum-schema) with fabricated digests, always labelled DEMO." },
      { kind: "code", lang: "bash", text: "# point the interface at another backend\ncp .env.example .env.local\nNEXT_PUBLIC_PYVERIFY_API_BASE_URL=http://127.0.0.1:8765" },
    ],
  },
  {
    id: "local-hash", group: "Using PyVerify", title: "Local file fingerprint", keywords: "drop file upload sha256 browser webcrypto",
    blocks: [
      { kind: "p", text: "Dropping a .whl or .tar.gz onto Verify Studio never uploads it. The browser reads the filename to prefill the identifier and computes the file's SHA-256 locally with WebCrypto, so you can compare your local copy to the digest PyPI publishes." },
    ],
  },
];
