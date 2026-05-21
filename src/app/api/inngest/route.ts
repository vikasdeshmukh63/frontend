import { serve } from 'inngest/next';
import { inngest } from '@/inngest/client';
import { codeAgentCancelCleanup } from '@/inngest/cancel-cleanup';
import { codeAgentFunction } from '@/inngest/functions';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [codeAgentFunction, codeAgentCancelCleanup],
});
