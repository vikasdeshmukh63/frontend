import nodemailer from 'nodemailer';

let cachedTransporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (cachedTransporter) return cachedTransporter;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? '587');
  const secure = process.env.SMTP_SECURE === 'true';
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error('SMTP_HOST, SMTP_USER and SMTP_PASS must be set');
  }

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  return cachedTransporter;
}

export async function sendPasswordResetEmail(params: {
  to: string;
  resetLink: string;
}) {
  const from = process.env.SMTP_FROM ?? process.env.SMTP_USER;
  if (!from) {
    throw new Error('SMTP_FROM or SMTP_USER must be set');
  }

  const transporter = getTransporter();

  await transporter.sendMail({
    from,
    to: params.to,
    subject: 'Reset your Fingerchip password',
    text: `You requested a password reset. Open this link to continue: ${params.resetLink}`,
    html: `
      <p>You requested a password reset.</p>
      <p>
        <a href="${params.resetLink}">Click here to reset your password</a>
      </p>
      <p>If you did not request this, you can ignore this email.</p>
    `,
  });
}
