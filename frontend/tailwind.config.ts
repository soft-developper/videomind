import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        syne: ["var(--font-syne)", "sans-serif"],
        dm: ["var(--font-dm-sans)", "sans-serif"],
        mono: ["var(--font-jetbrains)", "monospace"],
      },
      colors: {
        volt: "#c8ff00",
        "volt-dim": "#9dc700",
        dark: {
          950: "#060608",
          900: "#0c0d10",
          800: "#111318",
          700: "#181b22",
          600: "#1f232c",
          500: "#2a2f3a",
        },
        glass: "rgba(255,255,255,0.04)",
      },
      animation: {
        "pulse-volt": "pulse-volt 2s ease-in-out infinite",
        "shimmer": "shimmer 2s linear infinite",
        "scan": "scan 3s linear infinite",
        "float": "float 6s ease-in-out infinite",
      },
      keyframes: {
        "pulse-volt": {
          "0%, 100%": { boxShadow: "0 0 20px rgba(200,255,0,0.2)" },
          "50%": { boxShadow: "0 0 40px rgba(200,255,0,0.5)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        scan: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100vh)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-10px)" },
        },
      },
      backdropBlur: { xs: "2px" },
    },
  },
  plugins: [],
};

export default config;
