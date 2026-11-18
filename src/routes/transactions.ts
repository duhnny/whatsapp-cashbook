import { ForbiddenError, InternalServerError, TypedAuthedRequest } from "../schemas/global.js";
import {
  CreateTransactionRequestBody,
  CreateTransactionRequestBodySchema,
  GetTransactionsSummaryRequestQuery,
  GetTransactionsSummaryRequestQuerySchema,
  ListTransactionsRequestQuery,
  ListTransactionsRequestQuerySchema,
  UpdateTransactionRequestBody,
  UpdateTransactionRequestBodySchema,
  UpdateTransactionRequestParams,
  UpdateTransactionRequestParamsSchema,
} from "../schemas/transactions.js";
import { config, db } from "../config/config.js";
import { err, ok, tryCatch } from "../utils/result.js";
import { logger, InfoLvl } from "../utils/logging.js";
import { getEndOfMonth, getEndOfWeek, getStartOfMonth, getStartOfWeek } from "../utils/dates.js";
import { Prisma } from "../../prisma/client/client.js";
import { validatedRoute } from "../middleware/validation.js";
import { authenticatedRoute } from "../middleware/auth.js";
import { AsyncReturn } from "../utils/types.js";

import { FastifyPluginAsync } from "fastify";

const listTransactions = async (req: TypedAuthedRequest<{ query: ListTransactionsRequestQuery }>) => {
  let start: Date | undefined = undefined;
  let end: Date | undefined = undefined;

  const now = Temporal.Now.zonedDateTimeISO(config.TIMEZONE);

  if (req.query.dates) {
    switch (req.query.dates.kind) {
      case 'between': {
        start = req.query.dates.start;
        end = req.query.dates.end;
        break;
      }

      case 'relative': {
        switch (req.query.dates.when) {
          case 'this week': {
            start = new Date(getStartOfWeek(now).epochMilliseconds);
            end = new Date(getEndOfWeek(now).epochMilliseconds);
            break;
          }

          case 'this month': {
            start = new Date(getStartOfMonth(now).epochMilliseconds);
            end = new Date(getEndOfMonth(now).epochMilliseconds);
            break;
          }

          case 'past week': {
            start = new Date(getStartOfWeek(now.subtract({ days: 7 })).epochMilliseconds);
            end = new Date(getEndOfWeek(now.subtract({ days: 7 })).epochMilliseconds);
            break;
          }

          case 'past month': {
            start = new Date(getStartOfMonth(now.subtract({ days: now.day })).epochMilliseconds);
            end = new Date(getEndOfMonth(now.subtract({ days: now.day })).epochMilliseconds);
            break;
          }
        }
        break;
      }
    }
  }

  const transactions = await tryCatch(db.transaction.findMany({
    select: {
      id: true,
      description: true,
      amount: true,
      category: true,
      createdAt: true,
    },
    where: {
      AND: [
        { userId: req.user.id },
        start ? { createdAt: { gte: start } } : {},
        end   ? { createdAt: { lte: end } }   : {},
        req.query.categories ? { category: { in: req.query.categories } } : {},
      ],
    },
  }));

  if (transactions._tag === 'err') {
    logger.log(InfoLvl.Error, 'Unable to get transactions for user', {
      reqId: req.id,
      start,
      end,
      userId: req.user.id,
      error: transactions.error,
    });

    return err(new InternalServerError('Unable list transactions. Try again in a few seconds'));
  }

  return ok(transactions.value.map(transaction => {
    return {
      ...transaction,
      amount: transaction.amount.toNumber(),
    };
  }));
};

const listTransactionsRoute = authenticatedRoute(
  validatedRoute(
    {
      query: ListTransactionsRequestQuerySchema,
    },
    listTransactions,
  ),
);

export type ListTransactionsResponseBody = AsyncReturn<typeof listTransactionsRoute>;

type SpendByMonth = {
  month: Date
  total: number
}

const getTransactionsSummary = async (req: TypedAuthedRequest<{ query: GetTransactionsSummaryRequestQuery }>) => {
  let start: Date | undefined = undefined;
  let end: Date | undefined = undefined;

  const now = Temporal.Now.zonedDateTimeISO(config.TIMEZONE);

  if (req.query.dates) {
    switch (req.query.dates.kind) {
      case 'between': {
        start = req.query.dates.start;
        end = req.query.dates.end;
        break;
      }

      case 'relative': {
        switch (req.query.dates.when) {
          case 'this week': {
            start = new Date(getStartOfWeek(now).epochMilliseconds);
            end = new Date(getEndOfWeek(now).epochMilliseconds);
            break;
          }

          case 'this month': {
            start = new Date(getStartOfMonth(now).epochMilliseconds);
            end = new Date(getEndOfMonth(now).epochMilliseconds);
            break;
          }

          case 'past week': {
            start = new Date(getStartOfWeek(now.subtract({ days: 7 })).epochMilliseconds);
            end = new Date(getEndOfWeek(now.subtract({ days: 7 })).epochMilliseconds);
            break;
          }

          case 'past month': {
            start = new Date(getStartOfMonth(now.subtract({ days: now.day })).epochMilliseconds);
            end = new Date(getEndOfMonth(now.subtract({ days: now.day })).epochMilliseconds);
            break;
          }
        }
        break;
      }
    }
  }

  const balance = await tryCatch(db.transaction.aggregate({
    _sum: {
      amount: true,
    },
    where: {
      userId: req.user.id,
    },
  }));

  if (balance._tag === 'err') {
    logger.log(InfoLvl.Error, 'Unable to query database for user balance', {
      reqId: req.id,
      userId: req.user.id,
      error: balance.error,
    });

    return err(new InternalServerError('Unable to get balance. Try again in a few seconds'));
  }

  const spendByCategory = await tryCatch(db.transaction.groupBy({
    by: ['category'],
    _sum: {
      amount: true,
    },
    where: {
      AND: [
        { userId: req.user.id },
        { createdAt: { gte: start } },
        { createdAt: { lt: end } },
      ],
    },
  }));

  if (spendByCategory._tag === 'err') {
    logger.log(InfoLvl.Error, 'Unable to get spend by category for user', {
      reqId: req.id,
      start,
      end,
      userId: req.user.id,
      error: spendByCategory.error,
    });

    return err(new InternalServerError('Unable to compute summary. Try again in a few seconds'));
  }

  const categorySqlFilter =
    req.query.categories && req.query.categories.length > 0
      ? Prisma.sql`AND category::text IN (${Prisma.join(req.query.categories)})`
      : Prisma.empty;

  const spendByMonth = await tryCatch(db.$queryRaw<SpendByMonth[]>`
    SELECT
      date_trunc('month', "createdAt" AT TIME ZONE ${config.TIMEZONE}) AS "month",
      -SUM(amount)::float AS total
    FROM "Transaction"
    WHERE
      userId = ${req.user.id}
      ${categorySqlFilter}
    GROUP BY "month"
    HAVING SUM(amount) < 0
    ORDER BY "month" ASC;
  `);

  if (spendByMonth._tag === 'err') {
    logger.log(InfoLvl.Error, 'Unable to get spend by month for user', {
      reqId: req.id,
      start,
      end,
      userId: req.user.id,
      error: spendByMonth.error,
    });

    return err(new InternalServerError('Unable to compute summary. Try again in a few seconds'));
  }

  return ok({
    balance: balance.value._sum.amount ? balance.value._sum.amount.toNumber() : 0,
    spendByCategory: spendByCategory.value
      .map((entry) => {
        return {
          category: entry.category,
          total: entry._sum.amount ? entry._sum.amount.toNumber() : null,
        };
      })
      .filter(entry => entry.total && entry.total > 0), // only net-negative categories
    spendByMonth: spendByMonth.value,
  });
};

const getTransactionsSummaryRoute = authenticatedRoute(
  validatedRoute(
    {
      query: GetTransactionsSummaryRequestQuerySchema,
    },
    getTransactionsSummary,
  ),
);

export type GetTransactionsSummaryResponseBody = AsyncReturn<typeof getTransactionsSummaryRoute>;

const createTransaction = async (req: TypedAuthedRequest<{ body: CreateTransactionRequestBody }>) => {
  const transaction = await tryCatch(db.transaction.create({
    select: {
      id: true,
      description: true,
      amount: true,
      category: true,
      createdAt: true,
    },
    data: {
      amount: req.body.amount,
      description: req.body.description,
      category: req.body.category,
      userId: req.user.id,
      createdAt: req.body.timestamp,
      updatedAt: new Date(),
      updatedById: req.user.id,
    },
  }));

  if (transaction._tag === 'err') {
    logger.log(InfoLvl.Error, 'Unable to create transaction', {
      reqId: req.id,
      amount: req.body.amount,
      description: req.body.description,
      category: req.body.category,
      userId: req.user.id,
      createdAt: req.body.timestamp,
      updatedAt: new Date(),
      updatedById: req.user.id,
      error: transaction.error,
    });

    return err(new InternalServerError('Unable to create transaction. Please try again in a few seconds'));
  }

  return ok({
    ...transaction.value,
    amount: transaction.value.amount.toNumber(),
  });
};

const createTransactionRoute = authenticatedRoute(
  validatedRoute(
    {
      body: CreateTransactionRequestBodySchema,
    },
    createTransaction,
  ),
);

export type CreateTransactionResponseBody = AsyncReturn<typeof createTransactionRoute>;

export class TransactionNotFoundError extends Error {
  readonly _tag = 'TransactionNotFound'
  message: string

  constructor(message: string) {
    super();
    this.message = message;
  }
}

const updateTransaction = async (req: TypedAuthedRequest<{
  params: UpdateTransactionRequestParams,
  body: UpdateTransactionRequestBody,
}>) => {
  const transaction = await tryCatch(db.transaction.findUnique({
    select: {
      id: true,
      userId: true,
    },
    where: {
      id: req.params.id,
    },
  }));

  if (transaction._tag === 'err') {
    logger.log(InfoLvl.Error, 'Unable to get transaction', {
      reqId: req.id,
      transactionId: req.params.id,
      error: transaction.error,
    });

    return err(new InternalServerError('Unable to update transaction. Please try again in a few seconds'));
  }

  if (!transaction.value) {
    logger.log(InfoLvl.Debug, 'Tried to update unexistent transaction', {
      reqId: req.id,
      userId: req.user.id,
      transactionId: req.params.id,
    });

    return err(new TransactionNotFoundError('Transaction with id provided not found'));
  }

  if (transaction.value.userId !== req.user.id) {
    logger.log(InfoLvl.Info, 'User tried to update transaction they do not have access to', {
      reqId: req.id,
      userId: req.user.id,
      transactionId: req.params.id,
      transactionOwnerId: transaction.value.userId,
    });

    return err(new ForbiddenError('User does not have access to this transaction'));
  }

  logger.log(InfoLvl.Trace, 'Transaction exists and user has access to it', {
    reqId: req.id,
    userId: req.user.id,
    transactionId: req.params.id,
  });

  const newTransaction = await tryCatch(db.transaction.update({
    select: {
      id: true,
      description: true,
      amount: true,
      category: true,
      createdAt: true,
    },
    where: {
      id: req.params.id,
    },
    data: {
      amount: req.body.amount,
      description: req.body.description,
      category: req.body.category,
      createdAt: req.body.timestamp,
      updatedById: req.user.id,
    },
  }));

  if (newTransaction._tag === 'err') {
    logger.log(InfoLvl.Error, 'Unable to update transaction', {
      reqId: req.id,
      transactionId: req.params.id,
      userId: req.user.id,
      amount: req.body.amount,
      description: req.body.description,
      category: req.body.category,
      createdAt: req.body.timestamp,
      updatedById: req.user.id,
      error: newTransaction.error,
    });

    return err(new InternalServerError('Unable to update transaction. Please try again in a few seconds'));
  }

  return ok({
    ...newTransaction.value,
    amount: newTransaction.value.amount.toNumber(),
  });
};

const updateTransactionRoute = authenticatedRoute(
  validatedRoute(
    {
      params: UpdateTransactionRequestParamsSchema,
      body: UpdateTransactionRequestBodySchema,
    },
    updateTransaction,
  ),
);

export type UpdateTransactionResponseBody = AsyncReturn<typeof updateTransactionRoute>;

export const transactionRoutes: FastifyPluginAsync = async (app, opts) => {
  app.get('/', async (req, res) => {
    const response = await listTransactionsRoute(req);

    if (response._tag === 'err') {
      switch (response.error._tag) {
        case 'Unauthenticated':
        case 'MalformedJWT':
          return res.code(401).send(response);
        case 'ValidationError':
          return res.code(400).send(response);
        case 'InternalServerError':
          return res.code(500).send(response);
      }
    }

    return res.code(200).send(ok(response.value));
  });

  app.get('/summary', async (req, res) => {
    const response = await getTransactionsSummaryRoute(req);

    if (response._tag === 'err') {
      switch (response.error._tag) {
        case 'Unauthenticated':
        case 'MalformedJWT':
          return res.code(401).send(response);
        case 'ValidationError':
          return res.code(400).send(response);
        case 'InternalServerError':
          return res.code(500).send(response);
      }
    }

    return res.code(200).send(ok(response.value));
  });

  app.post('/', async (req, res) => {
    const response = await createTransactionRoute(req);

    if (response._tag === 'err') {
      switch (response.error._tag) {
        case 'Unauthenticated':
        case 'MalformedJWT':
          return res.code(401).send(response);
        case 'ValidationError':
          return res.code(400).send(response);
        case 'InternalServerError':
          return res.code(500).send(response);
      }
    }

    return res.code(200).send(ok(response.value));
  });

  app.put('/:id', async (req, res) => {
    const response = await updateTransactionRoute(req);

    if (response._tag === 'err') {
      switch (response.error._tag) {
        case 'Unauthenticated':
        case 'MalformedJWT':
          return res.code(401).send(response);
        case 'ValidationError':
          return res.code(400).send(response);
        case 'Forbidden':
          return res.code(403).send(response);
        case 'TransactionNotFound':
          return res.code(404).send(response);
        case 'InternalServerError':
          return res.code(500).send(response);
      }
    }

    return res.code(200).send(ok(response.value));
  });
}
