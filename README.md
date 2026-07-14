# Pick Your Path Stories • PYPStories.com

A secure platform for uploading and reading **choose-your-own-adventure** stories and illustrated comics.

**Important:** This application is designed to handle sensitive user data (passwords, emails, and eventually payments). Follow security best practices below.

Live domain: **https://PYPStories.com** (when deployed)

## Features
- User accounts (register + login)
- Create stories with title, description, and genre/type
- Upload illustrated pages (images + text)
- Link choices between pages for real branching narratives
- Beautiful interactive reader — click choices to navigate the story
- Browse stories with search, filter by type/genre, sort by New / Popular / Title
- Fully self-contained (SQLite database + file uploads)

## Project location
All files live at:
```
E:\website\
```

## How to run

1. Make sure you're in the right folder:
   ```powershell
   cd E:\website
   ```

2. Start the server:
   ```powershell
   npm start
   ```

   Or for auto-reload on changes:
   ```powershell
   npm run dev
   ```

3. Open your browser to:
   **http://localhost:3000**

## How to use

### For readers
- Browse the homepage
- Filter by genre, search, or sort
- Click any story card to open the interactive reader
- Click the choice buttons to make decisions

### For creators
1. Click **Log in** and create an account (or use existing)
2. Go to **My Stories** (top nav)
3. Click **+ New Story**
4. Fill title + description + genre
5. After creation, use the editor:
   - **+ Add Page** → pick an image + optional text. You can mark it as the starting page.
   - For any page, click **+ Choice** → type the choice text → pick a destination page
   - You can chain pages together to make complex branching stories
6. Use **Preview Reader** anytime to test the experience

## Data storage

- **Database**: `E:\website\data\cyoa.db` (SQLite)
- **Story page images**: `E:\website\uploads\comics\<story-id>\`
- Everything is local and portable.

## Security & Production Requirements

**This app handles passwords and will handle payment data.**

### Before deploying to production (PYPStories.com):

1. **Set strong secrets**
   ```bash
   cp .env.example .env
   ```
   - Change `SESSION_SECRET` to a long random string (use `openssl rand -base64 48`)
   - Set `NODE_ENV=production`
   - Set `APP_URL=https://pypstories.com`

2. **Email**
   - Configure real SMTP (Resend, SendGrid, AWS SES, etc.)
   - Never use Ethereal in production

3. **HTTPS**
   - The site **must** run behind HTTPS (Cloudflare, Nginx + Let's Encrypt, or platform like Railway/Vercel)
   - Session cookies are set with `secure: true` in production

4. **Rate limiting & headers**
   - Helmet and express-rate-limit are enabled on auth routes

5. **Payments (critical)**
   - **Never store raw credit card numbers** yourself.
   - Use Stripe, Paddle, or another PCI-compliant provider.
   - See the code comments in server.js for future integration points.

### Email Verification
- New accounts require email verification before they can log in.
- Verification links expire after 24 hours.
- Users can request a new verification email from the login error message.

### Passwords
- Minimum 8 characters
- Bcrypt with 12 rounds
- Rate limited login/register attempts

## Development

- Emails in development use Ethereal (check console for preview URL)
- Database schema will auto-migrate on start
- Run with `npm run dev` for auto-reload

## Tech stack

- Node.js + Express (backend)
- better-sqlite3 (fast embedded database)
- Multer (file uploads)
- Tailwind CSS (via CDN — zero build step)
- Pure vanilla JavaScript frontend

## Development tips

- Edit `public/index.html` for UI changes
- Edit `server.js` for backend/API logic
- Restart the server after backend changes (or use `npm run dev`)

## Future ideas you can add later

- Cover image upload per story
- Likes / favorites / ratings
- Comments on stories
- Page reordering and editing
- Export / import stories as JSON
- User profiles and author pages

Happy branching at PYPStories.com!

## Payments (Future)

For accepting payments (subscriptions or one-time purchases for premium stories):

**Recommended:** Use [Stripe](https://stripe.com)

- Do **not** collect or store card details in this application.
- Use Stripe Checkout or Stripe Elements on the frontend.
- Store only `customer_id` and subscription status in your database.
- Webhooks should update user entitlements server-side.

Example flow (to be implemented):
1. User clicks "Go Premium"
2. Frontend redirects to Stripe Checkout (secure)
3. Stripe redirects back + sends webhook
4. Server verifies webhook and upgrades the user

If you need payment features implemented, let me know and we'll add Stripe integration safely.
