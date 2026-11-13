import type {
  RequestWhatsappVerificationRequestBody,
  RequestWhatsappVerificationResponseBody,
} from '../../../src/exports/auth.js';

import type {
  CheckHealthResponseBody,
} from '../../../src/exports/health.js';

export type * from '../../../src/exports/auth.js';
export type * from '../../../src/exports/health.js';

export type ApiRoutes = {
  '/auth/whatsapp-verification': {
    method: 'POST',
    body: RequestWhatsappVerificationRequestBody
    response: RequestWhatsappVerificationResponseBody,
  },

  '/health': {
    method: 'GET',
    response: CheckHealthResponseBody,
  }
}
