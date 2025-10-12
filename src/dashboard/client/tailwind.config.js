/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Dark background colors
        'bg-dark': '#0a0a0f',
        'bg-card': '#1a1a24',
        'bg-hover': '#252532',

        // Accent colors (pink, purple, blue)
        'accent-pink': '#ec4899',
        'accent-purple': '#a855f7',
        'accent-blue': '#3b82f6',

        // Text colors
        'text-primary': '#f1f5f9',
        'text-secondary': '#94a3b8',
        'text-muted': '#64748b',

        // Status colors
        'status-idle': '#10b981',
        'status-processing': '#f59e0b',
        'status-error': '#ef4444',
        'status-offline': '#6b7280',
      },
    },
  },
  plugins: [],
}
