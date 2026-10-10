export type ImportKind = "video" | "srt" | "project";
/** Approval applies to one import flow and expires as soon as editing changes. */
export class ImportApproval {
  private choice: { kind: ImportKind; revision: number } | null = null;
  allow(kind: ImportKind, revision: number) { this.choice = { kind, revision }; }
  permits(kind: ImportKind, revision: number) { return this.choice?.kind === kind && this.choice.revision === revision; }
  clear() { this.choice = null; }
}
