'use client';

import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import UserControl from '@/components/user-control';
import { useScroll } from '@/hooks/use-scroll';
import { cn } from '@/lib/utils';
import { useSession } from 'next-auth/react';
import { CrownIcon } from 'lucide-react';

const Navbar = () => {
  const { status } = useSession();
  const isSignedIn = status === 'authenticated';
  const isScrolled = useScroll();

  return (
    <nav
      className={cn(
        'fixed top-0 right-0 left-0 z-50 border-b border-transparent bg-transparent p-4 transition-all duration-200',
        isScrolled && 'bg-background border-border'
      )}
    >
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between">
        <Link href="/" className="flex items-center gap-3">
          <Image src="/logo.svg" alt="Fingerchip" width={24} height={24} />
          <span className="text-lg font-semibold">Fingerchip</span>
        </Link>

        {!isSignedIn ? (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/sign-up">Sign Up</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/sign-in">Sign In</Link>
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/pricing"><CrownIcon /> Buy credits</Link>
            </Button>
            <UserControl showName />
          </div>
        )}
      </div>
    </nav>
  );
};

export default Navbar;
