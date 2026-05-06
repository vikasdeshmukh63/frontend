import { getQueryClient, trpc } from '@/trpc/server';
import { dehydrate, HydrationBoundary } from '@tanstack/react-query';

import ProfileView from '@/modules/profile/ui/views/profile-view';

export default async function ProfilePage() {
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
