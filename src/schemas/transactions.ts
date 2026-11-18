import { TransactionCategory } from '../../prisma/client/enums.js';

import z from 'zod';
import { IdSchema } from './global.js';

export const ListTransactionsRequestQuerySchema = z.object({
  categories: z.array(z.enum(TransactionCategory)).optional(),
  dates: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('between'),
      start: z.coerce.date().optional(),
      end: z.coerce.date().optional(),
    }),
    z.object({
      kind: z.literal('relative'),
      when: z.enum(['this week', 'this month', 'past week', 'past month']),
    }),
  ]).optional(),
});

export type ListTransactionsRequestQuery = z.infer<typeof ListTransactionsRequestQuerySchema>;

export const GetTransactionsSummaryRequestQuerySchema = ListTransactionsRequestQuerySchema;

export type GetTransactionsSummaryRequestQuery = z.infer<typeof GetTransactionsSummaryRequestQuerySchema>;

export const CreateTransactionRequestBodySchema = z.object({
  description: z.string(),
  amount:      z.number(),
  category:    z.enum(TransactionCategory),
  timestamp:   z.iso.datetime({ offset: true }).optional(),
});

export type CreateTransactionRequestBody = z.infer<typeof CreateTransactionRequestBodySchema>;

export const UpdateTransactionRequestParamsSchema = z.object({
  id: IdSchema,
});

export type UpdateTransactionRequestParams = z.infer<typeof UpdateTransactionRequestParamsSchema>;

export const UpdateTransactionRequestBodySchema = z.object({
  description: z.string().optional(),
  amount:      z.number().optional(),
  category:    z.enum(TransactionCategory).optional(),
  timestamp:   z.iso.datetime({ offset: true }).optional(),
});

export type UpdateTransactionRequestBody = z.infer<typeof UpdateTransactionRequestBodySchema>;
