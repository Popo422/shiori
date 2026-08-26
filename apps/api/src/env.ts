export interface Env {
  AI: Ai;
  ART: R2Bucket;
  DB: D1Database;
  /** The built reader, served from this same Worker. */
  ASSETS: Fetcher;
}

