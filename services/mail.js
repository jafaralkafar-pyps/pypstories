/**
 * Existing mail transports: Mailtrap, Resend, generic SMTP, or Ethereal.
 * Callers pass html, plain text, or both. Nothing here logs message bodies.
 */
const nodemailer = require('nodemailer');

let emailClient = null;

async function getEmailClient() {
  if (emailClient) return emailClient;

  if (process.env.MAILTRAP_USER && process.env.MAILTRAP_PASS) {
    emailClient = {
      type: 'mailtrap',
      send: async (mailOptions) => {
        const transporter = nodemailer.createTransport({
          host: 'sandbox.smtp.mailtrap.io',
          port: 2525,
          auth: {
            user: process.env.MAILTRAP_USER,
            pass: process.env.MAILTRAP_PASS,
          },
        });
        try {
          const info = await transporter.sendMail(mailOptions);
          console.log('📧 Mailtrap email sent successfully. Check your Mailtrap inbox: https://mailtrap.io');
          return info;
        } catch (mailErr) {
          console.error('Mailtrap send failed:', mailErr.message);
          if (mailErr.code === 'EAUTH' || mailErr.message.includes('Invalid credentials')) {
            console.error('>>> Check your MAILTRAP_USER and MAILTRAP_PASS in .env. Make sure they are the SMTP credentials from your Mailtrap inbox (not your login password).');
          }
          throw mailErr;
        }
      },
    };
    console.log('📧 Using Mailtrap for emails');
    return emailClient;
  }

  if (process.env.RESEND_API_KEY) {
    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    emailClient = {
      type: 'resend',
      send: async (mailOptions) => {
        const payload = {
          from: mailOptions.from,
          to: mailOptions.to,
          subject: mailOptions.subject,
        };
        if (mailOptions.html) payload.html = mailOptions.html;
        if (mailOptions.text) payload.text = mailOptions.text;
        const { data, error } = await resend.emails.send(payload);
        if (error) throw error;
        console.log('📧 Email sent via Resend');
        return data;
      },
    };
    console.log('📧 Using Resend for emails');
    return emailClient;
  }

  if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || 'smtp.ethereal.email',
      port: parseInt(process.env.EMAIL_PORT || '587', 10),
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
    emailClient = {
      type: 'smtp',
      send: (opts) => transporter.sendMail(opts),
    };
    return emailClient;
  }

  const testAccount = await nodemailer.createTestAccount();
  const transporter = nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false,
    auth: {
      user: testAccount.user,
      pass: testAccount.pass,
    },
  });
  emailClient = {
    type: 'ethereal',
    send: async (mailOptions) => {
      const info = await transporter.sendMail(mailOptions);
      const previewUrl = nodemailer.getTestMessageUrl(info);
      console.log('\n📧 [DEV] Email sent via Ethereal (fake SMTP)');
      console.log(`   To: ${mailOptions.to}`);
      console.log(`   Subject: ${mailOptions.subject}`);
      console.log(`   👉 Open this link to view the email: ${previewUrl}\n`);
      return info;
    },
  };
  console.log('📧 Using Ethereal (dev) - check console for preview links');
  return emailClient;
}

async function sendEmail(to, subject, html, text) {
  const client = await getEmailClient();
  const from = process.env.EMAIL_FROM || '"Pick Your Path Stories" <no-reply@pypstories.com>';
  const message = { from, to, subject };
  if (html) message.html = html;
  if (text) message.text = text;
  return client.send(message);
}

module.exports = { getEmailClient, sendEmail };
