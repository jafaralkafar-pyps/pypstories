# My Website

A clean, modern static website stored on your E: drive.

## How to view the website

### Option 1: Open directly (fastest)
1. Navigate to `E:\website`
2. Double-click `index.html`
3. It opens in your default browser

### Option 2: Run a local server (recommended)
This gives you a clean URL and auto-reloads on some setups.

**Using Python (built-in):**
```powershell
cd E:\website
python -m http.server 8000
```
Then visit: http://localhost:8000

**Using Node.js (if you have `npx`):**
```powershell
cd E:\website
npx serve .
```

## How to edit

1. Open any of these files in your text editor:
   - `index.html` — main content and layout
   - `style.css` — custom styles
   - `script.js` — interactive behaviors

2. Make changes and reload the browser (or restart the server).

## Tips for customization

- Change the name/logo in the navbar in `index.html`
- Replace placeholder text and projects with real content
- Update email address in the contact section
- Swap project cards for actual work
- Add images to the `assets/` folder and link them
- For a production site, consider deploying to GitHub Pages, Netlify, or Vercel later

## Adding real contact form handling

The current form is a demo. To make it actually send emails:

- Use [Formspree](https://formspree.io)
- Use [Netlify Forms](https://docs.netlify.com/forms/setup/)
- Integrate EmailJS (client-side only)

## File structure

```
E:\website\
├── index.html
├── style.css
├── script.js
├── README.md
└── assets/          ← put images, fonts, etc. here
```

Happy building!
