import dotenv from 'dotenv';
import { PrismaClient } from '../../prisma/client/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import z from 'zod';
import { InfoLvl, logger } from '../utils/logging.js';
import { HyperlinkSchema } from '../utils/strings.js';
import { createClerkClient } from '@clerk/fastify';
import { DEFAULT_PORT } from './constants.js';

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
  PORT:                  optionalIntSchema,
  BACKEND_HOST:          z.hostname(),
  ALLOWED_ORIGINS:       listOfUrls,

  // clerk config
  CLERK_API_VERSION:     z.string(),
  CLERK_API_URL:         HyperlinkSchema,
  CLERK_PUBLISHABLE_KEY: z.string(),
  CLERK_SECRET_KEY:      z.string(),
  CLERK_JWT_KEY:         z.string(),
});

const parsed = ConfigSchema.safeParse(process.env);
if (!parsed.success) {
  logger.log(InfoLvl.Error, 'Falha ao validar variáveis de ambiente', parsed.error);
  process.exit(1);
}
export const config = {
  ...parsed.data,
  PORT: parsed.data.PORT || DEFAULT_PORT,
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
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
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
