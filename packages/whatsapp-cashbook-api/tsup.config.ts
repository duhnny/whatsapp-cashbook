import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  
  dts: {
    only: true,
    // 💡 DIZ PARA O GERADOR DE .D.TS MANTER ESSES PACOTES COMO EXTERNOS NOS TIPOS
    resolve: false,
    compilerOptions: {
      skipLibCheck: true,
    },
  },
  
  // Mantém seu bloqueio de runtime padrão
  external: [/node_modules/, /^[a-z]/], 
  
  format: ['esm'], 
  clean: true,
});
