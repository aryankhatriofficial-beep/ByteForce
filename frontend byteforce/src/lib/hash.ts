/** Browser-side SHA-256 using WebCrypto. Files never leave the device. */
export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(new Uint8Array(digest));
}

export const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export const MAX_LOCAL_HASH_BYTES = 256 * 1024 * 1024;

export async function sha256File(file: File): Promise<string> {
  if (file.size > MAX_LOCAL_HASH_BYTES) throw new Error("File is larger than the 256 MiB in-browser hashing limit.");
  return sha256Hex(await file.arrayBuffer());
}

/** Constant-shape comparison of two hex digests (case-insensitive). */
export const digestsEqual = (a?: string | null, b?: string | null) =>
  !!a && !!b && a.length === b.length && a.toLowerCase() === b.toLowerCase();

/** Splits a 64-char digest into 16 nibble-quads for display. */
export const chunkHex = (hex: string, size = 4) => hex.match(new RegExp(`.{1,${size}}`, "g")) ?? [];

export const formatBytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / 1024 / 1024).toFixed(2)} MiB`;
};
