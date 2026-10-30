# ==========================================
# Etapa 1: Base de desenvolvimento e build
# ==========================================
FROM node:26-alpine AS builder

WORKDIR /app

# Copia os arquivos de definição de dependências
COPY package*.json ./
COPY prisma ./prisma/

# Instala TODAS as dependências (incluindo as de desenvolvimento para o TypeScript)
RUN npm ci

# Copia o restante do código fonte e a configuração do TS
COPY tsconfig.json ./
COPY prisma.config.ts ./
COPY src ./src

# Gera o Prisma Client e compila o TypeScript para JavaScript (geralmente pasta /dist)
RUN npx prisma generate
RUN npm run build

# Remove as dependências de desenvolvimento para economizar espaço
RUN npm prune --production

# ==========================================
# Etapa 2: Imagem final de Produção
# ==========================================
FROM node:26-alpine AS server

WORKDIR /app

# Copia apenas o necessário da etapa anterior
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Executa as migrações pendentes no banco e inicia o servidor compilado
CMD node dist/src/server.js
