import type {
  SignupRequestBody,
  SignupResponseBody,
  RequestWhatsappVerificationResponseBody
} from '../../../src/exports/auth.js';

import type {
  CheckHealthResponseBody,
} from '../../../src/exports/health.js';

export type * from '../../../src/exports/auth.js';
export type * from '../../../src/exports/health.js';

export type ApiRoutes = {
  '/auth/signup': {
    method: 'POST',
    body: SignupRequestBody,
    response: SignupResponseBody,
  },

  '/auth/whatsapp-verification': {
    method: 'POST',
    response: RequestWhatsappVerificationResponseBody,
  },

  '/health': {
    method: 'GET',
    response: CheckHealthResponseBody,
  }
}
