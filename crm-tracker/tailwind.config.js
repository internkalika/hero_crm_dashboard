/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        hero: {
          DEFAULT: '#C8202F',
          50: '#FDF1F2',
          100: '#FBE3E5',
          200: '#F5BFC4',
          600: '#C8202F',
          700: '#A81A27',
          800: '#8A1520',
        },
        ink: { DEFAULT: '#292929', 2: '#52514E', 3: '#898781' },
        surface: { DEFAULT: '#FFFFFF', 2: '#F5F6F8' },
        good: { DEFAULT: '#0ca30c', text: '#006300', soft: '#E8F6E8' },
        warn: { DEFAULT: '#fab219', text: '#8A5A00', soft: '#FFF4DB' },
        bad: { DEFAULT: '#d03b3b', text: '#B02A2A', soft: '#FCEAEA' },
        info: { DEFAULT: '#2a78d6', soft: '#E8F1FC' },
        teal: { DEFAULT: '#0E8F9B', soft: '#E3F4F5' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(41,41,41,0.06), 0 1px 3px rgba(41,41,41,0.05)',
        pop: '0 8px 24px rgba(41,41,41,0.14)',
      },
    },
  },
  plugins: [],
};
