export interface Env {
  AI: Ai;
  ART: R2Bucket;
  DB: D1Database;
  RENDER_QUEUE: Queue<RenderJob>;
  /** The built reader, served from this same Worker. */
  ASSETS: Fetcher;
}

export interface RenderJob {
  bookId: string;
  beatId: string;
  styleId: string;
}
