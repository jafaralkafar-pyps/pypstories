/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./public/**/*.html",
    "./public/**/*.js"
  ],
  safelist: [
    // Common dynamic classes used in JS-generated content and modals
    { pattern: /^(bg|text|border|hover|focus|active|flex|grid|items|justify|gap|p|m|w|h|rounded|col|row|space|transition|transform|scale|opacity|z)-/ },
    { pattern: /bg-(slate|blue|emerald|amber|red|white|black)-(50|100|200|300|400|500|600|700|800|900|950)/ },
    { pattern: /text-(slate|blue|emerald|amber|red|white|black)-(50|100|200|300|400|500|600|700|800|900|950)/ },
    'hidden', 'flex', 'grid', 'block', 'inline-flex',
    'rounded-2xl', 'rounded-3xl', 'rounded-full', 'rounded-xl',
    'border-slate-700', 'border-slate-800', 'border-blue-500',
    'bg-slate-900', 'bg-slate-950', 'bg-slate-800', 'bg-white', 'bg-blue-600',
    'text-slate-200', 'text-slate-400', 'text-slate-500', 'text-white',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}