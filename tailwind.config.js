/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f8eff9',
          100: '#f0dcf1',
          500: '#9c32a0',
          600: '#851484',
          700: '#71106f',
          900: '#4e0d53'
        }
      },
      boxShadow: {
        soft: '0 14px 36px rgba(78, 13, 83, 0.08)'
      }
    }
  },
  plugins: []
}
