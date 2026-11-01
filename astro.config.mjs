import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

// HTML e bundles estáticos; a API permanece no Worker existente, sem SSR pago.
export default defineConfig({
  integrations: [react()],
  output: 'static',
  // Alvo em string faz o Vite reescrever o Host para a porta da API. Cadastro e
  // sessão comparam Origin com Host, então o proxy precisa manter o Host do navegador.
  vite: { server: { proxy: { '/api': { target: `http://127.0.0.1:${process.env.LUME_API_PORT || '4173'}`, changeOrigin: false } } } },
});
