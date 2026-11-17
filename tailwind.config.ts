import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Cairo", "Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
      },
      colors: {
        // هوية الشركة: كحلي الرافعة + ذهبي/برتقالي حيوي على أرضية رملية دافئة
        canvas: "#f5f1ea",
        ink: { DEFAULT: "#13203a", soft: "#38435a", muted: "#677086", faint: "#959caa" },
        line: "#e8e2d6",
        accent: { DEFAULT: "#e8590c", hover: "#d24d06", soft: "#fff0e4" },
        navy: { DEFAULT: "#0b2545", 2: "#13315c", 3: "#1d4e89" },
        gold: { DEFAULT: "#f2b134", soft: "#fff6df" },
        good: { DEFAULT: "#1e8e3e", soft: "#e6f4ea" },
        warn: { DEFAULT: "#b25e00", soft: "#fff4e0" },
        bad: { DEFAULT: "#d70015", soft: "#fdecee" },
      },
      boxShadow: {
        card: "0 1px 2px rgba(19,32,58,0.05), 0 8px 24px -12px rgba(19,32,58,0.12)",
        pop: "0 18px 50px -12px rgba(11,37,69,0.28)",
        glow: "0 8px 22px -8px rgba(232,89,12,0.55)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "pop-in": {
          from: { opacity: "0", transform: "scale(.97) translateY(6px)" },
          to: { opacity: "1", transform: "none" },
        },
        "slide-in": { from: { transform: "translateX(100%)" }, to: { transform: "none" } },
      },
      animation: {
        "fade-in": "fade-in .18s ease-out",
        "pop-in": "pop-in .22s cubic-bezier(.2,.8,.2,1)",
        "slide-in": "slide-in .25s cubic-bezier(.2,.8,.2,1)",
      },
    },
  },
  plugins: [],
};
export default config;
