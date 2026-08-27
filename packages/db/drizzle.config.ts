import type { Config } from 'drizzle-kit';

export default {
  schema: './src/schema.ts',
  // Written straight into the Worker, because that is the only place Wrangler
  // looks when applying them. Generating them here and copying across meant a
  // forgotten copy would deploy fine and then fail at runtime on a missing table.
  out: '../../apps/api/migrations',
  dialect: 'sqlite',
  driver: 'd1-http',
} satisfies Config;
