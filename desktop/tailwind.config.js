/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/renderer/**/*.{js,jsx,ts,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // 主品牌色
        "primary": "#c51662",
        "primary-dark": "#a01250",
        
        // 深色背景系统
        "dark": {
          DEFAULT: "#0a0a0f",
          "panel": "#13131a",
          "lighter": "#1a1a24",
        },
        
        // 品牌色板
        "brand": {
          "purple": "#8b5cf6",
          "purple-dark": "#7c3aed",
          "pink": "#ec4899",
          "green": "#10b981",
          "amber": "#f59e0b",
        },
        
        // 兼容旧代码
        "background-light": "#f8f6f7",
        "background-dark": "#0a0a0f",
        "text-light": "#1b0e14",
        "text-dark": "#f8f6f7",
        "text-muted-light": "#974e6e",
        "text-muted-dark": "#a88fa0",
        "surface-light": "#ffffff",
        "surface-dark": "#13131a",
        "border-light": "#f3e7ec",
        "border-dark": "#ffffff0f",
        "primary-subtle-light": "#f3e7ec",
        "primary-subtle-dark": "#402634",
        "success": "#10b981",
        "warning": "#f59e0b",
        "error": "#ef4444",
      },
      fontFamily: {
        "display": ["Plus Jakarta Sans", "'Noto Sans SC'", "sans-serif"]
      },
      borderRadius: {
        "DEFAULT": "0.625rem",
        "lg": "1rem",
        "xl": "1.25rem",
        "2xl": "1.5rem",
        "3xl": "2rem",
        "full": "9999px"
      },
      backgroundImage: {
        'sakura-pattern': "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23c51662' fill-opacity='0.03'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")",
      },
      boxShadow: {
        'xs': '0 1px 2px 0 rgb(0 0 0 / 0.05)',
        'card': '0 4px 24px rgba(0,0,0,0.3)',
        'glow': '0 0 40px rgba(197,22,98,0.15)',
        'glow-strong': '0 0 60px rgba(197,22,98,0.3)',
      },
      dropShadow: {
        'glow': '0 0 8px rgba(197, 22, 98, 0.6)',
        'glow-lg': '0 0 16px rgba(197, 22, 98, 0.5)',
      },
      keyframes: {
        "wave": {
          "0%, 100%": { height: "8px" },
          "50%": { height: "24px" },
        },
        "pulse-glow": {
          "0%, 100%": { boxShadow: "0 0 20px rgba(197,22,98,0.3)" },
          "50%": { boxShadow: "0 0 40px rgba(197,22,98,0.6)" },
        },
      },
      animation: {
        "wave": "wave 0.8s ease-in-out infinite",
        "pulse-glow": "pulse-glow 2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
}
