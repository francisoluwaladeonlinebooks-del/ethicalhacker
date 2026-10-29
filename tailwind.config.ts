import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          50: '#f1f5fb', 100: '#e2eaf5', 200: '#c5d5e9', 300: '#94b0d1',
          400: '#5d84b0', 500: '#3a618f', 600: '#2a4a73', 700: '#1e3657',
          800: '#152740', 900: '#0d1a2c', 950: '#08111d',
        },
        seal: { 500: '#0f766e', 600: '#0d6159', 700: '#0a4d47' },
        risk: {
          critical: '#9f1239', high: '#c2410c', medium: '#b45309',
          low: '#0f766e', info: '#475569',
        },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: { '2xs': ['0.6875rem', { lineHeight: '1rem' }] },
    },
  },
  plugins: [],
};
export default config;
