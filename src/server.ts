import { InfoLvl, logger } from './utils/logging.js';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import compression from '@fastify/compress';
import formbody from '@fastify/formbody';
import cookie from '@fastify/cookie';
import { ZodTypeProvider } from 'fastify-type-provider-zod';

// Importar rotas
import { healthRoutes } from './routes/health.js';
import { webhookRoutes } from './routes/webhook.js';

import { err, tryCatch } from './utils/result.js';
import { InternalServerError } from './schemas/global.js';
import { agentMemory, config } from './config/config.js';
import { info } from 'node:console';

// Isto permite serialização de big int
(BigInt.prototype as any).toJSON = function () {
  return Number(this);
};

const app = Fastify({
  bodyLimit: 10000000,
}).withTypeProvider<ZodTypeProvider>();
const PORT = process.env.PORT? parseInt(process.env.PORT) : 3000;

// Middlewares de segurança e otimização
app.register(helmet);
app.register(compression);
app.register(cookie);

// CORS - Permitir acesso do frontend
const allowedOrigins = config.ALLOWED_ORIGINS;

app.register(cors, {
  origin: function (origin, callback) {
    // Permite requisições sem origin (como apps mobile ou Postman)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      callback(new Error('Não permitido pelo CORS'), false);
    }
  },
  credentials: true
});

// Parser de application/x-www-form-urlencoded
app.register(formbody);

// Log de requisições (apenas em desenvolvimento)
if (process.env.NODE_ENV === 'development') {
  app.addHook('preHandler', async (req, res) => {
    logger.log(InfoLvl.Debug, 'Incoming request', {
      id: req.id,
      method: req.method,
      path: req.url,
      body: req.body,
    });
  });

  app.addHook('onSend', async (req, res, payload) => {
    logger.log(InfoLvl.Debug, 'Outgoing response', {
      id: req.id,
      status: res.raw.statusCode,
      body: payload,
    });

    return payload;
  })
} else {
  app.addHook('preHandler', async (req, res) => {
    logger.log(InfoLvl.Debug, 'Incoming request', {
      id: req.id,
      method: req.method,
      path: req.url,
    });
  });

  app.addHook('onResponse', (req, res) => {
    logger.log(InfoLvl.Debug, 'Outgoing response', {
      id: req.id,
      status: res.raw.statusCode,
    });
  })
}

// Rotas da API
app.register(healthRoutes,  { prefix: '/health' });
app.register(webhookRoutes, { prefix: '/webhook' });

// Rota 404 - Not Found
app.setNotFoundHandler((req, res) => {
  res.status(404).send({ 
    error: 'Rota não encontrada',
    message: `A rota ${req.method} ${new URL(req.url).pathname} não existe`
  });
});

// Error handler global
app.setErrorHandler((error, req, res) => {
  logger.log(InfoLvl.Error, 'Erro não tratado', error as Error);
  
  res.status(500).send(err(new InternalServerError(
    process.env.NODE_ENV === 'development' ? String(error) : 'Ocorreu um erro inesperado',
  )));
});

const start = async () => {
  // setup agent memory tables in database
  const agentMemorySetupResult = await tryCatch(agentMemory.setup());

  if (agentMemorySetupResult._tag === 'err') {
    logger.log(InfoLvl.Fatal, 'Unable to setup agent memory. Aborting...');
    process.exit(1);
  }

  try {
    // O await garante que o Node só passa para a próxima linha APÓS o bind do Kernel do Linux
    const address = await app.listen({ 
      port: PORT, 
      host: '0.0.0.0' 
    });
    
    logger.log(InfoLvl.Info, `🚀 Servidor escutando de verdade em: ${address}`, {
      port: PORT,
      environment: process.env.NODE_ENV || 'development',
      stated_at: new Date().toLocaleString('pt-BR')
    });
  } catch (err) {
    logger.log(InfoLvl.Error, '💥 Erro fatal ao tentar abrir a porta:', err as Error);
    process.exit(1);
  }
};

start();

export default app;
