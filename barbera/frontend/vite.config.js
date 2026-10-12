import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Em desenvolvimento o Vite repassa /api ao FastAPI, então o cookie de sessão
// fica na mesma origem do site e não precisa de configuração extra.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': process.env.VITE_PROXY_TARGET || 'http://localhost:8001' },
  },
});
