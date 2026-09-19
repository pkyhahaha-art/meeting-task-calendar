/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef7f7',
          100: '#d5ecec',
          500: '#147d80',
          600: '#0f696c',
          700: '#105558',
          900: '#123f42'
        }
      },
      boxShadow: {
        soft: '0 14px 36px rgba(15, 35, 42, 0.08)'
      }
    }
  },
  plugins: []
}

