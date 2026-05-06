'use client';

import { LogOut, UserIcon } from 'lucide-react';
import Link from 'next/link';
import { signOut, useSession } from 'next-auth/react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface Props {
  showName?: boolean;
}

function initials(name?: string | null, email?: string | null) {
  if (name?.trim()) {
    const parts = name.trim().split(/\s+/);
    const s =
      parts.length >= 2
        ? `${parts[0]![0]}${parts[1]![0]}`
        : parts[0]!.slice(0, 2);
    return s.toUpperCase();
  }
  if (email) return email.slice(0, 2).toUpperCase();
  return 'U';
}

const UserControl = ({ showName = true }: Props) => {
  const { data: session, status } = useSession();

  if (status !== 'authenticated' || !session?.user) {
    return null;
  }

  const user = session.user;
  const label = initials(user.name, user.email);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size={showName ? 'sm' : 'icon'}
          className="gap-2 rounded-md"
        >
          <Avatar className="size-8 rounded-md">
            <AvatarImage src={user.image ?? undefined} alt="" />
            <AvatarFallback className="rounded-md text-xs">
              {user.image ? '' : label}
            </AvatarFallback>
          </Avatar>
          {showName && (
            <span className="max-w-[140px] truncate text-sm font-medium">
              {user.name ?? user.email ?? 'Account'}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem asChild>
          <Link href="/profile" className="cursor-pointer">
            <UserIcon className="mr-2 size-4" />
            Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          className="cursor-pointer"
          onClick={() => signOut({ callbackUrl: '/' })}
        >
          <LogOut className="mr-2 size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default UserControl;
