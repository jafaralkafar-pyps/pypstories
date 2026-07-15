require('dotenv').config();

const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const multer = require('multer');
const storageService = require('./services/storage');
const credits = require('./services/credits');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');
const Stripe = require('stripe');

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;

const app = express();

// Behind Nginx, trust X-Forwarded-* so secure cookies / IPs work correctly
app.set('trust proxy', 1);

// In dev, explicitly tell browsers never to upgrade to HTTPS for this origin.
// This helps with the "https upgrade" errors when accessing via IP.
if (NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    res.setHeader('Strict-Transport-Security', 'max-age=0');
    next();
  });
}

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || '';
if (stripeSecretKey.startsWith('pk_')) {
  console.warn('⚠️  STRIPE_SECRET_KEY is a publishable key (pk_...). Put sk_test_... / sk_live_... there instead.');
} else if (stripeSecretKey && !stripeSecretKey.startsWith('sk_')) {
  console.warn('⚠️  STRIPE_SECRET_KEY should start with sk_test_ or sk_live_');
}
const stripe = stripeSecretKey.startsWith('sk_')
  ? new Stripe(stripeSecretKey, { apiVersion: '2026-06-24.dahlia' })
  : null;

// Security: Helmet for secure headers.
// Default Helmet CSP includes upgrade-insecure-requests, which breaks CSS/JS when
// the site is opened over plain HTTP (e.g. http://droplet-ip before Certbot).
// Only enable that directive when APP_URL is already https://
const isProd = NODE_ENV === 'production';
const appUrlIsHttps = /^https:\/\//i.test(APP_URL);
app.use(helmet({
  contentSecurityPolicy: isProd
    ? {
        useDefaults: true,
        directives: {
          // Allow same-origin CSS/JS plus the large inline <style> block in index.html
          "style-src": ["'self'", "'unsafe-inline'"],
          "script-src": ["'self'"],
          // HTML uses many onclick="..." handlers; Helmet default is script-src-attr 'none'
          // which makes buttons appear dead (e.g. Log in does nothing).
          "script-src-attr": ["'unsafe-inline'"],
          "img-src": ["'self'", "data:", "blob:"],
          // Disable forced HTTPS upgrades until the public URL is HTTPS
          ...(appUrlIsHttps ? {} : { "upgrade-insecure-requests": null }),
        },
      }
    : false,
  // Don't send HSTS until we're actually serving HTTPS publicly
  hsts: appUrlIsHttps,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false,
  hidePoweredBy: true,
  noSniff: true,
}));

// Rate limiting for auth routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 requests per windowMs
  message: { error: 'Too many attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Ensure directories exist
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads', 'comics');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Database setup
const dbPath = path.join(DATA_DIR, 'cyoa.db');
const db = new Database(dbPath);

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    username TEXT,
    password_hash TEXT NOT NULL,
    email_verified INTEGER DEFAULT 0,
    verification_token TEXT,
    verification_expires TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    role TEXT DEFAULT 'user',
    stripe_customer_id TEXT,
    is_premium INTEGER DEFAULT 0,
    subscription_status TEXT,
    stripe_account_id TEXT
  );

  CREATE TABLE IF NOT EXISTS comics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    genre TEXT DEFAULT 'Other',
    cover_image TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    view_count INTEGER DEFAULT 0,
    price_cents INTEGER DEFAULT 0,
    status TEXT DEFAULT 'draft',
    submitted_at TEXT,
    reviewed_by INTEGER,
    review_notes TEXT,
    last_reviewed_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    comic_id INTEGER NOT NULL,
    title TEXT DEFAULT '',
    image_path TEXT,
    text_content TEXT DEFAULT '',
    is_start INTEGER DEFAULT 0,
    FOREIGN KEY (comic_id) REFERENCES comics(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS choices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_page_id INTEGER NOT NULL,
    choice_text TEXT NOT NULL,
    to_page_id INTEGER NOT NULL,
    choice_image TEXT,
    FOREIGN KEY (from_page_id) REFERENCES pages(id) ON DELETE CASCADE,
    FOREIGN KEY (to_page_id) REFERENCES pages(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    comic_id INTEGER NOT NULL,
    amount_paid_cents INTEGER NOT NULL,
    stripe_payment_intent TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, comic_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (comic_id) REFERENCES comics(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS comic_sample_uses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    comic_id INTEGER NOT NULL,
    choices_used INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, comic_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (comic_id) REFERENCES comics(id) ON DELETE CASCADE
  );
`);

// Migrate old schema if needed (add email columns)
try {
  db.exec(`ALTER TABLE users ADD COLUMN email TEXT`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE users ADD COLUMN verification_token TEXT`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE users ADD COLUMN verification_expires TEXT`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE users ADD COLUMN password_reset_token TEXT`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE users ADD COLUMN password_reset_expires TEXT`);
} catch (e) {}

// Premium / subscription fields (Stripe)
try {
  db.exec(`ALTER TABLE users ADD COLUMN stripe_customer_id TEXT`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE users ADD COLUMN is_premium INTEGER DEFAULT 0`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE users ADD COLUMN subscription_status TEXT`);
} catch (e) {}

try {
  db.exec(`ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'`);
} catch (e) {}

try {
  db.exec(`ALTER TABLE comics ADD COLUMN status TEXT DEFAULT 'draft'`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE comics ADD COLUMN submitted_at TEXT`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE comics ADD COLUMN reviewed_by INTEGER`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE comics ADD COLUMN review_notes TEXT`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE comics ADD COLUMN last_reviewed_at TEXT`);
} catch (e) {}

try {
  db.exec(`ALTER TABLE comics ADD COLUMN price_cents INTEGER DEFAULT 0`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE comics ADD COLUMN cover_image TEXT`);
} catch (e) {}

// Pages / choices columns added after first production DBs were created
try {
  db.exec(`ALTER TABLE pages ADD COLUMN title TEXT DEFAULT ''`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE pages ADD COLUMN text_content TEXT DEFAULT ''`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE pages ADD COLUMN is_start INTEGER DEFAULT 0`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE pages ADD COLUMN image_path TEXT`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE choices ADD COLUMN choice_image TEXT`);
} catch (e) {}

// Credits wallet, chapters, creator earnings
credits.initCreditSchema(db);

// Create unique index on email if it doesn't exist
try {
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
} catch (e) {}

// NOTE: Do NOT auto-publish comics on startup.
// Public browse only shows status = 'published'.
// Creators must: draft → submit → editor approve → creator publish.

// Ensure any legacy null statuses are drafts (not public)
try {
  db.prepare(`
    UPDATE comics SET status = 'draft' WHERE status IS NULL OR status = ''
  `).run();
} catch (e) {}


// Multer config - use memory storage so we can pass buffer to abstracted storage service
// (local disk for PoC, easy to swap to R2/S3 later)
// Per-file limit: comic panels can be large; keep under typical Nginx body size (100MB).
const MAX_IMAGE_BYTES = 25 * 1024 * 1024; // 25MB per file
const MAX_BULK_FILES = 25;
const MAX_BULK_TOTAL_BYTES = 100 * 1024 * 1024; // 100MB per bulk request

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_IMAGE_BYTES,
    files: MAX_BULK_FILES
  },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPEG, PNG, WebP, and GIF images allowed'));
  }
});

// Wrap multer so oversize files return a clear JSON message (not a blank 500)
function uploadSingle(field) {
  return (req, res, next) => {
    imageUpload.single(field)(req, res, (err) => {
      if (!err) return next();
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          error: `Image too large. Max ${MAX_IMAGE_BYTES / (1024 * 1024)}MB per file. Compress or resize, then try again.`
        });
      }
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: err.message || 'Upload error' });
      }
      return res.status(400).json({ error: err.message || 'Upload error' });
    });
  };
}

function uploadArray(field, maxCount) {
  return (req, res, next) => {
    imageUpload.array(field, maxCount)(req, res, (err) => {
      if (!err) return next();
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          error: `One or more images exceed ${MAX_IMAGE_BYTES / (1024 * 1024)}MB. Compress them or upload a smaller batch.`
        });
      }
      if (err instanceof multer.MulterError && (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE')) {
        return res.status(400).json({
          error: `Too many files. Max ${MAX_BULK_FILES} images per upload.`
        });
      }
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: err.message || 'Upload error' });
      }
      return res.status(400).json({ error: err.message || 'Upload error' });
    });
  };
}

// Helper to generate a unique filename (reused for key)
function generateImageFilename(originalName) {
  const ext = path.extname(originalName) || '.jpg';
  // Keep a simple counter for uniqueness within process
  global.fileCounter = (global.fileCounter || 0) + 1;
  const unique = Date.now() + '-' + (global.fileCounter % 1000000) + '-' + Math.random().toString(36).substring(2, 10);
  return `page-${unique}${ext}`;
}

// Middleware to resolve comicId for choice routes (since route is /pages/:pageId not /comics/:comicId)
function resolveComicForChoice(req, res, next) {
  if (!req.params.comicId && req.params.pageId) {
    const fromPage = db.prepare('SELECT comic_id FROM pages WHERE id = ?').get(req.params.pageId);
    if (fromPage && fromPage.comic_id) {
      req.params.comicId = fromPage.comic_id;
    }
  }
  next();
}

// Stripe webhook needs raw body — register before express.json()
app.post('/api/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(400).send('Webhook not configured');
  }

  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed', err);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const meta = session.metadata || {};

    if (meta.type === 'credit_topup' && meta.user_id) {
      try {
        const paid = parseInt(meta.package_cents || session.amount_total || 0, 10);
        const pi = typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id;
        const result = credits.grantTopup(db, parseInt(meta.user_id, 10), paid, pi || session.id);
        console.log(`Credit top-up user ${meta.user_id}: +${result.credits_granted} credits`);
      } catch (e) {
        console.error('Credit top-up webhook failed:', e);
      }
    } else if (meta.type === 'full_story' && meta.comic_id && meta.buyer_id) {
      try {
        const comicId = parseInt(meta.comic_id, 10);
        const buyerId = parseInt(meta.buyer_id, 10);
        const comic = db.prepare('SELECT * FROM comics WHERE id = ?').get(comicId);
        if (comic) {
          const pi = typeof session.payment_intent === 'string'
            ? session.payment_intent
            : session.payment_intent?.id;
          db.prepare(`
            INSERT OR IGNORE INTO purchases (user_id, comic_id, amount_paid_cents, stripe_payment_intent)
            VALUES (?, ?, ?, ?)
          `).run(buyerId, comicId, comic.price_cents || session.amount_total || 0, pi || null);

          // Earnings already paid out via Connect application_fee on this charge —
          // still record for reporting if not present
          const existingEarn = db.prepare(`
            SELECT id FROM creator_earnings
            WHERE buyer_id = ? AND comic_id = ? AND source = 'stripe_full' LIMIT 1
          `).get(buyerId, comicId);
          if (!existingEarn) {
            credits.recordCreatorEarning(db, {
              creatorId: comic.user_id,
              buyerId,
              comicId,
              grossCents: comic.price_cents || session.amount_total || 0,
              source: 'stripe_full',
            });
            // Stripe already transferred to creator; mark as paid immediately for stripe_full
            db.prepare(`
              UPDATE creator_earnings
              SET status = 'paid', paid_at = datetime('now')
              WHERE buyer_id = ? AND comic_id = ? AND source = 'stripe_full' AND status = 'pending'
            `).run(buyerId, comicId);
          }
        }
      } catch (e) {
        console.error('Full story purchase webhook failed:', e);
      }
    } else if (meta.userId) {
      db.prepare(`
        UPDATE users SET is_premium = 1, subscription_status = 'active' WHERE id = ?
      `).run(meta.userId);
      console.log(`User ${meta.userId} upgraded to premium`);
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    const user = db.prepare('SELECT id FROM users WHERE stripe_customer_id = ?').get(subscription.customer);
    if (user) {
      db.prepare(`
        UPDATE users SET is_premium = 0, subscription_status = 'canceled' WHERE id = ?
      `).run(user.id);
    }
  }

  res.json({ received: true });
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Secure session configuration
const sessionSecret = process.env.SESSION_SECRET || 'dev-only-change-this-in-production';
// Ensure data directory exists for session store
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  store: new SQLiteStore({
    db: 'sessions.db',
    dir: dataDir,
    table: 'sessions'
  }),
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7, // default 7 days (overridden by rememberMe)
    httpOnly: true,
    // Secure cookies only work over HTTPS. Using them on http://droplet-ip
    // makes login/signup appear broken (session never sticks).
    secure: appUrlIsHttps,
    sameSite: 'lax'
  }
}));

// Serve frontend
app.use(express.static(path.join(__dirname, 'public')));

// Serve uploads only for local storage (PoC). Cloud storage will use CDN URLs.
if (!process.env.STORAGE_TYPE || process.env.STORAGE_TYPE === 'local') {
  app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
}

// === EMAIL SETUP ===
// Supports: Mailtrap, Resend, generic SMTP, or Ethereal (dev fallback)
let emailClient = null;

async function getEmailClient() {
  if (emailClient) return emailClient;

  // Mailtrap (great for dev testing)
  if (process.env.MAILTRAP_USER && process.env.MAILTRAP_PASS) {
    const nodemailer = require('nodemailer');
    emailClient = {
      type: 'mailtrap',
      send: async (mailOptions) => {
        const transporter = nodemailer.createTransport({
          host: "sandbox.smtp.mailtrap.io",
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
      }
    };
    console.log('📧 Using Mailtrap for emails');
    return emailClient;
  }

  // Resend (clean for production)
  if (process.env.RESEND_API_KEY) {
    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    emailClient = {
      type: 'resend',
      send: async (mailOptions) => {
        const { data, error } = await resend.emails.send({
          from: mailOptions.from,
          to: mailOptions.to,
          subject: mailOptions.subject,
          html: mailOptions.html,
        });
        if (error) throw error;
        console.log('📧 Email sent via Resend');
        return data;
      }
    };
    console.log('📧 Using Resend for emails');
    return emailClient;
  }

  // Generic nodemailer SMTP
  if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || 'smtp.ethereal.email',
      port: parseInt(process.env.EMAIL_PORT || '587'),
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
    emailClient = {
      type: 'smtp',
      send: (opts) => transporter.sendMail(opts)
    };
    return emailClient;
  }

  // Fallback: Ethereal (development)
  const nodemailer = require('nodemailer');
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
    }
  };
  console.log('📧 Using Ethereal (dev) - check console for preview links');
  return emailClient;
}

async function sendEmail(to, subject, html) {
  const client = await getEmailClient();
  const from = process.env.EMAIL_FROM || '"Pick Your Path Stories" <no-reply@pypstories.com>';
  return client.send({ from, to, subject, html });
}

async function sendVerificationEmail(email, token) {
  const verifyUrl = `${APP_URL}/verify?token=${token}`;
  const html = `
    <div style="font-family: system-ui, sans-serif; max-width: 520px; margin: 0 auto; padding: 20px;">
      <h2>Welcome to Pick Your Path Stories!</h2>
      <p>Please verify your email address to activate your account:</p>
      <p style="margin: 24px 0;">
        <a href="${verifyUrl}" style="background:#3b82f6;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:500;">
          Verify Email Address
        </a>
      </p>
      <p style="color:#64748b;font-size:14px;">Or copy this link:<br>${verifyUrl}</p>
      <p style="color:#64748b;font-size:14px;">This link expires in 24 hours.</p>
    </div>
  `;

  await sendEmail(email, 'Verify your email for Pick Your Path Stories', html);
  console.log(`\n✅ Verification email sent to ${email}`);
  console.log('   If using Ethereal/Mailtrap, check the link in your server console or the test inbox.\n');
}

async function sendPasswordResetEmail(email, token) {
  const resetUrl = `${APP_URL}/reset-password?token=${token}`;
  const html = `
    <div style="font-family: system-ui, sans-serif; max-width: 520px; margin: 0 auto; padding: 20px;">
      <h2>Reset your password</h2>
      <p>You requested a password reset for your Pick Your Path Stories account.</p>
      <p style="margin: 24px 0;">
        <a href="${resetUrl}" style="background:#3b82f6;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:500;">
          Reset Password
        </a>
      </p>
      <p style="color:#64748b;font-size:14px;">Or copy this link:<br>${resetUrl}</p>
      <p style="color:#64748b;font-size:14px;">This link expires in 1 hour. If you didn't request this, ignore this email.</p>
    </div>
  `;

  await sendEmail(email, 'Reset your password - Pick Your Path Stories', html);
  console.log(`\n✅ Password reset email sent to ${email}`);
  console.log('   If using Ethereal/Mailtrap, check the link in your server console or the test inbox.\n');
}

async function sendStoryApprovedEmail(email, comicTitle, comicId, notes = '') {
  const html = `
    <div style="font-family: system-ui, sans-serif; max-width: 520px; margin: 0 auto; padding: 20px;">
      <h2>🎉 Your story has been approved!</h2>
      <p>Great news — <strong>${comicTitle}</strong> has passed review and is ready to publish.</p>
      ${notes ? `<p><strong>Editor notes:</strong><br>${notes}</p>` : ''}
      <p>You can now publish it from your editor.</p>
      <p style="color:#64748b;font-size:14px;">Thank you for creating on Pick Your Path Stories!</p>
    </div>
  `;
  await sendEmail(email, `Your story "${comicTitle}" has been approved`, html);
  console.log(`\n✅ Approval notification sent to ${email} for "${comicTitle}"`);
}

async function sendStoryChangesRequestedEmail(email, comicTitle, comicId, notes = '') {
  const html = `
    <div style="font-family: system-ui, sans-serif; max-width: 520px; margin: 0 auto; padding: 20px;">
      <h2>📝 Changes requested for your story</h2>
      <p>Your story <strong>${comicTitle}</strong> has been reviewed. The editor has requested some changes before it can be published.</p>
      ${notes ? `<p><strong>Editor notes:</strong><br>${notes}</p>` : ''}
      <p>Please update your story and re-submit it for review when ready.</p>
      <p style="color:#64748b;font-size:14px;">Thank you!</p>
    </div>
  `;
  await sendEmail(email, `Changes requested for "${comicTitle}"`, html);
  console.log(`\n✅ Changes requested notification sent to ${email} for "${comicTitle}"`);
}

// === AUTH HELPERS ===
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.status(401).json({ error: 'Not logged in' });
}

function getCurrentUser(req) {
  if (!req.session.userId) return null;
  const user = db.prepare(`
    SELECT id, email, username, email_verified, is_premium, subscription_status, created_at, role,
           stripe_account_id, stripe_customer_id, credit_balance_cents
    FROM users WHERE id = ?
  `).get(req.session.userId);
  return user || null;
}

function requireVerified(req, res, next) {
  const user = getCurrentUser(req);
  if (user && user.email_verified) return next();
  return res.status(403).json({ error: 'Please verify your email address first' });
}

// SQLite may return numbers while session ids are sometimes strings — never use !== alone
function sameUserId(a, b) {
  return a != null && b != null && Number(a) === Number(b);
}

function requireEditor(req, res, next) {
  const user = getCurrentUser(req);
  if (user && (user.role === 'editor' || user.role === 'admin')) {
    return next();
  }
  return res.status(403).json({ error: 'Editor or admin access required' });
}

function userHasFullAccess(userId, comicId) {
  const comic = db.prepare('SELECT user_id, reviewed_by, status FROM comics WHERE id = ?').get(comicId);
  if (!comic) return false;
  if (Number(comic.user_id) === Number(userId)) return true;
  // Reviewer who claimed it for review gets full access (bypass paywall)
  if (comic.reviewed_by && Number(comic.reviewed_by) === Number(userId)) {
    return true;  // covers in_review, and even if status changed while reviewing
  }
  const purchase = db.prepare(`
    SELECT 1 FROM purchases WHERE user_id = ? AND comic_id = ?
  `).get(userId, comicId);
  if (purchase) return true;

  // Full access if every paid chapter is unlocked (or there are no paid chapters)
  const paidChapters = db.prepare(`
    SELECT id FROM chapters WHERE comic_id = ? AND price_cents > 0
  `).all(comicId);
  if (paidChapters.length > 0) {
    const unlocked = db.prepare(`
      SELECT COUNT(*) as c FROM chapter_unlocks
      WHERE user_id = ? AND comic_id = ? AND chapter_id IN (
        SELECT id FROM chapters WHERE comic_id = ? AND price_cents > 0
      )
    `).get(userId, comicId, comicId);
    if (unlocked && unlocked.c >= paidChapters.length) return true;
  }
  return false;
}

// === AUTH ROUTES ===

// Apply rate limiting to auth endpoints
app.post('/api/register', authLimiter, async (req, res) => {
  const { email, password, username } = req.body;

  // Validation
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters long' });
  }

  // Check if email already exists
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  // Check username uniqueness if provided
  if (username && username.length > 0) {
    const usernameExists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (usernameExists) {
      return res.status(409).json({ error: 'Username is already taken' });
    }
  }

  const hash = bcrypt.hashSync(password, 12); // Increased rounds for security

  // Generate verification token
  const verificationToken = crypto.randomBytes(32).toString('hex');
  const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours

  const result = db.prepare(`
    INSERT INTO users (email, username, password_hash, verification_token, verification_expires, email_verified)
    VALUES (?, ?, ?, ?, ?, 0)
  `).run(email.toLowerCase(), username || null, hash, verificationToken, verificationExpires);

  const userId = result.lastInsertRowid;

  // Send verification email
  try {
    await sendVerificationEmail(email, verificationToken);
  } catch (emailErr) {
    console.error('Failed to send verification email:', emailErr);
    // Continue anyway - user can request resend
  }

  // Do NOT log the user in until verified
  res.json({ 
    success: true, 
    message: 'Account created. Please check your email (and spam/junk folder) to verify your account.',
    requiresVerification: true,
    email: email.toLowerCase()
  });
});

app.post('/api/login', authLimiter, (req, res) => {
  const { email, password, rememberMe } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  if (!user.email_verified) {
    return res.status(403).json({ 
      error: 'Please verify your email address before logging in. Check your inbox and spam/junk folder.',
      requiresVerification: true,
      email: user.email 
    });
  }

  // Regenerate session for security
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Session error' });

    req.session.userId = user.id;

    // Set cookie duration based on rememberMe
    // Default: 7 days; Remember me: 30 days
    const days = rememberMe ? 30 : 7;
    req.session.cookie.maxAge = 1000 * 60 * 60 * 24 * days;

    req.session.save((saveErr) => {
      if (saveErr) return res.status(500).json({ error: 'Session save error' });

      res.json({ 
        success: true, 
        user: { 
          id: user.id, 
          email: user.email, 
          username: user.username,
          email_verified: !!user.email_verified 
        } 
      });
    });
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

app.get('/api/me', (req, res) => {
  const user = getCurrentUser(req);
  res.json({ user });
});

// Email verification endpoint
app.post('/api/verify-email', async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ error: 'Verification token is required' });
  }

  const user = db.prepare(`
    SELECT * FROM users 
    WHERE verification_token = ? AND verification_expires > datetime('now')
  `).get(token);

  if (!user) {
    return res.status(400).json({ error: 'Invalid or expired verification link' });
  }

  db.prepare(`
    UPDATE users 
    SET email_verified = 1, verification_token = NULL, verification_expires = NULL 
    WHERE id = ?
  `).run(user.id);

  // Auto-login after successful verification
  req.session.userId = user.id;

  res.json({ 
    success: true, 
    message: 'Email verified successfully!',
    user: { 
      id: user.id, 
      email: user.email, 
      username: user.username,
      email_verified: true 
    }
  });
});

// Resend verification email
app.post('/api/resend-verification', authLimiter, async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());

  if (!user) {
    // Don't reveal if user exists
    return res.json({ success: true, message: 'If an account exists, a verification email has been sent. Check your inbox and spam/junk folder.' });
  }

  if (user.email_verified) {
    return res.json({ success: true, message: 'This email is already verified. You can log in.' });
  }

  // Generate new token
  const verificationToken = crypto.randomBytes(32).toString('hex');
  const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  db.prepare(`
    UPDATE users SET verification_token = ?, verification_expires = ? WHERE id = ?
  `).run(verificationToken, verificationExpires, user.id);

  try {
    await sendVerificationEmail(user.email, verificationToken);
  } catch (err) {
    console.error('Failed to send resend verification email:', err.message || err);
    return res.status(502).json({
      error: 'Could not send verification email. Please try again in a few minutes or contact support.',
    });
  }

  res.json({ success: true, message: 'Verification email has been resent. Check your inbox and spam/junk folder (Yahoo and others often filter these).' });
});

// Get current verification status
app.get('/api/verification-status', (req, res) => {
  const user = getCurrentUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  res.json({ email_verified: !!user.email_verified, email: user.email });
});

// === PASSWORD RESET ===

app.post('/api/forgot-password', authLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  // Always return success to avoid user enumeration
  if (!user) {
    return res.json({ success: true, message: 'If an account exists, a reset link has been sent.' });
  }

  const resetToken = crypto.randomBytes(32).toString('hex');
  const resetExpires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

  db.prepare(`
    UPDATE users SET password_reset_token = ?, password_reset_expires = ? WHERE id = ?
  `).run(resetToken, resetExpires, user.id);

  try {
    await sendPasswordResetEmail(user.email, resetToken);
  } catch (e) {
    console.error('Failed to send reset email', e);
  }

  res.json({ success: true, message: 'If an account exists, a reset link has been sent.' });
});

app.post('/api/reset-password', authLimiter, async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) {
    return res.status(400).json({ error: 'Token and new password required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const user = db.prepare(`
    SELECT * FROM users 
    WHERE password_reset_token = ? AND password_reset_expires > datetime('now')
  `).get(token);

  if (!user) {
    return res.status(400).json({ error: 'Invalid or expired reset link' });
  }

  const hash = bcrypt.hashSync(password, 12);
  db.prepare(`
    UPDATE users 
    SET password_hash = ?, password_reset_token = NULL, password_reset_expires = NULL 
    WHERE id = ?
  `).run(hash, user.id);

  res.json({ success: true, message: 'Password reset successfully. You can now log in.' });
});

// Change password for logged-in user (requires knowing current password)
app.post('/api/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword, confirmNewPassword } = req.body;

  if (!currentPassword || !newPassword || !confirmNewPassword) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  if (newPassword !== confirmNewPassword) {
    return res.status(400).json({ error: 'New passwords do not match' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  if (currentPassword === newPassword) {
    return res.status(400).json({ error: 'New password must be different from the current password' });
  }

  const hash = bcrypt.hashSync(newPassword, 12);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);

  res.json({ success: true, message: 'Password changed successfully.' });
});

// === STRIPE PAYMENTS (Premium access) ===

app.post('/api/create-checkout-session', requireAuth, async (req, res) => {
  if (!stripe) {
    return res.status(500).json({ error: 'Payments not configured' });
  }

  const user = getCurrentUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });

  try {
    let customerId = user.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { userId: user.id }
      });
      customerId = customer.id;
      db.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').run(customerId, user.id);
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer: customerId,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Premium Membership',
              description: 'Unlock unlimited story creation and premium features on Pick Your Path Stories',
            },
            unit_amount: 999, // $9.99
            recurring: { interval: 'month' },
          },
          quantity: 1,
        },
      ],
      success_url: `${APP_URL}/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_URL}/`,
      metadata: { userId: user.id }
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// Get current subscription status
app.get('/api/subscription', requireAuth, (req, res) => {
  const user = getCurrentUser(req);
  res.json({
    is_premium: !!user.is_premium,
    subscription_status: user.subscription_status || 'none'
  });
});

// === CREDITS (1 credit = $0.01) ===

app.get('/api/credits/balance', requireAuth, (req, res) => {
  const balance = credits.getBalance(db, req.session.userId);
  res.json({
    balance_cents: balance,
    balance_dollars: (balance / 100).toFixed(2),
    min_topup_cents: credits.CREDIT_MIN_TOPUP_CENTS,
    bonus_threshold_cents: credits.CREDIT_BONUS_THRESHOLD_CENTS,
    bonus_rate: credits.CREDIT_BONUS_RATE,
  });
});

app.get('/api/credits/packages', (req, res) => {
  res.json({
    packages: credits.CREDIT_PACKAGES.map(p => {
      const info = credits.packageInfo(p.cents);
      return {
        ...p,
        credits_granted: info.credits_granted,
        bonus_credits: info.bonus_credits,
        label_detail: info.bonus_credits > 0
          ? `${p.label} → $${(info.credits_granted / 100).toFixed(2)} credits (includes 10% bonus)`
          : `${p.label} → $${(info.credits_granted / 100).toFixed(2)} credits`,
      };
    }),
    note: 'Stripe processing fees are absorbed by the platform. You receive full face value in credits (plus bonus when eligible).',
  });
});

app.get('/api/credits/ledger', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT id, delta_cents, balance_after, kind, note, comic_id, chapter_id, created_at
    FROM credit_ledger
    WHERE user_id = ?
    ORDER BY id DESC
    LIMIT 50
  `).all(req.session.userId);
  res.json(rows);
});

// Stripe Checkout top-up — buyer pays package amount; fees absorbed by platform
app.post('/api/credits/topup', requireAuth, requireVerified, async (req, res) => {
  if (!stripe) return res.status(500).json({ error: 'Payments not configured' });

  const packageCents = Math.round(Number(req.body.package_cents) || 0);
  const allowed = credits.CREDIT_PACKAGES.some(p => p.cents === packageCents);
  if (!allowed || packageCents < credits.CREDIT_MIN_TOPUP_CENTS) {
    return res.status(400).json({ error: 'Invalid package. Minimum top-up is $5.' });
  }

  const info = credits.packageInfo(packageCents);
  const user = getCurrentUser(req);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: user.email,
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'PYPStories Credits',
            description: info.bonus_credits > 0
              ? `$${(packageCents / 100).toFixed(2)} + 10% bonus = $${(info.credits_granted / 100).toFixed(2)} credits`
              : `$${(info.credits_granted / 100).toFixed(2)} in credits (1 credit = $0.01)`,
          },
          unit_amount: packageCents,
        },
        quantity: 1,
      }],
      success_url: `${APP_URL}/?credits=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_URL}/?credits=cancel`,
      metadata: {
        type: 'credit_topup',
        user_id: String(req.session.userId),
        package_cents: String(packageCents),
        credits_granted: String(info.credits_granted),
      },
    });
    res.json({ url: session.url, ...info });
  } catch (err) {
    console.error('Credit top-up error:', err);
    res.status(500).json({ error: 'Failed to start credit purchase' });
  }
});

// Dev / success-redirect fallback when webhooks are not configured
app.post('/api/credits/topup-complete', requireAuth, async (req, res) => {
  const { session_id } = req.body;
  if (!stripe || !session_id) {
    return res.status(400).json({ error: 'session_id required' });
  }
  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (session.payment_status !== 'paid') {
      return res.status(400).json({ error: 'Payment not completed' });
    }
    if (session.metadata?.type !== 'credit_topup') {
      return res.status(400).json({ error: 'Not a credit top-up session' });
    }
    if (String(session.metadata.user_id) !== String(req.session.userId)) {
      return res.status(403).json({ error: 'Session does not belong to you' });
    }
    const paid = parseInt(session.metadata.package_cents || session.amount_total || 0, 10);
    const pi = typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id;
    const result = credits.grantTopup(db, req.session.userId, paid, pi || session.id);
    res.json({ success: true, ...result });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not complete top-up' });
  }
});

// Buy full story with credits (bundle / complete work, min $5.99)
app.post('/api/comics/:id/purchase-credits', requireAuth, requireVerified, (req, res) => {
  try {
    const result = credits.purchaseFullStoryWithCredits(db, req.session.userId, parseInt(req.params.id, 10));
    res.json({ success: true, ...result });
  } catch (e) {
    const msg = e.message || 'Purchase failed';
    const status = msg.includes('Insufficient') ? 400 : msg.includes('not found') ? 404 : 400;
    res.status(status).json({ error: msg });
  }
});

// Buy a comic outright via Stripe (full story / bundle only, min $5.99)
app.post('/api/comics/:id/purchase', requireAuth, async (req, res) => {
  if (!stripe) return res.status(500).json({ error: 'Payments not configured' });

  const comicId = req.params.id;
  const user = getCurrentUser(req);

  const comic = db.prepare('SELECT * FROM comics WHERE id = ?').get(comicId);
  if (!comic || !comic.price_cents || comic.price_cents < credits.FULL_STORY_MIN_CENTS) {
    return res.status(400).json({
      error: `Full stories/bundles must be at least $${(credits.FULL_STORY_MIN_CENTS / 100).toFixed(2)}. Use chapter pricing with credits for smaller amounts.`,
    });
  }
  const pageCount = db.prepare('SELECT COUNT(*) as cnt FROM pages WHERE comic_id = ?').get(comicId).cnt;
  if (pageCount < 8) {
    return res.status(400).json({ error: 'Paid stories must have at least 8 pages for quality.' });
  }

  const creator = db.prepare('SELECT * FROM users WHERE id = ?').get(comic.user_id);
  if (!creator || !creator.stripe_account_id) {
    return res.status(400).json({ error: 'Creator has not set up payouts yet' });
  }

  if (Number(comic.user_id) === Number(req.session.userId)) {
    return res.json({ success: true, message: 'You own this comic' });
  }

  const already = db.prepare('SELECT 1 FROM purchases WHERE user_id = ? AND comic_id = ?').get(req.session.userId, comicId);
  if (already) return res.json({ success: true, message: 'Already purchased' });

  try {
    const total = comic.price_cents;

    // Approved split: Stripe fee from total, then platform 15% (10% after $2k creator volume) of net
    const stripeFee = Math.round(total * 0.029) + 30;
    const net = Math.max(0, total - stripeFee);
    const platformRate = credits.getPlatformRate(db, comic.user_id);
    const platformFee = Math.round(net * platformRate);

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: user.email,
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: comic.title, description: 'Full story / bundle — Pick Your Path Stories' },
          unit_amount: total,
        },
        quantity: 1,
      }],
      success_url: `${APP_URL}/?purchased=${comicId}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_URL}/`,
      payment_intent_data: {
        application_fee_amount: platformFee,
        transfer_data: {
          destination: creator.stripe_account_id,
        },
      },
      metadata: {
        type: 'full_story',
        comic_id: String(comicId),
        buyer_id: String(req.session.userId),
        platform_fee: String(platformFee),
        creator_id: String(comic.user_id),
      }
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Purchase error:', err);
    res.status(500).json({ error: 'Failed to create purchase session' });
  }
});

// Record successful purchase (success redirect fallback)
app.post('/api/comics/:id/purchase-complete', requireAuth, (req, res) => {
  const comicId = req.params.id;
  const { payment_intent } = req.body;

  const comic = db.prepare('SELECT price_cents FROM comics WHERE id = ?').get(comicId);
  if (!comic) return res.status(404).json({ error: 'Not found' });

  try {
    db.prepare(`
      INSERT OR IGNORE INTO purchases (user_id, comic_id, amount_paid_cents, stripe_payment_intent)
      VALUES (?, ?, ?, ?)
    `).run(req.session.userId, comicId, comic.price_cents, payment_intent || null);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to record purchase' });
  }
});

// === CHAPTERS ===

app.get('/api/comics/:id/chapters', (req, res) => {
  const comicId = req.params.id;
  const rows = db.prepare(`
    SELECT id, comic_id, title, sort_order, price_cents, created_at
    FROM chapters WHERE comic_id = ?
    ORDER BY sort_order ASC, id ASC
  `).all(comicId);

  let unlocked = new Set();
  let hasFull = false;
  if (req.session.userId) {
    hasFull = !!db.prepare(`
      SELECT 1 FROM purchases WHERE user_id = ? AND comic_id = ?
    `).get(req.session.userId, comicId);
    const unlocks = db.prepare(`
      SELECT chapter_id FROM chapter_unlocks WHERE user_id = ? AND comic_id = ?
    `).all(req.session.userId, comicId);
    unlocked = new Set(unlocks.map(u => u.chapter_id));
  }

  res.json(rows.map(ch => ({
    ...ch,
    price: ch.price_cents ? (ch.price_cents / 100).toFixed(2) : null,
    unlocked: hasFull || unlocked.has(ch.id) || !ch.price_cents,
  })));
});

app.post('/api/comics/:id/chapters', requireAuth, requireVerified, (req, res) => {
  const comicId = parseInt(req.params.id, 10);
  const comic = db.prepare('SELECT * FROM comics WHERE id = ?').get(comicId);
  if (!comic || !sameUserId(comic.user_id, req.session.userId)) {
    return res.status(403).json({ error: 'Not your comic' });
  }
  const title = (req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Title required' });

  let price_cents = Math.max(0, Math.round(parseFloat(req.body.price || 0) * 100));
  // Chapters can be free or any positive cent amount (e.g. $0.99); full-story min does not apply
  const maxOrder = db.prepare(`
    SELECT COALESCE(MAX(sort_order), 0) as m FROM chapters WHERE comic_id = ?
  `).get(comicId).m;

  const result = db.prepare(`
    INSERT INTO chapters (comic_id, title, sort_order, price_cents)
    VALUES (?, ?, ?, ?)
  `).run(comicId, title, maxOrder + 1, price_cents);

  const chapter = db.prepare('SELECT * FROM chapters WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(chapter);
});

app.patch('/api/chapters/:id', requireAuth, requireVerified, (req, res) => {
  const chapter = db.prepare(`
    SELECT ch.*, c.user_id as owner_id FROM chapters ch
    JOIN comics c ON c.id = ch.comic_id WHERE ch.id = ?
  `).get(req.params.id);
  if (!chapter || chapter.owner_id !== req.session.userId) {
    return res.status(403).json({ error: 'Not allowed' });
  }

  const updates = [];
  const values = [];
  if (req.body.title !== undefined) {
    updates.push('title = ?');
    values.push(String(req.body.title).trim());
  }
  if (req.body.price !== undefined) {
    updates.push('price_cents = ?');
    values.push(Math.max(0, Math.round(parseFloat(req.body.price) * 100)));
  }
  if (req.body.sort_order !== undefined) {
    updates.push('sort_order = ?');
    values.push(parseInt(req.body.sort_order, 10) || 0);
  }
  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
  values.push(chapter.id);
  db.prepare(`UPDATE chapters SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  res.json(db.prepare('SELECT * FROM chapters WHERE id = ?').get(chapter.id));
});

app.delete('/api/chapters/:id', requireAuth, requireVerified, (req, res) => {
  const chapter = db.prepare(`
    SELECT ch.*, c.user_id as owner_id FROM chapters ch
    JOIN comics c ON c.id = ch.comic_id WHERE ch.id = ?
  `).get(req.params.id);
  if (!chapter || chapter.owner_id !== req.session.userId) {
    return res.status(403).json({ error: 'Not allowed' });
  }
  db.prepare('DELETE FROM chapters WHERE id = ?').run(chapter.id);
  res.json({ success: true });
});

app.post('/api/chapters/:id/unlock', requireAuth, requireVerified, (req, res) => {
  try {
    const result = credits.unlockChapterWithCredits(db, req.session.userId, parseInt(req.params.id, 10));
    res.json({ success: true, ...result });
  } catch (e) {
    const msg = e.message || 'Unlock failed';
    const status = msg.includes('Insufficient') ? 400 : 400;
    res.status(status).json({ error: msg });
  }
});

// === CREATOR EARNINGS / PAYOUTS ===

app.get('/api/creator/earnings', requireAuth, (req, res) => {
  const summary = credits.getEarningsSummary(db, req.session.userId);
  const recent = db.prepare(`
    SELECT id, comic_id, chapter_id, gross_cents, platform_fee_cents, creator_cents,
           source, status, available_at, paid_at, created_at
    FROM creator_earnings
    WHERE creator_id = ?
    ORDER BY id DESC
    LIMIT 40
  `).all(req.session.userId);
  res.json({ summary, recent });
});

app.post('/api/creator/payout', requireAuth, requireVerified, async (req, res) => {
  try {
    const result = await credits.requestPayout(db, stripe, req.session.userId);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Payout failed' });
  }
});

// === COMICS ROUTES ===

// Browse / search comics
app.get('/api/comics', (req, res) => {
  const { q = '', genre = '', sort = 'new' } = req.query;
  const currentUserId = req.session.userId || 0;
  const isMy = req.query.my === '1' && currentUserId;

  let sql = `
    SELECT c.*, u.username as author,
      (SELECT COUNT(*) FROM pages WHERE comic_id = c.id) as page_count,
      c.status
    FROM comics c
    JOIN users u ON u.id = c.user_id
  `;
  const params = [];

  if (isMy) {
    sql += ` WHERE c.user_id = ? `;
    params.push(currentUserId);
  } else {
    sql += ` WHERE c.status = 'published' `;
  }

  if (q) {
    sql += ` AND (c.title LIKE ? OR c.description LIKE ? OR u.username LIKE ?)`;
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  if (genre && genre !== 'All') {
    sql += ` AND c.genre = ?`;
    params.push(genre);
  }

  if (sort === 'popular') {
    sql += ` ORDER BY c.view_count DESC, c.created_at DESC`;
  } else if (sort === 'price') {
    sql += ` ORDER BY c.price_cents ASC, c.title COLLATE NOCASE ASC`;
  } else if (sort === 'title') {
    sql += ` ORDER BY c.title COLLATE NOCASE ASC`;
  } else {
    // new
    sql += ` ORDER BY c.submitted_at DESC, c.created_at DESC`;
  }

  const comics = db.prepare(sql).all(...params);
  comics.forEach(c => {
    c.price = c.price_cents ? (c.price_cents / 100).toFixed(2) : null;
    // Fallback thumbnail: first page image if no cover uploaded
    if (!c.cover_image) {
      const first = db.prepare(`
        SELECT image_path FROM pages
        WHERE comic_id = ? AND image_path IS NOT NULL AND image_path != ''
        ORDER BY is_start DESC, id ASC
        LIMIT 1
      `).get(c.id);
      if (first && first.image_path) c.cover_image = first.image_path;
    }
  });
  res.json(comics);
});

// Get single comic + pages summary
app.get('/api/comics/:id', (req, res) => {
  const currentUser = getCurrentUser(req);
  const comic = db.prepare(`
    SELECT c.*, u.username as author, u.stripe_account_id
    FROM comics c JOIN users u ON u.id = c.user_id
    WHERE c.id = ?
  `).get(req.params.id);

  if (!comic) return res.status(404).json({ error: 'Comic not found' });

  const isOwner = currentUser && currentUser.id === comic.user_id;
  const isReviewer = currentUser && comic.reviewed_by && Number(comic.reviewed_by) === Number(currentUser.id);
  const isEditor = currentUser && (currentUser.role === 'editor' || currentUser.role === 'admin');

  if (comic.status !== 'published' && !isOwner && !isReviewer && !isEditor) {
    return res.status(403).json({ error: 'Not available' });
  }

  // Increment view count only for published public views
  if (comic.status === 'published') {
    db.prepare('UPDATE comics SET view_count = view_count + 1 WHERE id = ?').run(comic.id);
  }
  comic.view_count = (comic.view_count || 0) + 1;

  const pages = db.prepare('SELECT id, is_start FROM pages WHERE comic_id = ? ORDER BY id').all(comic.id);
  comic.pageCount = pages.length;
  comic.hasStart = pages.some(p => p.is_start);
  comic.price = comic.price_cents ? (comic.price_cents / 100).toFixed(2) : null;

  res.json(comic);
});

// Check if current user has purchased this comic
// Creators always have access to their own comics
app.get('/api/comics/:id/purchased', requireAuth, (req, res) => {
  const comicId = req.params.id;
  const userId = req.session.userId;

  if (userHasFullAccess(userId, comicId)) {
    return res.json({ purchased: true });
  }

  // Fallback (though userHasFullAccess already checks purchases)
  const purchase = db.prepare(`
    SELECT 1 FROM purchases WHERE user_id = ? AND comic_id = ?
  `).get(userId, comicId);
  res.json({ purchased: !!purchase });
});

// Get how many sample choices the (logged-in) user has used on this comic (now limited to the first choice)
app.get('/api/comics/:id/sample-progress', requireAuth, (req, res) => {
  const comicId = req.params.id;
  const userId = req.session.userId;

  if (userHasFullAccess(userId, comicId)) {
    return res.json({ choicesUsed: 0 });
  }

  const row = db.prepare(`
    SELECT choices_used FROM comic_sample_uses 
    WHERE user_id = ? AND comic_id = ?
  `).get(userId, comicId);
  res.json({ choicesUsed: row ? row.choices_used : 0 });
});

// Record that the user made one sample choice (increments the free sample counter; sample is now just the first page + its choices)
app.post('/api/comics/:id/sample-choice', requireAuth, (req, res) => {
  const comicId = req.params.id;
  const userId = req.session.userId;

  // If already purchased or is reviewer/owner, no need to count samples
  if (userHasFullAccess(userId, comicId)) {
    return res.json({ choicesUsed: 0, purchased: true });
  }

  const purchased = db.prepare(`
    SELECT 1 FROM purchases WHERE user_id = ? AND comic_id = ?
  `).get(userId, comicId);
  if (purchased) {
    return res.json({ choicesUsed: 0, purchased: true });
  }

  // Only count for priced comics
  const comic = db.prepare('SELECT price_cents FROM comics WHERE id = ?').get(comicId);
  if (!comic || !comic.price_cents) {
    return res.json({ choicesUsed: 0 });
  }

  // Increment (or initialize)
  db.prepare(`
    INSERT INTO comic_sample_uses (user_id, comic_id, choices_used)
    VALUES (?, ?, 1)
    ON CONFLICT(user_id, comic_id) DO UPDATE SET 
      choices_used = choices_used + 1,
      updated_at = CURRENT_TIMESTAMP
  `).run(userId, comicId);

  const row = db.prepare(`
    SELECT choices_used FROM comic_sample_uses 
    WHERE user_id = ? AND comic_id = ?
  `).get(userId, comicId);

  res.json({ choicesUsed: row ? row.choices_used : 0 });
});


// Create a new comic (only verified users)
app.post('/api/comics', requireAuth, requireVerified, (req, res) => {
  const { title, description = '', genre = 'Other', price = 0 } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });

  const price_cents = Math.max(0, Math.round(parseFloat(price) * 100));
  if (price_cents > 0 && price_cents < credits.FULL_STORY_MIN_CENTS) {
    return res.status(400).json({
      error: `Full story / bundle minimum is $${(credits.FULL_STORY_MIN_CENTS / 100).toFixed(2)}. Use $0 for free, or sell chapters (e.g. $0.99) with credits.`,
    });
  }

  // Always create as draft — never accept a client-supplied status
  const result = db.prepare(`
    INSERT INTO comics (user_id, title, description, genre, price_cents, status)
    VALUES (?, ?, ?, ?, ?, 'draft')
  `).run(req.session.userId, title, description, genre, price_cents);

  const comic = db.prepare('SELECT * FROM comics WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(comic);
});

// Update comic details (e.g. price) — status cannot be changed here
app.post('/api/comics/:id', requireAuth, requireVerified, (req, res) => {
  const comicId = req.params.id;
  const { title, description, genre, price, status } = req.body;

  if (status !== undefined) {
    return res.status(400).json({
      error: 'Cannot change story status here. Submit for review, then publish after approval.',
    });
  }

  const comic = db.prepare('SELECT * FROM comics WHERE id = ?').get(comicId);
  if (!comic || !sameUserId(comic.user_id, req.session.userId)) {
    return res.status(403).json({ error: 'Not your comic' });
  }

  let updates = [];
  let values = [];

  if (title !== undefined) {
    if (!title.trim()) return res.status(400).json({ error: 'Title is required' });
    updates.push('title = ?');
    values.push(title.trim());
  }
  if (description !== undefined) {
    updates.push('description = ?');
    values.push(description.trim());
  }
  if (genre !== undefined) {
    updates.push('genre = ?');
    values.push(genre);
  }
  if (price !== undefined) {
    const price_cents = Math.max(0, Math.round(parseFloat(price) * 100));
    if (price_cents > 0 && price_cents < credits.FULL_STORY_MIN_CENTS) {
      return res.status(400).json({
        error: `Full story / bundle minimum is $${(credits.FULL_STORY_MIN_CENTS / 100).toFixed(2)}. Chapters can be priced lower.`,
      });
    }
    updates.push('price_cents = ?');
    values.push(price_cents);
  }

  if (updates.length === 0) {
    return res.json(comic); // no changes
  }

  values.push(comicId);
  db.prepare(`UPDATE comics SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const updated = db.prepare('SELECT * FROM comics WHERE id = ?').get(comicId);
  updated.price = updated.price_cents ? (updated.price_cents / 100).toFixed(2) : null;
  res.json(updated);
});

// Upload / replace cover (thumbnail for browse cards)
app.post('/api/comics/:id/cover', requireAuth, requireVerified, uploadSingle('cover'), async (req, res) => {
  const comicId = req.params.id;
  const comic = db.prepare('SELECT * FROM comics WHERE id = ?').get(comicId);
  if (!comic || !sameUserId(comic.user_id, req.session.userId)) {
    return res.status(403).json({ error: 'Not your comic' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'Cover image required' });
  }

  const filename = generateImageFilename(req.file.originalname);
  const key = `comics/${comicId}/cover-${filename}`;
  await storageService.upload(req.file.buffer, key);
  const coverUrl = storageService.getPublicUrl(key);

  db.prepare('UPDATE comics SET cover_image = ? WHERE id = ?').run(coverUrl, comicId);

  const updated = db.prepare('SELECT * FROM comics WHERE id = ?').get(comicId);
  updated.price = updated.price_cents ? (updated.price_cents / 100).toFixed(2) : null;
  res.json(updated);
});

// === REVIEW WORKFLOW (Option A - Shared queue with claiming) ===

// Creator submits for review
app.post('/api/comics/:id/submit', requireAuth, requireVerified, (req, res) => {
  const comicId = req.params.id;
  const comic = db.prepare('SELECT * FROM comics WHERE id = ?').get(comicId);
  if (!comic || !sameUserId(comic.user_id, req.session.userId)) {
    return res.status(403).json({ error: 'Not your comic' });
  }
  if (comic.status !== 'draft' && comic.status !== 'changes_requested') {
    return res.status(400).json({ error: 'Can only submit drafts or stories where changes were requested' });
  }
  db.prepare(`
    UPDATE comics SET status = 'submitted', submitted_at = datetime('now')
    WHERE id = ?
  `).run(comicId);
  res.json({ success: true, status: 'submitted' });
});

// Review queue for editors
app.get('/api/admin/pending-stories', requireAuth, requireEditor, (req, res) => {
  const pending = db.prepare(`
    SELECT c.*, 
           u.username as author,
           (SELECT COUNT(*) FROM pages WHERE comic_id = c.id) as page_count,
           (SELECT username FROM users WHERE id = c.reviewed_by) as claimed_by
    FROM comics c
    JOIN users u ON u.id = c.user_id
    WHERE c.status IN ('submitted', 'in_review')
    ORDER BY c.submitted_at ASC
  `).all();
  res.json(pending);
});

// Claim for review (Option A)
app.post('/api/admin/pending/:id/claim', requireAuth, requireEditor, (req, res) => {
  const comicId = req.params.id;
  const userId = req.session.userId;

  const comic = db.prepare('SELECT * FROM comics WHERE id = ?').get(comicId);
  if (!comic) return res.status(404).json({ error: 'Not found' });

  if (comic.status !== 'submitted' && !(comic.status === 'in_review' && comic.reviewed_by === userId)) {
    return res.status(400).json({ error: 'Cannot claim this story' });
  }

  db.prepare(`
    UPDATE comics SET status = 'in_review', reviewed_by = ?
    WHERE id = ?
  `).run(userId, comicId);

  res.json({ success: true });
});

// Editor submits decision
app.post('/api/admin/review', requireAuth, requireEditor, async (req, res) => {
  const { comicId, decision, notes = '' } = req.body;
  const userId = req.session.userId;

  const comic = db.prepare('SELECT * FROM comics WHERE id = ?').get(comicId);
  if (!comic || comic.reviewed_by !== userId) {
    return res.status(403).json({ error: 'You must claim this story to review it' });
  }

  let newStatus;
  if (decision === 'approve') newStatus = 'approved';
  else if (decision === 'changes_requested') newStatus = 'changes_requested';
  else return res.status(400).json({ error: 'Invalid decision' });

  db.prepare(`
    UPDATE comics SET status = ?, review_notes = ?, last_reviewed_at = datetime('now')
    WHERE id = ?
  `).run(newStatus, notes, comicId);

  // Send email notification to creator
  try {
    const owner = db.prepare(`
      SELECT u.email, c.title 
      FROM comics c 
      JOIN users u ON u.id = c.user_id 
      WHERE c.id = ?
    `).get(comicId);

    if (owner && owner.email) {
      if (newStatus === 'approved') {
        await sendStoryApprovedEmail(owner.email, owner.title, comicId, notes);
      } else if (newStatus === 'changes_requested') {
        await sendStoryChangesRequestedEmail(owner.email, owner.title, comicId, notes);
      }
    }
  } catch (emailErr) {
    console.error('Failed to send review notification email:', emailErr);
    // Don't fail the review if email fails
  }

  res.json({ success: true, status: newStatus });
});

// Creator publishes after approval only (random creators cannot skip review)
app.post('/api/comics/:id/publish', requireAuth, requireVerified, (req, res) => {
  const comicId = req.params.id;
  const comic = db.prepare('SELECT * FROM comics WHERE id = ?').get(comicId);
  if (!comic || !sameUserId(comic.user_id, req.session.userId)) {
    return res.status(403).json({ error: 'Not your comic' });
  }
  if (comic.status !== 'approved') {
    return res.status(400).json({
      error: 'Story must be approved by an editor before publishing. Submit it for review first.',
    });
  }
  db.prepare(`UPDATE comics SET status = 'published' WHERE id = ?`).run(comicId);
  res.json({ success: true, status: 'published' });
});

// === END REVIEW WORKFLOW ===

// === PAGES & CHOICES ===

// Get all pages + choices for a comic (for reader + editor)
app.get('/api/comics/:id/pages', (req, res) => {
  const comicId = req.params.id;
  const currentUser = getCurrentUser(req);

  const comic = db.prepare('SELECT user_id, reviewed_by, status FROM comics WHERE id = ?').get(comicId);
  if (comic) {
    const isOwner = currentUser && Number(currentUser.id) === Number(comic.user_id);
    const isReviewer = currentUser && comic.reviewed_by && Number(comic.reviewed_by) === Number(currentUser.id);
    const isEditor = currentUser && (currentUser.role === 'editor' || currentUser.role === 'admin');
    if (comic.status !== 'published' && !isOwner && !isReviewer && !isEditor) {
      return res.status(403).json({ error: 'Not available' });
    }
  }

  const pages = db.prepare('SELECT * FROM pages WHERE comic_id = ? ORDER BY id ASC').all(comicId);

  const choices = db.prepare(`
    SELECT ch.*, p_from.id as from_id
    FROM choices ch
    JOIN pages p_from ON p_from.id = ch.from_page_id
    WHERE p_from.comic_id = ?
  `).all(comicId);

  // Attach choices to pages
  const pageMap = {};
  pages.forEach(p => {
    p.choices = [];
    pageMap[p.id] = p;
  });

  choices.forEach(ch => {
    if (pageMap[ch.from_page_id]) {
      pageMap[ch.from_page_id].choices.push({
        id: ch.id,
        text: ch.choice_text,
        to_page_id: ch.to_page_id,
        image: ch.choice_image || null
      });
    }
  });

  res.json({ pages });
});

// Upload a new page for a comic
app.post('/api/comics/:comicId/pages', requireAuth, requireVerified, uploadSingle('image'), async (req, res) => {
  try {
    const comicId = req.params.comicId;
    const { title = '', text_content = '', is_start = '0' } = req.body;

    // Verify ownership
    const comic = db.prepare('SELECT user_id FROM comics WHERE id = ?').get(comicId);
    if (!comic || !sameUserId(comic.user_id, req.session.userId)) {
      return res.status(403).json({ error: 'Not your comic' });
    }

    let imagePath = null;
    if (req.file) {
      const filename = generateImageFilename(req.file.originalname);
      const key = `comics/${comicId}/${filename}`;
      await storageService.upload(req.file.buffer, key);
      imagePath = storageService.getPublicUrl(key);
    }

    const result = db.prepare(`
      INSERT INTO pages (comic_id, title, image_path, text_content, is_start)
      VALUES (?, ?, ?, ?, ?)
    `).run(comicId, title, imagePath, text_content, is_start === '1' || is_start === 'true' ? 1 : 0);

    // If this is marked start, unmark any other starts
    if (is_start === '1' || is_start === 'true') {
      db.prepare('UPDATE pages SET is_start = 0 WHERE comic_id = ? AND id != ?')
        .run(comicId, result.lastInsertRowid);
    }

    const page = db.prepare('SELECT * FROM pages WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(page);
  } catch (err) {
    console.error('Page upload failed:', err);
    res.status(500).json({ error: 'Server failed to save the image. Check disk permissions on uploads/.' });
  }
});

// Bulk upload multiple pages (for mass image uploads when creating/editing stories)
app.post('/api/comics/:comicId/pages/bulk', requireAuth, requireVerified, uploadArray('images', MAX_BULK_FILES), async (req, res) => {
  try {
    const comicId = req.params.comicId;
    const files = req.files || [];

    if (!files.length) {
      return res.status(400).json({ error: 'No images provided' });
    }

    // Total size safeguard for mass uploads
    const totalSize = files.reduce((sum, f) => sum + (f.size || 0), 0);
    if (totalSize > MAX_BULK_TOTAL_BYTES) {
      return res.status(413).json({
        error: `Total upload exceeds ${MAX_BULK_TOTAL_BYTES / (1024 * 1024)}MB for this batch. Upload in smaller groups.`
      });
    }

    // Verify ownership
    const comic = db.prepare('SELECT user_id FROM comics WHERE id = ?').get(comicId);
    if (!comic || !sameUserId(comic.user_id, req.session.userId)) {
      return res.status(403).json({ error: 'Not your comic' });
    }

    const inserted = [];
    const { title_prefix = '' } = req.body;

    for (const file of files) {
      const filename = generateImageFilename(file.originalname);
      const key = `comics/${comicId}/${filename}`;
      await storageService.upload(file.buffer, key);
      const imagePath = storageService.getPublicUrl(key);

      // Derive a nice title from original filename or use prefix + index
      let baseTitle = file.originalname ? path.parse(file.originalname).name : `Page`;
      baseTitle = baseTitle.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
      const title = title_prefix ? `${title_prefix} ${baseTitle}` : (baseTitle || `Page`);

      const result = db.prepare(`
        INSERT INTO pages (comic_id, title, image_path, text_content, is_start)
        VALUES (?, ?, ?, ?, 0)
      `).run(comicId, title, imagePath, ''); // text empty for bulk; user can edit later

      const newPage = db.prepare('SELECT * FROM pages WHERE id = ?').get(result.lastInsertRowid);
      inserted.push(newPage);
    }

    res.status(201).json({ pages: inserted, count: inserted.length });
  } catch (err) {
    console.error('Bulk page upload failed:', err);
    res.status(500).json({ error: 'Server failed to save images. Check disk permissions on uploads/.' });
  }
});

// Update an existing page's title, caption/text, and optionally the image
app.post('/api/pages/:pageId', requireAuth, requireVerified, uploadSingle('image'), async (req, res) => {
  const pageId = req.params.pageId;
  const { title = '', text_content = '' } = req.body;

  const page = db.prepare(`
    SELECT p.*, c.user_id, c.id as comic_id 
    FROM pages p JOIN comics c ON c.id = p.comic_id 
    WHERE p.id = ?
  `).get(pageId);

  if (!page || !sameUserId(page.user_id, req.session.userId)) {
    return res.status(403).json({ error: 'Not allowed' });
  }

  let imagePath = page.image_path;
  if (req.file) {
    const filename = generateImageFilename(req.file.originalname);
    const key = `comics/${page.comic_id}/${filename}`;
    await storageService.upload(req.file.buffer, key);
    imagePath = storageService.getPublicUrl(key);
  }

  db.prepare(`
    UPDATE pages 
    SET title = ?, image_path = ?, text_content = ?
    WHERE id = ?
  `).run(title, imagePath, text_content, pageId);

  const updated = db.prepare('SELECT * FROM pages WHERE id = ?').get(pageId);
  res.json(updated);
});

// Add a choice to a page (now supports image for visual choice instead of just text)
app.post('/api/pages/:pageId/choices', requireAuth, requireVerified, resolveComicForChoice, uploadSingle('image'), async (req, res) => {
  const { choice_text = '', to_page_id } = req.body;
  const fromPageId = req.params.pageId;

  if (!to_page_id) {
    return res.status(400).json({ error: 'to_page_id required' });
  }

  // Verify the user owns the comic that contains this from_page
  const fromPage = db.prepare(`
    SELECT p.*, c.user_id 
    FROM pages p JOIN comics c ON c.id = p.comic_id 
    WHERE p.id = ?
  `).get(fromPageId);

  if (!fromPage || !sameUserId(fromPage.user_id, req.session.userId)) {
    return res.status(403).json({ error: 'Not allowed' });
  }

  // Verify target page exists in same comic
  const target = db.prepare('SELECT comic_id FROM pages WHERE id = ?').get(to_page_id);
  if (!target || target.comic_id !== fromPage.comic_id) {
    return res.status(400).json({ error: 'Target page must be in the same comic' });
  }

  let choiceImage = null;
  if (req.file) {
    const filename = generateImageFilename(req.file.originalname);
    const key = `comics/${fromPage.comic_id}/${filename}`;
    await storageService.upload(req.file.buffer, key);
    choiceImage = storageService.getPublicUrl(key);
  }

  const result = db.prepare(`
    INSERT INTO choices (from_page_id, choice_text, to_page_id, choice_image)
    VALUES (?, ?, ?, ?)
  `).run(fromPageId, choice_text, to_page_id, choiceImage);

  res.status(201).json({ 
    id: result.lastInsertRowid, 
    text: choice_text, 
    to_page_id: to_page_id,
    image: choiceImage 
  });
});

// Simple delete page (bonus)
app.delete('/api/pages/:pageId', requireAuth, (req, res) => {
  const page = db.prepare(`
    SELECT p.*, c.user_id FROM pages p 
    JOIN comics c ON c.id = p.comic_id 
    WHERE p.id = ?
  `).get(req.params.pageId);

  if (!page || !sameUserId(page.user_id, req.session.userId)) {
    return res.status(403).json({ error: 'Not allowed' });
  }

  db.prepare('DELETE FROM pages WHERE id = ?').run(req.params.pageId);
  res.json({ success: true });
});

// Set a page as start for the comic
app.post('/api/pages/:pageId/set-start', requireAuth, requireVerified, (req, res) => {
  const pageId = req.params.pageId;
  const page = db.prepare(`
    SELECT p.*, c.user_id, c.id as comic_id FROM pages p 
    JOIN comics c ON c.id = p.comic_id 
    WHERE p.id = ?
  `).get(pageId);

  if (!page || !sameUserId(page.user_id, req.session.userId)) {
    return res.status(403).json({ error: 'Not allowed' });
  }

  // Unset all other starts for this comic
  db.prepare('UPDATE pages SET is_start = 0 WHERE comic_id = ?').run(page.comic_id);
  // Set this one
  db.prepare('UPDATE pages SET is_start = 1 WHERE id = ?').run(pageId);

  res.json({ success: true });
});

// Bulk set choices for a page (for the story builder widget)
app.post('/api/pages/:pageId/set-choices', requireAuth, requireVerified, (req, res) => {
  const fromPageId = req.params.pageId;
  // array of {to_page_id, choice_image?, text? / choice_text?} up to 3
  // optional parallel labels: ["label0", "label1", "label2"]
  const { choices, labels } = req.body || {};

  console.log('[set-choices] page', fromPageId, 'body keys', Object.keys(req.body || {}));
  console.log('[set-choices] raw choices', JSON.stringify(choices, null, 2));
  console.log('[set-choices] raw labels', JSON.stringify(labels));

  if (!choices || !Array.isArray(choices) || choices.length > 3) {
    return res.status(400).json({ error: 'Up to 3 choices required' });
  }

  const fromPage = db.prepare(`
    SELECT p.*, c.user_id 
    FROM pages p JOIN comics c ON c.id = p.comic_id 
    WHERE p.id = ?
  `).get(fromPageId);

  if (!fromPage || !sameUserId(fromPage.user_id, req.session.userId)) {
    return res.status(403).json({ error: 'Not allowed' });
  }

  // Clear existing choices for this page
  db.prepare('DELETE FROM choices WHERE from_page_id = ?').run(fromPageId);

  const comicId = fromPage.comic_id;
  const labelList = Array.isArray(labels) ? labels : [];

  const saved = [];
  let slotIndex = 0;
  for (const ch of choices) {
    if (!ch.to_page_id) continue;

    // validate target
    const target = db.prepare('SELECT comic_id FROM pages WHERE id = ?').get(ch.to_page_id);
    if (!target || Number(target.comic_id) !== Number(comicId)) continue;

    const choiceImage = ch.choice_image || ch.image || null;
    // Accept text from multiple field names + parallel labels array (by filled-slot order)
    let choiceText = ch.text ?? ch.choice_text ?? ch.label ?? labelList[slotIndex] ?? '';
    if (choiceText == null) choiceText = '';
    choiceText = String(choiceText).trim().slice(0, 200);

    db.prepare(`
      INSERT INTO choices (from_page_id, choice_text, to_page_id, choice_image)
      VALUES (?, ?, ?, ?)
    `).run(fromPageId, choiceText, ch.to_page_id, choiceImage);

    saved.push({
      to_page_id: Number(ch.to_page_id),
      text: choiceText,
      image: choiceImage
    });
    slotIndex++;
  }

  console.log('[set-choices] saved', JSON.stringify(saved));
  res.json({ success: true, choices: saved });
});

// Update only choice labels for a page (order = current choices by id)
app.post('/api/pages/:pageId/choice-labels', requireAuth, requireVerified, (req, res) => {
  const fromPageId = req.params.pageId;
  const { labels } = req.body || {};

  const fromPage = db.prepare(`
    SELECT p.*, c.user_id 
    FROM pages p JOIN comics c ON c.id = p.comic_id 
    WHERE p.id = ?
  `).get(fromPageId);

  if (!fromPage || !sameUserId(fromPage.user_id, req.session.userId)) {
    return res.status(403).json({ error: 'Not allowed' });
  }

  if (!Array.isArray(labels)) {
    return res.status(400).json({ error: 'labels array required' });
  }

  const existing = db.prepare(`
    SELECT id FROM choices WHERE from_page_id = ? ORDER BY id ASC
  `).all(fromPageId);

  const updated = [];
  existing.forEach((row, i) => {
    const text = String(labels[i] ?? '').trim().slice(0, 200);
    db.prepare('UPDATE choices SET choice_text = ? WHERE id = ?').run(text, row.id);
    updated.push({ id: row.id, text });
  });

  console.log('[choice-labels] page', fromPageId, updated);
  res.json({ success: true, choices: updated });
});

// Creator connects Stripe account for payouts
app.post('/api/stripe/connect', requireAuth, async (req, res) => {
  if (!stripe) return res.status(500).json({ error: 'Payments not configured' });

  const user = getCurrentUser(req);
  let accountId = user.stripe_account_id;

  if (!accountId) {
    const account = await stripe.accounts.create({ type: 'express' });
    accountId = account.id;
    db.prepare('UPDATE users SET stripe_account_id = ? WHERE id = ?').run(accountId, req.session.userId);
  }

  const link = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${APP_URL}/`,
    return_url: `${APP_URL}/`,
    type: 'account_onboarding',
  });

  res.json({ url: link.url });
});

// Get list of genres for filter UI
app.get('/api/genres', (req, res) => {
  const genres = db.prepare('SELECT DISTINCT genre FROM comics ORDER BY genre').all();
  res.json(['All', ...genres.map(g => g.genre)]);
});

// Start page for reader
app.get('/api/comics/:id/start', (req, res) => {
  const comicId = req.params.id;
  let startPage = db.prepare('SELECT * FROM pages WHERE comic_id = ? AND is_start = 1 LIMIT 1').get(comicId);
  
  if (!startPage) {
    startPage = db.prepare('SELECT * FROM pages WHERE comic_id = ? ORDER BY id LIMIT 1').get(comicId);
  }
  
  if (!startPage) return res.status(404).json({ error: 'No pages yet' });

  // Load its choices
  startPage.choices = db.prepare(`
    SELECT choice_text as text, to_page_id, choice_image as image 
    FROM choices WHERE from_page_id = ?
  `).all(startPage.id);

  res.json(startPage);
});

// Get a single page with choices (for navigation)
app.get('/api/pages/:id', (req, res) => {
  const page = db.prepare('SELECT * FROM pages WHERE id = ?').get(req.params.id);
  if (!page) return res.status(404).json({ error: 'Page not found' });

  page.choices = db.prepare(`
    SELECT choice_text as text, to_page_id, choice_image as image 
    FROM choices WHERE from_page_id = ?
  `).all(page.id);

  res.json(page);
});

// === SERVE THE APP ===
// SPA fallback + robust static asset serving.
// This ensures CSS/JS always load even if the main static middleware has issues
// (e.g. when accessing via IP address on some network setups).
app.use((req, res) => {
  const reqPath = req.path;

  // Never serve HTML for API or uploads
  if (reqPath.startsWith('/api') || reqPath.startsWith('/uploads')) {
    return res.status(404).json({ error: 'Not found' });
  }

  // For asset files (css, js, images, etc.), try to serve them directly from public.
  // This acts as a fallback / safety net for IP access.
  if (/\.(css|js|map|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/i.test(reqPath)) {
    const filePath = path.join(__dirname, 'public', reqPath);
    return res.sendFile(filePath, (err) => {
      if (err) {
        res.status(404).send('Asset not found');
      }
    });
  }

  // Everything else (page routes) -> serve the SPA index.html
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Listen on all interfaces so LAN/phone access still works if needed
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`\n🚀 Pick Your Path Stories server running at http://localhost:${PORT}`);
  console.log(`   Database: ${dbPath}`);
  console.log(`   Uploads:  ${UPLOADS_DIR}\n`);
});
