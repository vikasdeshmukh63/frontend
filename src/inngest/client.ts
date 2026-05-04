import { Inngest } from 'inngest';

/**
 * Event sending mode is driven by env (see Inngest SDK `mode`):
 *
 * - **Local dev** (with `npx inngest-cli dev`): set `INNGEST_DEV=1` in `.env`.
 *   Do **not** set `INNGEST_EVENT_KEY` unless you intentionally use cloud ingest.
 *
 * - **Production / cloud**: set `INNGEST_EVENT_KEY` from the Inngest dashboard.
 *   Set `INNGEST_DEV=0` or omit `INNGEST_DEV`.
 *
 * Avoid passing `isDev` here: it overrides `INNGEST_DEV`. If `isDev` is wrong
 * (e.g. `NODE_ENV` not `development` in a bundle), every `send()` requires an
 * event key and fails with “couldn't find an event key”.
 */
export const inngest = new Inngest({ id: 'frontend' });
