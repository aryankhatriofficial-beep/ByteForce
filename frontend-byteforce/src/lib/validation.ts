/**
 * Parses what a user types into the verify box. Accepted forms:
 *   name · name==1.2.3 · name 1.2.3 · name@1.2.3 · a wheel/sdist filename · a pypi.org project URL
 * Names follow PEP 508 / PEP 503 rules; output names are PEP 503-normalised.
 */
export interface ParsedIdentifier {
  name: string;
  version?: string;
  filename?: string;
}

export type ParseResult = { ok: true; value: ParsedIdentifier } | { ok: false; error: string };

const NAME_RE = /^([A-Z0-9]|[A-Z0-9][A-Z0-9._-]*[A-Z0-9])$/i;
const VERSION_RE = /^v?\d+(\.\d+)*((a|b|rc)\d+)?(\.post\d+)?(\.dev\d+)?(\+[a-z0-9.]+)?$/i;

export const normalizeName = (n: string) => n.toLowerCase().replace(/[-_.]+/g, "-");

export function parseArtifactFilename(file: string): ParsedIdentifier | null {
  const base = file.split(/[\\/]/).pop() ?? file;
  const whl = base.match(/^([A-Za-z0-9_.]+)-([^-]+)(-\d[^-]*)?-([^-]+)-([^-]+)-([^-]+)\.whl$/);
  if (whl) return { name: normalizeName(whl[1]), version: whl[2], filename: base };
  const sd = base.match(/^(.+)-(\d[^-]*)\.(tar\.gz|zip)$/);
  if (sd) return { name: normalizeName(sd[1]), version: sd[2], filename: base };
  return null;
}

export function parseIdentifier(raw: string): ParseResult {
  const input = raw.trim();
  if (!input) return { ok: false, error: "Enter a package name, e.g. kestrel-http==2.4.1" };
  if (input.length > 200) return { ok: false, error: "That is too long to be a package identifier." };

  const url = input.match(/^https?:\/\/(?:test\.)?pypi\.org\/project\/([^/]+)(?:\/([^/]+))?\/?$/i);
  if (url) return parseIdentifier(url[2] ? `${url[1]}==${url[2]}` : url[1]);

  if (/\.(whl|tar\.gz|zip)$/i.test(input)) {
    const f = parseArtifactFilename(input);
    return f ? { ok: true, value: f } : { ok: false, error: "That filename does not follow wheel/sdist naming rules." };
  }

  const m = input.match(/^([^\s=@]+)\s*(?:==|@|\s)\s*([^\s]+)$/) ?? input.match(/^([^\s=@]+)$/);
  if (!m) return { ok: false, error: "Use the form name or name==version (only exact pins are supported)." };
  const [, name, version] = m;
  if (/[<>~!]/.test(input)) return { ok: false, error: "Ranges are not supported — verification needs one exact version." };
  if (!NAME_RE.test(name)) return { ok: false, error: `“${name}” is not a valid PEP 508 project name.` };
  if (version && !VERSION_RE.test(version)) return { ok: false, error: `“${version}” does not look like a PEP 440 version.` };
  return { ok: true, value: { name: normalizeName(name), version: version?.replace(/^v/i, "") } };
}

const REPO_RE = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
const WORKFLOW_RE = /^[A-Za-z0-9._-]+\.ya?ml$/;

export function validatePolicy(repository: string, workflow: string): string | null {
  const r = repository.trim();
  const w = workflow.trim();
  if (!r && w) return "A workflow can only be constrained together with a repository.";
  if (r && !REPO_RE.test(r)) return "Repository must look like owner/name.";
  if (w && !WORKFLOW_RE.test(w)) return "Workflow must be a filename like release.yml (no path).";
  return null;
}
