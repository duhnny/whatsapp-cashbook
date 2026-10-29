import dotenv from 'dotenv';
import { PrismaClient } from '../../prisma/client/client.js';
import { InfoLvl, logger } from '../utils/logging.js';
import { HyperlinkSchema } from '../utils/strings.js';
import { DEFAULT_PORT, DEFAULT_WHATSAPP_SESSION_EXPIRY_SECS } from './constants.js';

import { PrismaPg } from '@prisma/adapter-pg';
import z from 'zod';
import pg from 'pg';
import { createClerkClient } from '@clerk/fastify';
import { ChatDeepSeek } from '@langchain/deepseek';
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

// parse env variables
dotenv.config({
  path: process.env.ENV_FILE || '.env',
  quiet: true,
});

const optionalIntSchema = z
  .string()
  .optional() // Allows the input to be undefined
  .transform((val) => (val === undefined ? undefined : Number(val)))
  .refine((val) => val === undefined || !isNaN(val), {
    message: "Must be a valid numeric string",
  })
  .pipe(z.number().int("Must be an integer").optional());

const listOfUrls = z
  .string()
  .transform((val) => val.split(','))
  .refine((val) => val.map(link => HyperlinkSchema.validate(link)).every(b => b), {
    message: 'All elements in the list must be hyprlinks',
  })
  .pipe(z.array(HyperlinkSchema));

const ConfigSchema = z.object({
  PORT:                         optionalIntSchema,
  BACKEND_HOST:                 z.hostname(),
  ALLOWED_ORIGINS:              listOfUrls,

  // db config
  DATABASE_URL:                 HyperlinkSchema,
  AGENT_MEMORY_DATABASE_URL:    HyperlinkSchema,

  // clerk config
  CLERK_API_VERSION:            z.string(),
  CLERK_API_URL:                HyperlinkSchema,
  CLERK_PUBLISHABLE_KEY:        z.string(),
  CLERK_SECRET_KEY:             z.string(),
  CLERK_JWT_KEY:                z.string(),

  // whatsapp config
  WHATSAPP_SESSION_EXPIRY_SECS: optionalIntSchema,

  // deepseek config
  DEEPSEEK_MODEL:               z.string(),
});

const parsed = ConfigSchema.safeParse(process.env);
if (!parsed.success) {
  logger.log(InfoLvl.Error, 'Falha ao validar variáveis de ambiente', parsed.error);
  process.exit(1);
}
export const config = {
  ...parsed.data,
  PORT: parsed.data.PORT || DEFAULT_PORT,
  WHATSAPP_SESSION_EXPIRY_SECS:
    parsed.data.WHATSAPP_SESSION_EXPIRY_SECS
    || DEFAULT_WHATSAPP_SESSION_EXPIRY_SECS,
};

// initialize clerk for auth
export const auth = createClerkClient({
  apiVersion:     config.CLERK_API_VERSION,
  apiUrl:         config.CLERK_API_URL,
  publishableKey: config.CLERK_PUBLISHABLE_KEY,
  secretKey:      config.CLERK_SECRET_KEY,
  jwtKey:         config.CLERK_JWT_KEY,
});

// initialize db
const adapter = new PrismaPg({ connectionString: config.DATABASE_URL });
export const db = new PrismaClient({
  adapter: adapter,
  log: [
    {
      emit: 'event',
      level: 'error',
    },
  ],
});

db.$on('error', (err) => {
  logger.log(InfoLvl.Trace, 'Prisma error', err);
});

// initialize DeepSeek model
export const model = new ChatDeepSeek({
  model: config.DEEPSEEK_MODEL,
  temperature: 0.3,
});

// initialize agent memory
const agentMemoryPool = new pg.Pool({
  connectionString: config.AGENT_MEMORY_DATABASE_URL,
});

export const agentMemory = new PostgresSaver(agentMemoryPool);
