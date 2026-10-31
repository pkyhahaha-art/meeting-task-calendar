/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#F7F3FC',
          100: '#F0E9FA',
          200: '#E8E2F0',
          300: '#D2C3E4',
          400: '#B299CE',
          500: '#8052B1',
          600: '#694092',
          700: '#63358E',
          800: '#4B2E65',
          900: '#29243D'
        },
        purple: {
          50: '#F7F3FC',
          100: '#F0E9FA',
          200: '#E8E2F0',
          300: '#D2C3E4',
          400: '#B299CE',
          500: '#8052B1',
          600: '#694092',
          700: '#63358E',
          800: '#4B2E65',
          900: '#29243D'
        }
      },
      boxShadow: {
        soft: '0 4px 20px rgba(76, 29, 149, 0.06)'
      }
    }
  },
  plugins: []
}
