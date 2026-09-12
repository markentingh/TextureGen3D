/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          900: '#1e3a8a',
        },
        charcoal: {
          50: '#f6f7f8',
          100: '#e2e5e8',
          200: '#c6ccd1',
          300: '#9aa3ab',
          400: '#6b7480',
          500: '#4a525c',
          600: '#363c44',
          700: '#2a2f36',
          800: '#1f242a',
          900: '#15181c',
        }
      }
    },
  },
  plugins: [],
}
