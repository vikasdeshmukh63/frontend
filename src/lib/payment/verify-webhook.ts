import crypto from 'crypto';

function safeCompareHex(aHex: string, bHex: string): boolean {
  try {
    const a = Buffer.from(aHex, 'utf8');
    const b = Buffer.from(bHex, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function verifyRazorpayWebhookSignature(
  rawBody: string,
  signature: string | null,
  secret: string | undefined
): boolean {
  if (!secret || !signature) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  return safeCompareHex(expected, signature);
}

export function verifyRazorpayCheckoutSignature(params: {
  orderId: string;
  paymentId: string;
  signature: string;
  keySecret: string | undefined;
}) {
  const { orderId, paymentId, signature, keySecret } = params;
  if (!keySecret) return false;
  const payload = `${orderId}|${paymentId}`;
  const expected = crypto
    .createHmac('sha256', keySecret)
    .update(payload)
    .digest('hex');
  return safeCompareHex(expected, signature);
}
