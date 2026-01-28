/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        golden: {
          50: '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
        },
        midnight: {
          50: '#e8e8f0',
          100: '#c4c4d4',
          200: '#9999b0',
          300: '#6e6e8c',
          400: '#4a4a6a',
          500: '#2a2a48',
          600: '#1e1e38',
          700: '#16162a',
          800: '#111120',
          900: '#0a0a18',
          950: '#06060f',
        },
      },
    },
  },
  plugins: [],
}
