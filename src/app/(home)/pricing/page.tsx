'use client';

import Script from 'next/script';
import { Build01Logo } from '@/components/build01-logo';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { CrownIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  CREDITS_PER_DOLLAR,
  MIN_PURCHASE_DOLLARS,
  dollarsToCredits,
} from '@/lib/payment/packs';

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

type RazorpaySuccessPayload = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

const Page = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [amountInput, setAmountInput] = useState(String(MIN_PURCHASE_DOLLARS));
  const router = useRouter();

  const amountDollars = useMemo(() => {
    const n = Number(amountInput);
    return Number.isFinite(n) ? n : 0;
  }, [amountInput]);

  const credits = useMemo(() => dollarsToCredits(amountDollars), [amountDollars]);
  const minValid = amountDollars >= MIN_PURCHASE_DOLLARS;

  const goBackOrHome = () => {
    if (window.history.length > 1) {
      router.back();
      return;
    }
    router.push('/');
  };

  const confirmPayment = async (payload: RazorpaySuccessPayload) => {
    const res = await fetch('/api/payments/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      throw new Error(data.error ?? 'Payment verification failed');
    }
  };

  const checkout = async () => {
    if (!minValid) {
      setError(`Minimum purchase is $${MIN_PURCHASE_DOLLARS}`);
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/payments/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountDollars }),
      });

      const data = (await res.json()) as {
        error?: string;
        orderId?: string;
        amount?: number;
        currency?: string;
        keyId?: string;
        credits?: number;
      };

      if (!res.ok) {
        setError(data.error ?? 'Could not start checkout');
        return;
      }

      if (
        !data.orderId ||
        data.amount === undefined ||
        !data.currency ||
        !data.keyId
      ) {
        setError('Invalid checkout response');
        return;
      }

      const Rzp = window.Razorpay;
      if (!Rzp) {
        setError('Razorpay script not loaded yet - try again.');
        return;
      }

      const rzp = new Rzp({
        key: data.keyId,
        amount: data.amount,
        currency: data.currency,
        order_id: data.orderId,
        name: 'Ryzor',
        description: `${data.credits ?? credits} credits`,
        async handler(response: RazorpaySuccessPayload) {
          try {
            await confirmPayment(response);
            setError(null);
            goBackOrHome();
            router.refresh();
          } catch (e) {
            const message =
              e instanceof Error ? e.message : 'Payment verification failed';
            setError(message);
          } finally {
            setLoading(false);
          }
        },
        modal: {
          ondismiss() {
            setLoading(false);
          },
        },
      });
      rzp.open();
    } catch {
      setError('Checkout failed');
      setLoading(false);
    }
  };

  return (
    <>
      <Script
        src="https://checkout.razorpay.com/v1/checkout.js"
        strategy="lazyOnload"
      />
      <div className="mx-auto flex w-full max-w-3xl flex-col px-4">
        <section className="space-y-8 pt-[16vh] 2xl:pt-48">
        <div className="flex items-center justify-center">
          <Build01Logo height={48} variant="wordmark" />
        </div>

          <Card className="mx-auto w-full max-w-md gap-4">
            <CardHeader className="text-center">
              <CardTitle className="text-xl md:text-2xl">Buy Credits</CardTitle>
              <CardDescription>
                Enter your dollar amount. Rate: 1$ = {CREDITS_PER_DOLLAR} credits.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              <label className="text-sm font-medium" htmlFor="amountDollars">
                Amount in dollars
              </label>
              <Input
                id="amountDollars"
                type="number"
                min={MIN_PURCHASE_DOLLARS}
                step="0.01"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                placeholder={`Minimum ${MIN_PURCHASE_DOLLARS}`}
                className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />

              <p className="text-muted-foreground text-sm">
                You will receive{' '}
                <span className="font-semibold text-foreground">{credits}</span> credits.
              </p>

              {!minValid && (
                <p className="text-destructive text-sm">
                  Minimum purchase is ${MIN_PURCHASE_DOLLARS}.
                </p>
              )}

              {error && <p className="text-destructive text-sm">{error}</p>}

              <Button
                className="w-full"
                onClick={checkout}
                disabled={loading || !minValid}
              >
                {loading ? 'Opening...' : (<><CrownIcon /> Buy credits</>)}
              </Button>
            </CardContent>
          </Card>
        </section>
      </div>
    </>
  );
};

export default Page;
