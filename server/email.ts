/**
 * Email service for Truco Tchê
 * Sends transactional emails (PIN reset, welcome, etc.)
 * Uses nodemailer with SMTP configuration from environment variables.
 * If SMTP is not configured, falls back to console logging (development mode).
 */
import nodemailer from 'nodemailer';

function createTransporter() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT ?? '587');
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM ?? 'Truco Tchê <noreply@trucotche.com>';

  if (!host || !user || !pass) {
    // Development fallback: log to console
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

export async function sendPinResetEmail(to: string, name: string, resetToken: string, origin: string): Promise<boolean> {
  const resetUrl = `${origin}?resetToken=${encodeURIComponent(resetToken)}`;
  const transporter = createTransporter();

  const html = `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head><meta charset="UTF-8"><title>Redefinição de PIN - Truco Tchê</title></head>
    <body style="font-family: Georgia, serif; background: #1a0e06; color: #f0e0c0; padding: 40px 20px; margin: 0;">
      <div style="max-width: 480px; margin: 0 auto; background: #2a1a0e; border: 2px solid #8b6508; border-radius: 16px; padding: 32px;">
        <h1 style="font-size: 2rem; color: #c8960a; text-align: center; margin: 0 0 8px;">🃏 Truco Tchê</h1>
        <p style="text-align: center; color: #c8b898; font-style: italic; margin: 0 0 24px;">O Desafio do Pago Virtual</p>
        <hr style="border: 1px solid #3d2a1a; margin-bottom: 24px;">
        <p style="margin: 0 0 12px;">Olá, <strong style="color: #c8960a;">${name}</strong>!</p>
        <p style="margin: 0 0 20px; line-height: 1.6;">Recebemos uma solicitação para redefinir o PIN da sua conta no Truco Tchê. Clique no botão abaixo para criar um novo PIN:</p>
        <div style="text-align: center; margin: 28px 0;">
          <a href="${resetUrl}" style="background: linear-gradient(135deg, #c8960a, #8b6508); color: #fff; font-weight: 700; font-size: 1rem; padding: 14px 32px; border-radius: 10px; text-decoration: none; display: inline-block; box-shadow: 0 4px 16px rgba(200,150,10,.3);">
            🔑 Redefinir meu PIN
          </a>
        </div>
        <p style="margin: 0 0 8px; font-size: 0.85rem; color: #c8b898;">Ou copie e cole este link no seu navegador:</p>
        <p style="background: #1a0e06; border: 1px solid #3d2a1a; border-radius: 8px; padding: 10px 14px; font-size: 0.8rem; word-break: break-all; color: #c8960a; margin: 0 0 20px;">${resetUrl}</p>
        <hr style="border: 1px solid #3d2a1a; margin-bottom: 20px;">
        <p style="font-size: 0.8rem; color: #806040; margin: 0; line-height: 1.5;">
          ⚠️ Este link é válido por <strong>15 minutos</strong>. Se você não solicitou a redefinição, ignore este e-mail — sua conta permanece segura.<br><br>
          Bom jogo, tchê! 🤠
        </p>
      </div>
    </body>
    </html>
  `;

  const text = `Olá, ${name}!\n\nRedefinição de PIN - Truco Tchê\n\nAcesse o link abaixo para criar um novo PIN (válido por 15 minutos):\n${resetUrl}\n\nSe não foi você, ignore este e-mail.`;

  if (!transporter) {
    // Development mode: log to console instead of sending
    console.log(`\n[EMAIL - DEV MODE] PIN Reset for ${to}`);
    console.log(`Reset URL: ${resetUrl}`);
    console.log(`Token: ${resetToken}\n`);
    return true;
  }

  try {
    const from = process.env.SMTP_FROM ?? 'Truco Tchê <noreply@trucotche.com>';
    await transporter.sendMail({
      from,
      to,
      subject: '🔑 Redefinição de PIN - Truco Tchê',
      text,
      html,
    });
    return true;
  } catch (error) {
    console.error('[Email] Failed to send PIN reset email:', error);
    return false;
  }
}
