/**
 * Razorpay Standard Checkout options (client-safe).
 * @see https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/configure-payment-methods/
 */
export const RAZORPAY_CHECKOUT_PAYMENT_OPTIONS = {
  method: {
    upi: true,
    card: true,
    netbanking: true,
    wallet: true,
    emi: false,
    paylater: false,
  },
  config: {
    display: {
      blocks: {
        upi: {
          name: 'Pay via UPI',
          instruments: [{ method: 'upi' }],
        },
      },
      sequence: ['block.upi'],
      preferences: {
        show_default_blocks: true,
      },
    },
  },
} as const;
