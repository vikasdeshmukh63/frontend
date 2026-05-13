import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { getQueryClient, trpc } from '@/trpc/server';
import { dehydrate, HydrationBoundary } from '@tanstack/react-query';

import ProfileView from '@/modules/profile/ui/views/profile-view';

/** Session-backed prefetches must not run during static prerender (no cookies at build time). */
export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/sign-in');
  }

  const queryClient = getQueryClient();
  void queryClient.prefetchQuery(trpc.profile.get.queryOptions());
  void queryClient.prefetchQuery(trpc.usage.status.queryOptions());
  void queryClient.prefetchQuery(trpc.aiSettings.get.queryOptions());

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ProfileView />
    </HydrationBoundary>
  );
}
