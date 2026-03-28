import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        app: "rgb(var(--app) / <alpha-value>)",
        text: "rgb(var(--text) / <alpha-value>)",
        "text-dim": "rgb(var(--text-dim) / <alpha-value>)",
        panel: "rgb(var(--panel) / <alpha-value>)",
        "panel-strong": "rgb(var(--panel-strong) / <alpha-value>)",
        outline: "rgb(var(--outline) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        "accent-contrast": "rgb(var(--accent-contrast) / <alpha-value>)",
        success: "rgb(var(--success) / <alpha-value>)",
        warning: "rgb(var(--warning) / <alpha-value>)",
        error: "rgb(var(--error) / <alpha-value>)",
      },
      spacing: {
        4.5: "1.125rem",
        5.5: "1.375rem",
        18: "4.5rem",
        22: "5.5rem",
      },
      fontSize: {
        xs: ["0.75rem", { lineHeight: "1rem" }],
        sm: ["0.875rem", { lineHeight: "1.25rem" }],
        base: ["1rem", { lineHeight: "1.5rem" }],
        lg: ["1.125rem", { lineHeight: "1.75rem" }],
        xl: ["1.25rem", { lineHeight: "1.85rem" }],
        "2xl": ["1.5rem", { lineHeight: "2rem" }],
        "3xl": ["1.85rem", { lineHeight: "2.35rem" }],
      },
      boxShadow: {
        card: "0 10px 35px -22px rgba(15, 26, 41, 0.5)",
        lifted: "0 24px 50px -24px rgba(12, 26, 40, 0.52)",
        glass: "0 18px 50px -22px rgba(10, 30, 50, 0.38)",
      },
      keyframes: {
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.65" },
        },
        "float-soft": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-3px)" },
        },
      },
      animation: {
        "pulse-soft": "pulse-soft 2.6s ease-in-out infinite",
        "float-soft": "float-soft 4.5s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
