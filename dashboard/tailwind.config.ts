import type { Config } from "tailwindcss";

// vm_shell: every colour comes from a CSS variable in globals.css, so the
// whole app is themed from one place. The names are kept from the first
// build so existing screens pick up the new look without being rewritten.
const c = (name: string) => `rgb(var(--${name}-rgb) / <alpha-value>)`;

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // One family. Data (timecodes, sizes, addresses) is set narrower
        // with tabular figures instead of switching to a monospace face.
        sans:    ["var(--font-ui)", "system-ui", "sans-serif"],
        display: ["var(--font-ui)", "system-ui", "sans-serif"],
        mono:    ["var(--font-ui)", "system-ui", "sans-serif"],
      },
      colors: {
        void:    c("void"),                                   // page
        side:    c("side"),                                   // sidebar
        screen:  c("screen"),                                 // video surfaces
        slate:   { DEFAULT: c("slate"), 2: c("slate-2") },    // panel, raised panel
        rule:    { DEFAULT: c("rule"), lit: c("rule-lit") },  // borders
        paper:   { DEFAULT: c("paper"), 2: c("paper-2") },    // text, secondary text
        dim:     { DEFAULT: c("dim"), 2: c("dim-2") },        // muted text, faint
        signal:  { DEFAULT: c("signal"), dim: c("signal-dim") },  // where you are
        marker:  { DEFAULT: c("marker"), dim: c("marker-dim") },  // done, verified
        warn:    c("warn"),
        error:   c("error"),
      },
      letterSpacing: {
        tightest: "-0.02em",
        tc: "0",
      },
      borderRadius: {
        none: "0",
        xs: "3px",
        sm: "4px",
        DEFAULT: "6px",
        md: "8px",
        lg: "10px",
        xl: "14px",
      },
    },
  },
  plugins: [],
};

export default config;
