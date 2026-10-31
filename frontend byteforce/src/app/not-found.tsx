import { Button } from "@/components/ui/Button";
import { MorphBlob } from "@/components/visuals/MorphBlob";

export default function NotFound() {
  return (
    <div className="page container" style={{ display: "grid", placeItems: "center", textAlign: "center", gap: "var(--s-5)", alignContent: "center" }}>
      <div style={{ width: 220 }}><MorphBlob tone="chrome" /></div>
      <span className="eyebrow">404 · unavailable ≠ failed</span>
      <h1 className="display">No such route.</h1>
      <p className="lead">Like missing provenance, a missing page is just missing — not malicious.</p>
      <Button href="/" variant="primary">Back to home</Button>
    </div>
  );
}
