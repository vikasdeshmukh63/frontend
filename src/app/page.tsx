'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useTRPC } from '@/trpc/client';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

const Page = () => {
  const router = useRouter();
  const [value, setValue] = useState('');

  const trpc = useTRPC();
  const createProject = useMutation(
    trpc.projects.create.mutationOptions({
      onSuccess: (data) => {
        router.push(`/projects/${data.id}`);
      },
      onError: (error) => {
        toast.error(error.message);
      },
    })
  );

  return (
    <div className="item-center flex h-screen w-screen justify-center">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-center gap-y-4">
        <Input value={value} onChange={(e) => setValue(e.target.value)} />
        <Button
          disabled={createProject.isPending}
          onClick={() => createProject.mutate({ value: value })}
        >
          Create
        </Button>
      </div>
    </div>
  );
};

export default Page;
