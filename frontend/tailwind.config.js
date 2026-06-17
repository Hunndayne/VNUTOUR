/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // VNUTour "field map" palette — derived from the expedition logo
        paper: '#F3F4F1',   // map-paper base (cool warm-grey, not cream)
        ink: '#20312B',     // charcoal-green text
        stone: '#DCD8CC',   // hairline borders
        gold: '#E0A23A',    // logo ring — primary accent
        trail: '#1F7A6B',   // route/expedition green — secondary
        clay: '#D6492B',    // wordmark terracotta — alerts only
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
}
