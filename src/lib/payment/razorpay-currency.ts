import 'server-only';

import { dollarsToMinorUnits } from '@/lib/payment/packs';

const DEFAULT_USD_TO_INR = 85;

/** Razorpay currency for orders. UPI requires INR. */
export function getRazorpayOrderCurrency(): 'INR' | 'USD' {
  const raw = process.env.RAZORPAY_CURRENCY?.trim().toUpperCase();
  return raw === 'USD' ? 'USD' : 'INR';
}

function usdToInrRate(): number {
  const n = Number(process.env.RAZORPAY_USD_TO_INR_RATE);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_USD_TO_INR;
}

/** Converts UI dollar amount to Razorpay order amount (minor units) and currency. */
export function dollarsToRazorpayOrderAmount(amountDollars: number): {
  amountMinor: number;
  currency: 'INR' | 'USD';
  /** Present when charging in INR (for display). */
  amountInr?: number;
} {
  const currency = getRazorpayOrderCurrency();
  if (currency === 'INR') {
    const amountInr = Number((amountDollars * usdToInrRate()).toFixed(2));
    return {
      amountMinor: Math.round(amountInr * 100),
      currency: 'INR',
      amountInr,
    };
  }
  return {
    amountMinor: dollarsToMinorUnits(amountDollars),
    currency: 'USD',
  };
}
