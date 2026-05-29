'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { ChatAiSettingsButton } from '@/components/chat/chat-ai-settings';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTRPC } from '@/trpc/client';

function initials(name?: string | null, email?: string | null) {
  if (name?.trim()) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  if (email) return email.slice(0, 2).toUpperCase();
  return 'U';
}

export default function ProfileView() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { update: updateSession } = useSession();
  const router = useRouter();
  const { data: profile, isLoading: profileLoading } = useQuery(
    trpc.profile.get.queryOptions()
  );
  const { data: usage } = useQuery(trpc.usage.status.queryOptions());

  const [name, setName] = useState('');
  const [imageUrl, setImageUrl] = useState('');

  useEffect(() => {
    if (!profile) return;
    setName(profile.name ?? '');
    setImageUrl(profile.image ?? '');
  }, [profile]);

  const updateProfile = useMutation(
    trpc.profile.update.mutationOptions({
      onSuccess: async (updatedProfile) => {
        queryClient.setQueryData(
          trpc.profile.get.queryKey(),
          updatedProfile
        );
        await updateSession({ name: updatedProfile.name });
        toast.success('Profile updated');
        await queryClient.invalidateQueries(trpc.profile.get.queryOptions());
        await queryClient.refetchQueries({
          queryKey: trpc.profile.get.queryKey(),
          exact: true,
        });
        router.refresh();
      },
      onError: (error) => toast.error(error.message || 'Failed to update profile'),
    })
  );

  const credits = usage?.remainingPoints ?? 0;
  const estimatedCost = usage?.generationCost ?? 2;
  const nextResetMs = usage?.msBeforeNext ?? 0;

  return (
    <div className="mx-auto w-full max-w-4xl py-24">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Profile</h1>
        <p className="text-muted-foreground text-sm">
          Manage your account details, credits, and AI model preferences.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Account Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Avatar className="size-11 rounded-md">
                <AvatarImage src={imageUrl || undefined} alt="" />
                <AvatarFallback className="rounded-md text-xs">
                  {initials(name || profile?.name, profile?.email)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {profile?.email ?? 'No email'}
                </p>
                <p className="text-muted-foreground text-xs">
                  {profileLoading ? 'Loading profile...' : 'Signed-in account'}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="profile-name">Name</Label>
              <Input
                id="profile-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your display name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="profile-image">Avatar URL (optional)</Label>
              <Input
                id="profile-image"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://..."
              />
            </div>

            <Button
              disabled={updateProfile.isPending || !name.trim()}
              onClick={() =>
                updateProfile.mutate({
                  name: name.trim(),
                  image: imageUrl.trim(),
                })
              }
            >
              {updateProfile.isPending ? 'Saving...' : 'Save details'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Credits</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              Available credits: <span className="font-semibold">{credits}</span>
            </p>
            <p>
              Estimated cost per generation:{' '}
              <span className="font-semibold">{estimatedCost}+</span>
            </p>
            <p className="text-muted-foreground">
              {nextResetMs > 0
                ? 'Rate limit window is currently active.'
                : 'Token usage depends on model and prompt size.'}
            </p>
            <Button asChild variant="outline" size="sm" className="mt-2">
              <a href="/pricing">Buy credits</a>
            </Button>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>AI Model & API Keys</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <p className="text-muted-foreground text-sm">
              Choose provider/model and manage custom provider API keys.
            </p>
            <ChatAiSettingsButton />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
