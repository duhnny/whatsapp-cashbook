import 'fastify';
import { BasicUserData } from './schemas/global.ts';

declare module 'fastify' {
  interface FastifyRequest {
    user: BasicUserData | undefined,
  }
}
