import type {
  IsUserWhatsappVerifiedResponseBody,
  RequestWhatsappVerificationRequestBody,
  RequestWhatsappVerificationResponseBody,
} from '../../../src/exports/auth.js';

import type {
  CheckHealthResponseBody,
} from '../../../src/exports/health.js';

import type {
  CreateTransactionRequestBody,
  CreateTransactionResponseBody,
  DeleteTransactionRequestParams,
  DeleteTransactionResponseBody,
  GetTransactionsSummaryRequestQuery,
  GetTransactionsSummaryResponseBody,
  ListTransactionsRequestQuery,
  ListTransactionsResponseBody,
  UpdateTransactionRequestBody,
  UpdateTransactionRequestParams,
  UpdateTransactionResponseBody,
} from '../../../src/exports/transactions.js';

export type * from '../../../src/exports/auth.js';
export type * from '../../../src/exports/health.js';
export type * from '../../../src/exports/transactions.js';

export type ApiRoutes = {
  '/auth/whatsapp-verification': {
    GET: {
      response: IsUserWhatsappVerifiedResponseBody,
    },

    POST: {
      body: RequestWhatsappVerificationRequestBody,
      response: RequestWhatsappVerificationResponseBody,
    },
  },

  '/health': {
    GET: {
      response: CheckHealthResponseBody,
    },
  },

  '/transactions': {
    GET: {
      query: ListTransactionsRequestQuery,
      response: ListTransactionsResponseBody,
    },

    POST: {
      body: CreateTransactionRequestBody,
      response: CreateTransactionResponseBody,
    },
  },

  '/transactions/summary': {
    GET: {
      query: GetTransactionsSummaryRequestQuery,
      response: GetTransactionsSummaryResponseBody,
    },
  },

  '/transactions/:id': {
    PUT: {
      params: UpdateTransactionRequestParams,
      body: UpdateTransactionRequestBody,
      response: UpdateTransactionResponseBody,
    },

    DELETE: {
      params: DeleteTransactionRequestParams,
      response: DeleteTransactionResponseBody,
    },
  },
}
