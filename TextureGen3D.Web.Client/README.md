# TextureGen3D.Web.Client

React + Vite + TailwindCSS front-end application for the TextureGen3D template.

## Usage

- `src/main.jsx` - Application entry point.
- `src/App.jsx` - Root component with providers.
- `src/routes/routing.jsx` - Route definitions and protected routes.
- `src/context/session.jsx` - User session and token management.
- `src/context/theme.jsx` - Light/dark theme management.
- `src/api/` - API client classes (Axios wrapper, auth, users).
- `src/pages/` - Page components (home, login, dashboard).
- `src/components/layout/Sidebar.jsx` - Dashboard sidebar with light/dark toggle at the bottom.
- `src/index.css` - Tailwind directives and global styles.

## Running the Client

```bash
npm install
npm run dev
```

The Vite dev server runs on `https://localhost:7783` by default and proxies `/api` requests to the .NET web server.

## Theme Toggle

The dashboard sidebar includes a light/dark mode toggle switch at the bottom. The selected theme is persisted in `localStorage` and applied to the `html` element via the `dark` class.

## References

- `react`, `react-dom`, `react-router-dom`
- `axios`, `jwt-decode`
- `tailwindcss`, `autoprefixer`, `postcss`
