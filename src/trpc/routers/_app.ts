import { aiSettingsRouter } from '@/modules/ai-settings/server/procedures';
import { messagesRouter } from '@/modules/messages/server/procedures';
import { profileRouter } from '@/modules/profile/server/procedures';
import { projectsRouter } from '@/modules/projects/server/procedures';
import { usageRouter } from '@/modules/usage/server/procedures';
import { createTRPCRouter } from '../init';

export const appRouter = createTRPCRouter({
  aiSettings: aiSettingsRouter,
  messages: messagesRouter,
  profile: profileRouter,
  projects: projectsRouter,
  usage: usageRouter,
});

export type AppRouter = typeof appRouter;
