import type { Config } from 'tailwindcss';

/**
 * Tailwind is the delivery mechanism for the tokens declared in `globals.css`;
 * it is not a second source of truth. Every colour below aliases a CSS custom
 * property so a token change propagates to utilities and components together.
 * See `design.md`.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          50: '#f2f5fa', 100: '#e4eaf3', 200: '#c9d5e6', 300: '#9db1cb',
          400: '#6b86a8', 500: '#4a6685', 600: '#33506e', 700: '#223c56',
          800: '#142942', 900: '#0b1b2e', 950: '#07121f',
        },
        seal: {
          50: '#ecf7f4', 100: '#d6efea', 500: '#0e7c71', 600: '#0e7c71',
          700: '#0a6158', 800: '#084c45',
        },
        warm: { 100: '#f6ecdd', 200: '#e8d5b7', 300: '#dfc7a2', 700: '#6b5432' },
        risk: {
          critical: 'var(--sev-critical)',
          high: 'var(--sev-high)',
          medium: 'var(--sev-medium)',
          low: 'var(--sev-low)',
          info: 'var(--sev-info)',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        display: ['var(--font-display)'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
        micro: ['0.625rem', { lineHeight: '0.875rem' }],
      },
      borderRadius: {
        xs: 'var(--r-xs)',
        sm: 'var(--r-sm)',
        md: 'var(--r-md)',
        lg: 'var(--r-lg)',
        pill: 'var(--r-pill)',
      },
      boxShadow: {
        float: 'var(--shadow-float)',
      },
      transitionTimingFunction: {
        out: 'var(--ease-out)',
      },
      maxWidth: {
        prose: '72ch',
      },
    },
  },
  plugins: [],
};
export default config;
