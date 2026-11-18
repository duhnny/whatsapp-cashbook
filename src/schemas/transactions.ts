import { TransactionCategory } from '../../prisma/client/enums.js';

import z from 'zod';


export const ListTransactionsQuerySchema = z.object({
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

export type ListTransactionsQuery = z.infer<typeof ListTransactionsQuerySchema>;
