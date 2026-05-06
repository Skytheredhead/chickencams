/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          0: "#0b0b0e",
          1: "#111114",
          2: "#17171b",
          3: "#1d1d22"
        },
        border: {
          DEFAULT: "#27272a",
          strong: "#3f3f46"
        }
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"]
      }
    }
  },
  plugins: []
};
