import Razorpay from 'razorpay';

export function getRazorpayInstance() {
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key_id || !key_secret) {
    throw new Error('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set');
  }
  return new Razorpay({ key_id, key_secret });
}
