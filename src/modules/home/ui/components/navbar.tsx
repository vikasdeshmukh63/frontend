'use client';

import Link from 'next/link';
import Image from 'next/image';
import { SignInButton, SignUpButton, useAuth } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';
import UserControl from '@/components/user-control';

const Navbar = () => {
  const { isSignedIn } = useAuth();

  return (
    <nav className="fixed top-0 right-0 left-0 z-50 border-b border-transparent bg-transparent p-4 transition-all duration-200">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between">
        <Link href="/" className="flex items-center gap-3">
          <Image src="/logo.svg" alt="Ryzor" width={24} height={24} />
          <span className="text-lg font-semibold">Ryzor</span>
        </Link>

        {!isSignedIn ? (
          <div className="flex gap-2">
            <SignUpButton>
              <Button variant="outline" size="sm">
                Sign Up
              </Button>
            </SignUpButton>
            <SignInButton>
              <Button variant="outline" size="sm">
                Sign In
              </Button>
            </SignInButton>
          </div>
        ) : (
          <UserControl showName/>
        )}
      </div>
    </nav>
  );
};

export default Navbar;
