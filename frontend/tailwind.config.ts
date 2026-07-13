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
        display: ["var(--font-instrument)", "Georgia", "serif"],
        sans:    ["var(--font-inter-tight)", "system-ui", "sans-serif"],
        mono:    ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      colors: {
        void:    "#0A0A0C",
        slate:   { DEFAULT: "#16171B", 2: "#1D1F24" },
        rule:    { DEFAULT: "#26282F", lit: "#3A3D46" },
        paper:   { DEFAULT: "#E8E6E1", 2: "#A8A6A1" },
        dim:     { DEFAULT: "#6E7078", 2: "#45474E" },
        signal:  { DEFAULT: "#FF4D2E", dim: "#B33520" },
        marker:  { DEFAULT: "#4DD8B0", dim: "#2E9C7D" },
        warn:    "#E8B33D",
        error:   "#FF5A5A",
      },
      letterSpacing: {
        tightest: "-0.03em",
        tc: "0.06em",
      },
      borderRadius: {
        // Edit bays are rectilinear. Almost no radius.
        none: "0",
        xs: "2px",
        sm: "3px",
        DEFAULT: "4px",
      },
    },
  },
  plugins: [],
};

export default config;
