/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'Inter', '"IBM Plex Sans Thai Looped"', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        neo: {
          bg: '#FFFDF7',
          cream: '#FFFBEA',
          card: '#FFFFFF',
          black: '#000000',
          yellow: '#FFE15D',
          blue: '#4D77FF',
          coral: '#FF6B6B',
          mint: '#52D17C',
          muted: '#4B5563',
        },
        brand: {
          50: '#FFFBEA',
          100: '#FFF3C4',
          200: '#FFE885',
          300: '#FFDF4D',
          400: '#FFE15D',
          500: '#F6CD3C',
          600: '#EAB308',
          700: '#CA8A04',
          800: '#854D0E',
          900: '#422006',
        },
        purple: {
          50: '#FFFBEA',
          100: '#FFF3C4',
          200: '#FFE885',
          300: '#FFDF4D',
          400: '#FFE15D',
          500: '#F6CD3C',
          600: '#EAB308',
          700: '#CA8A04',
          800: '#854D0E',
          900: '#422006',
        }
      },
      boxShadow: {
        '2xs': '1px 1px 0px #000000',
        xs: '2px 2px 0px #000000',
        sm: '2px 2px 0px #000000',
        DEFAULT: '3px 3px 0px #000000',
        md: '4px 4px 0px #000000',
        lg: '5px 5px 0px #000000',
        xl: '6px 6px 0px #000000',
        '2xl': '8px 8px 0px #000000',
        neo: '4px 4px 0px #000000',
        'neo-sm': '2px 2px 0px #000000',
        'neo-lg': '6px 6px 0px #000000',
        'neo-xl': '8px 8px 0px #000000',
        'neo-pressed': '1px 1px 0px #000000',
        soft: '3px 3px 0px #000000',
        bento: '4px 4px 0px #000000',
        'bento-hover': '5px 5px 0px #000000',
        card: '4px 4px 0px #000000',
      },
      borderWidth: {
        DEFAULT: '1px',
        '0': '0',
        '2': '2px',
        '3': '3px',
        '4': '4px',
      },
      borderRadius: {
        bento: '8px'
      }
    }
  },
  plugins: []
}
