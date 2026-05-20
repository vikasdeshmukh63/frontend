import type { Metadata } from 'next';
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import './globals.css';
import { TRPCReactProvider } from '@/trpc/client';
import { Toaster } from '@/components/ui/sonner';
import { ThemeProvider } from 'next-themes';
import { AuthSessionProvider } from '@/components/providers/auth-session-provider';

export const metadata: Metadata = {
  title: 'Build01',
  description: 'Build Something with Build01',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <AuthSessionProvider>
      <TRPCReactProvider>
        <html lang="en" suppressHydrationWarning>
          <body
            className={`${GeistSans.variable} ${GeistMono.variable} antialiased`}
          >
            <ThemeProvider
              attribute="class"
              defaultTheme="system"
              enableSystem
              disableTransitionOnChange
            >
              <Toaster />
              {children}
            </ThemeProvider>
          </body>
        </html>
      </TRPCReactProvider>
    </AuthSessionProvider>
  );
}
