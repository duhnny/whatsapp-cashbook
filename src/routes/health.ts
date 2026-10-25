import { BasicRequest } from "../schemas/global.js";
import { ok } from "../utils/result.js";
import { AsyncReturn } from "../utils/types.js";

import { FastifyPluginAsync } from "fastify";

const checkHealth = async (req: BasicRequest) => {
  return ok({
    status: 'up' as const,
    message: 'Service is up and running!',
  });
}

export type CheckHealthResponseBody = AsyncReturn<typeof checkHealth>;

export const healthRoutes: FastifyPluginAsync = async (app, opts) => {
  app.get('/', async (req, res) => {
    const response = await checkHealth(req);

    return res.code(200).send(ok(response.value));
  });
};
