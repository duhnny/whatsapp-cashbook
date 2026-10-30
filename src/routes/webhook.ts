import { Session, User } from "../../prisma/client/client.js";
import { config, db } from "../config/config.js";
import { validatedRoute } from "../middleware/validation.js";
import { BasicRequest, TypedRequest } from "../schemas/global.js";
import { UnofficialWebhookBody, UnofficialWebhookBodySchema } from "../schemas/webhook.js";
import { aiService } from "../services/ai.js";
import { whatsappService } from "../services/whatsapp.js";
import { InfoLvl, logger } from "../utils/logging.js";
import { ok, tryCatch } from "../utils/result.js";
import { AsyncReturn } from "../utils/types.js";

import { FastifyPluginAsync } from "fastify";

const processUnofficialWebhook = async (req: TypedRequest<{ body: UnofficialWebhookBody }>) => {
  if (req.body.data.type !== 'text') {
    return ok({
      success: true,
      message: 'No automation defined for non-text messages',
    });
  }

  // get the user
  let userQuery;

  switch (req.body.data.from.kind) {
    case 'number':
      userQuery = { phone: req.body.data.from.id };
      break;

    case 'anonymous':
      userQuery = { whatsappAnonId: req.body.data.from.id };
      break;
  }

  const user = await tryCatch(db.user.findFirst({
    where: {
      AND: [
        { active: true, },
        userQuery,
      ]
    },
  }));

  if (user._tag === 'err') {
    logger.log(InfoLvl.Error, 'Unable to query database for user', {
      reqId: req.id,
      query: userQuery,
      error: user.error,
    });
    return ok({
      success: false,
      message: 'Unable to get user' as const,
    });
  }

  if (!user.value) {
    logger.log(InfoLvl.Debug, 'User that sent message not found', {
      reqId: req.id,
      query: userQuery,
    });
    return ok({
      success: true,
      message: 'User not found' as const,
    });
  }

  // if we get here, the user was found
  // let's try to get active session
  const now = new Date();

  let session = await tryCatch(db.session.findFirst({
    where: {
      userId: user.value.id,
      createdAt: {
        lt: now,
      },
      expiresAt: {
        gte: now,
      },
      status: {
        not: 'concluded',
      },
    },
  }));

  if (session._tag === 'err') {
    logger.log(InfoLvl.Error, 'Unable to query database for sessions', {
      reqId: req.id,
      userId: user.value.id,
      error: session.error,
    });
    return ok({
      success: false,
      message: 'Unable to get session' as const,
    });
  }

  if (!session.value) {
    session = await tryCatch(db.session.create({
      data: {
        userId: user.value.id,
        expiresAt: new Date(now.valueOf() + 1000 * config.WHATSAPP_SESSION_EXPIRY_SECS),
        status: 'created',
      },
    }));

    if (session._tag === 'err') {
      logger.log(InfoLvl.Error, 'Unable to create session in database', {
        reqId: req.id,
        userId: user.value.id,
        error: session.error,
      });
      return ok({
        success: false,
        message: 'Unable to create session' as const,
      });
    }
  }

  // run asyncronously to avoid having a hanging provider
  switch (session.value!.status) {
    case 'created':
      (async (reqId: BasicRequest['id'], user: User, session: Session, text: string) => {
        const aiResponse = await aiService.createOutboxTransaction(user.id, session.id, text);

        if (aiResponse._tag === 'err') {
          logger.log(InfoLvl.Error, 'Unable to invoke agent to create transaction', {
            reqId,
            text,
            userId: user.id,
            sessionId: session.id,
            error: aiResponse.error,
          });

          return;
        }

        const transactionsInOutbox = await tryCatch(db.outboxTransaction.findMany({
          where: {
            sessionId: session.id,
          },
        }));

        if (transactionsInOutbox._tag === 'err') {
          logger.log(InfoLvl.Error, 'Unable to get transactions in the outbox', {
            sessionId: session.id,
            error: transactionsInOutbox.error,
          });

          return;
        }

        if (transactionsInOutbox.value.length === 0) {
          const whatsappResponse = await whatsappService.sendText(
            user,
            'Não foi possível identificar transações: ' + aiResponse.value.message,
          );

          if (whatsappResponse._tag === 'err') {
            logger.log(InfoLvl.Error, 'Unable to send message to user about no transactions found', {
              reqId,
              userId: user.id,
              sessionId: session.id,
              error: whatsappResponse.error,
            });

            return;
          }

          return;
        }

        // if we get here, then the transactions are ok
        // then we send the user a message to confirm the transactions
        const whatsappResponse = await whatsappService.sendText(
          user,
          'Confirme as transaçõoes:' + '\n\n'
          + transactionsInOutbox.value.map(transaction => {
            return 'Transação: ' + transaction.description + '\n'
              + 'Categoria: ' + transaction.category + '\n'
              + 'Valor: R$' + transaction.amount + '\n'
          }) + '\n'
          + 'Responda com \'SIM\' ou \'NÃO\'',
        );

        if (whatsappResponse._tag === 'err') {
          logger.log(InfoLvl.Error, 'Unable to send message to user to confirm transactions', {
            reqId,
            userId: user.id,
            sessionId: session.id,
            error: whatsappResponse.error,
          });

          return;
        }

        logger.log(InfoLvl.Trace, 'Sent confirmation message about transactions in session', {
          reqId,
          userId: user.id,
          sessionId: session.id,
        });

        const updatedSession = await tryCatch(db.session.update({
          where: {
            id: session.id,
          },
          data: {
            status: 'pending_confirmation',
          },
        }));

        if (updatedSession._tag === 'err') {
          logger.log(InfoLvl.Error, 'Unable to update session status to pending_confirmation after confirmation message has been sent', {
            reqId,
            userId: user.id,
            sessionId: session.id,
            error: updatedSession.error,
          });

          return;
        }

        logger.log(InfoLvl.Trace, 'Updated session status to pending_confirmation after sending confirmation message', {
          reqId,
          sessionId: session.id,
        });
        return;
      })(req.id, user.value, session.value!, req.body.data.body);

      return ok({
        success: true,
        message: 'Invoked agent' as const,
      });

    case 'pending_confirmation':
      (async (reqId: BasicRequest['id'], user: User, session: Session, text: string) => {
        switch (text.toLowerCase()) {
          case 'sim':
            const toBeConfirmedTransactions = await tryCatch(db.outboxTransaction.findMany({
              where: {
                sessionId: session.id,
              },
            }));

            if (toBeConfirmedTransactions._tag === 'err') {
              logger.log(InfoLvl.Error, 'Unable to get outbox transactions for confirmation', {
                reqId,
                userId: user.id,
                sessionId: session.id,
                error: toBeConfirmedTransactions.error,
              });

              return;
            }

            const transactionsConfirmationResult = await tryCatch(db.$transaction(async (tx) => {
              const createTransactionsResult = await tx.transaction.createMany({
                data: toBeConfirmedTransactions.value.map(transaction => {
                  return {
                    userId: user.id,
                    amount: transaction.amount,
                    category: transaction.category,
                    description: transaction.description,
                    createdAt: transaction.createdAt,
                    updatedAt: transaction.createdAt,
                    updatedById: user.id,
                  };
                }),
              });

              const cleanOutboxResult = await tx.outboxTransaction.deleteMany({
                where: {
                  sessionId: session.id,
                },
              });

              const updatedSession = await tx.session.update({
                where: {
                  id: session.id,
                },
                data: {
                  status: 'concluded',
                },
              });

              return {
                createTransactionsResult,
                cleanOutboxResult,
                updatedSession,
              };
            }));

            if (transactionsConfirmationResult._tag === 'err') {
              logger.log(InfoLvl.Error, 'Unable to confirm transactions', {
                reqId,
                userId: user.id,
                sessionId: session.id,
                error: transactionsConfirmationResult.error,
              });

              return;
            }

            const whatsappConfirmationResponse = await whatsappService.sendText(user, 'Transações confirmadas com sucesso!');

            if (whatsappConfirmationResponse._tag === 'err') {
              logger.log(InfoLvl.Error, 'Unable to send message to user saying that the transactions were confirmed', {
                reqId,
                userId: user.id,
                sessionId: session.id,
                error: whatsappConfirmationResponse.error,
              });

              return;
            }

            return;

          case 'não':
            const transactionsCancelationResult = await tryCatch(db.$transaction(async (tx) => {
              const cleanOutboxResult = await tx.outboxTransaction.deleteMany({
                where: {
                  sessionId: session.id,
                },
              });

              const updatedSession = await tx.session.update({
                where: {
                  id: session.id,
                },
                data: {
                  status: 'concluded',
                },
              });

              return {
                cleanOutboxResult,
                updatedSession,
              };
            }));

            if (transactionsCancelationResult._tag === 'err') {
              logger.log(InfoLvl.Error, 'Unable to confirm transactions', {
                reqId,
                userId: user.id,
                sessionId: session.id,
                error: transactionsCancelationResult.error,
              });

              return;
            }

            const whatsappCancelationResponse = await whatsappService.sendText(user, 'Transações canceladas com sucesso!');

            if (whatsappCancelationResponse._tag === 'err') {
              logger.log(InfoLvl.Error, 'Unable to send message to user saying that the transactions were cancelled', {
                reqId,
                userId: user.id,
                sessionId: session.id,
                error: whatsappCancelationResponse.error,
              });

              return;
            }

            return;

          default:
            const whatsappNotFoundResponse = await whatsappService.sendText(user, 'Por favor, responda com \'SIM\' ou \'NÃO\'');

            if (whatsappNotFoundResponse._tag === 'err') {
              logger.log(InfoLvl.Error, 'Unable to send message to user saying that the option was not found', {
                reqId,
                userId: user.id,
                sessionId: session.id,
                error: whatsappNotFoundResponse.error,
              });

              return;
            }

            return;
        }
      })(req.id, user.value, session.value!, req.body.data.body);

      return ok({
        success: true,
        message: 'Recieved confirmation' as const,
      });

    default:
      logger.log(InfoLvl.Fatal, 'Inconsistent application state: session.status should be either created or pending_confirmation', {
        sessionId: session.value!.id,
        status: session.value!.status,
      });

      return ok({
        success: false,
        message: 'Inconsistent application state' as const,
      });
  }
};

const processUnofficialWebhookRoute = validatedRoute({ body: UnofficialWebhookBodySchema }, processUnofficialWebhook);

export type ProcessUnofficialWebhookResponseBody = AsyncReturn<typeof processUnofficialWebhookRoute>;

export const webhookRoutes: FastifyPluginAsync = async (app, opts) => {
  app.post('/unofficial', async (req, res) => {
    const response = await processUnofficialWebhookRoute(req);

    if (response._tag === 'err') {
      switch (response.error._tag) {
        case 'ValidationError':
          return res.code(400).send(response);
      }
    }

    return res.code(200).send(ok(response.value));
  });
};
