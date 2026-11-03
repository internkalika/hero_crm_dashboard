/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // every neutral and tinted token is a CSS variable (see src/index.css), so the dark theme only swaps the values
      colors: {
        hero: {
          DEFAULT: 'rgb(var(--hero-600) / <alpha-value>)',
          50: 'rgb(var(--hero-50) / <alpha-value>)',
          100: 'rgb(var(--hero-100) / <alpha-value>)',
          200: 'rgb(var(--hero-200) / <alpha-value>)',
          600: 'rgb(var(--hero-600) / <alpha-value>)',
          700: 'rgb(var(--hero-700) / <alpha-value>)',
          800: 'rgb(var(--hero-800) / <alpha-value>)',
        },
        ink: { DEFAULT: 'rgb(var(--ink) / <alpha-value>)', 2: 'rgb(var(--ink-2) / <alpha-value>)', 3: 'rgb(var(--ink-3) / <alpha-value>)' },
        surface: { DEFAULT: 'rgb(var(--surface) / <alpha-value>)', 2: 'rgb(var(--surface-2) / <alpha-value>)' },
        slate: {
          50: 'rgb(var(--slate-50) / <alpha-value>)',
          100: 'rgb(var(--slate-100) / <alpha-value>)',
          200: 'rgb(var(--slate-200) / <alpha-value>)',
          300: 'rgb(var(--slate-300) / <alpha-value>)',
          400: 'rgb(var(--slate-400) / <alpha-value>)',
          500: 'rgb(var(--slate-500) / <alpha-value>)',
          600: 'rgb(var(--slate-600) / <alpha-value>)',
          700: 'rgb(var(--slate-700) / <alpha-value>)',
          800: 'rgb(var(--slate-800) / <alpha-value>)',
          900: 'rgb(var(--slate-900) / <alpha-value>)',
        },
        good: { DEFAULT: '#0ca30c', text: 'rgb(var(--good-text) / <alpha-value>)', soft: 'rgb(var(--good-soft) / <alpha-value>)' },
        warn: { DEFAULT: '#fab219', text: 'rgb(var(--warn-text) / <alpha-value>)', soft: 'rgb(var(--warn-soft) / <alpha-value>)' },
        bad: { DEFAULT: '#d03b3b', text: 'rgb(var(--bad-text) / <alpha-value>)', soft: 'rgb(var(--bad-soft) / <alpha-value>)' },
        info: { DEFAULT: '#2a78d6', soft: 'rgb(var(--info-soft) / <alpha-value>)' },
        teal: { DEFAULT: '#0E8F9B', soft: 'rgb(var(--teal-soft) / <alpha-value>)' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        pop: 'var(--shadow-pop)',
      },
    },
  },
  plugins: [],
};
