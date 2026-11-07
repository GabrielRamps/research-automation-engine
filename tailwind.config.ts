import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        // Glassmorphic dark theme colors
        navy: {
          deep: '#0a1428',
          dark: '#1a2433',
        },
        cyan: {
          electric: '#00d4ff',
        },
      },
      backgroundImage: {
        'radial-navy': 'radial-gradient(circle at center, #0a1428 0%, #000000 100%)',
      },
      backdropBlur: {
        xs: '2px',
      },
      boxShadow: {
        'glow-cyan': '0 0 20px rgba(0, 212, 255, 0.15)',
        'glow-cyan-lg': '0 0 30px rgba(0, 212, 255, 0.25)',
        'glass': '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
      },
    },
  },
  plugins: [],
};
export default config;

