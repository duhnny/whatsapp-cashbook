import { EventName, Session, SessionKind, User } from "../../prisma/client/client.js";
import { config, db } from "../config/config.js";
import { verifyClerkWebhook } from "../middleware/auth.js";
import { validatedRoute } from "../middleware/validation.js";
import { BasicRequest, InconsistentEventError, InternalServerError, TypedRequest } from "../schemas/global.js";
import { ClerkWebhook, ClerkWebhookSchema, UnofficialWebhookBody, UnofficialWebhookBodySchema } from "../schemas/webhook.js";
import { aiService } from "../services/ai.js";
import { EventProcessingStates } from "../services/events.js";
import { whatsappService } from "../services/whatsapp.js";
import { InfoLvl, logger } from "../utils/logging.js";
import { err, ok, tryCatch } from "../utils/result.js";
import { quickHash } from "../utils/strings.js";
import { AsyncReturn } from "../utils/types.js";

import { FastifyPluginAsync } from "fastify";

// TODO: process for whatsapp verification session too
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
        kind: 'transaction',
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
  if (session.value!.kind === 'transaction') {
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
            const whatsappResponse = await whatsappService.sendText({
              user,
              text: 'Não foi possível identificar transações: ' + aiResponse.value.message,
            });

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
          const whatsappResponse = await whatsappService.sendText({
            user,
            text: 'Confirme as transaçõoes:' + '\n\n'
              + transactionsInOutbox.value.map(transaction => {
                return 'Transação: ' + transaction.description + '\n'
                  + 'Categoria: ' + transaction.category + '\n'
                  + 'Valor: R$' + transaction.amount + '\n'
              }) + '\n'
              + 'Responda com \'SIM\' ou \'NÃO\'',
          });

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

              const whatsappConfirmationResponse = await whatsappService.sendText({ user, text: 'Transações confirmadas com sucesso!' });

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

              const whatsappCancelationResponse = await whatsappService.sendText({ user, text: 'Transações canceladas com sucesso!' });

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
              const whatsappNotFoundResponse = await whatsappService.sendText({ user, text: 'Por favor, responda com \'SIM\' ou \'NÃO\'' });

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
  } else if (session.value!.kind === 'whatsapp_confirmation') {
    // here we will not run asyncronously because if the confirmation fails
    // it should be tried again
    switch (session.value!.status) {
      case 'created': {
        // do nothing
        return ok({
          success: true,
          message: 'Verification message was still not sent' as const,
        });
      }

      case 'pending_confirmation': {
        switch (req.body.data.body.toLowerCase()) {
          case 'sim': {
            const transactionResult = await tryCatch(db.$transaction(async tx => {
              // TODO: here we assume there is only one user creation event per user.
              // this should be enforced via database check
              const userCreationEvents = await tx.event.updateManyAndReturn({
                where: {
                  name: 'users_creation',
                  userId: user.value!.id,
                },
                data: {
                  processingState: EventProcessingStates.users_creation.whatsapp_verification_passed,
                  done: true,
                },
              });

              if (userCreationEvents.length === 0) {
                throw err(new InconsistentEventError(`User with id <${user.value!.id}> should have a ${EventName.users_creation} event`));
              } else if (userCreationEvents.length > 1) {
                throw err(new InconsistentEventError(`User with id <${user.value!.id}> has more than one ${EventName.users_creation} event`));
              }

              const whatsappConfirmationEvents = await tx.event.updateManyAndReturn({
                where: {
                  name: 'whatsapp_confirmation_requested',
                  userId: user.value!.id,
                  sessionId: session.value!.id,
                },
                data: {
                  processingState: EventProcessingStates.whatsapp_confirmation_requested.completed,
                  done: true,
                },
              });

              if (whatsappConfirmationEvents.length === 0) {
                throw err(new InconsistentEventError(`There should be a ${EventName.whatsapp_confirmation_requested} event associated with session with id <${session.value!.id}>`));
              } else if (whatsappConfirmationEvents.length > 1) {
                throw err(new InconsistentEventError(`There should not be more than one ${EventName.whatsapp_confirmation_requested} event associated with session with id <${session.value!.id}>`));
              }

              const newSession = await tx.session.update({
                where: {
                  id: session.value!.id,
                },
                data: {
                  status: 'concluded'
                },
              });

              const newUser = await tx.user.update({
                where: {
                  id: user.value!.id,
                },
                data: {
                  whatsappVerified: true,
                },
              });

              return {
                newSession,
                newUser,
                whatsappEvent: whatsappConfirmationEvents[0]!,
                userCreationEvent: userCreationEvents[0]!,
              };
            }));

            if (transactionResult._tag === 'err') {
              logger.log(InfoLvl.Error, 'Unable to confirm whatsapp', {
                userId: session.value!.userId,
                sessionId: session.value!.id,
                error: transactionResult.error,
              });

              return err(new InternalServerError('Unable to confirm user whatsapp'));
            }

            return ok({
              success: true,
              message: 'WhatsApp verified' as const,
            });
          }

          case 'não': {
            const transactionResult = await tryCatch(db.$transaction(async tx => {
              const userCreationEvents = await tx.event.updateManyAndReturn({
                where: {
                  name: 'users_creation',
                  userId: user.value!.id,
                },
                data: {
                  processingState: EventProcessingStates.users_creation.whatsapp_verification_failed,
                },
              });

              if (userCreationEvents.length === 0) {
                throw err(new InconsistentEventError(`User with id <${user.value!.id}> should have a ${EventName.users_creation} event`));
              } else if (userCreationEvents.length > 1) {
                throw err(new InconsistentEventError(`User with id <${user.value!.id}> has more than one ${EventName.users_creation} event`));
              }

              const whatsappConfirmationEvents = await tx.event.updateManyAndReturn({
                where: {
                  name: 'whatsapp_confirmation_requested',
                  userId: user.value!.id,
                  sessionId: session.value!.id,
                },
                data: {
                  processingState: EventProcessingStates.whatsapp_confirmation_requested.failed,
                  done: true,
                },
              });

              if (whatsappConfirmationEvents.length === 0) {
                throw err(new InconsistentEventError(`There should be a ${EventName.whatsapp_confirmation_requested} event associated with session with id <${session.value!.id}>`));
              } else if (whatsappConfirmationEvents.length > 1) {
                throw err(new InconsistentEventError(`There should not be more than one ${EventName.whatsapp_confirmation_requested} event associated with session with id <${session.value!.id}>`));
              }

              const newSession = await tx.session.update({
                where: {
                  id: session.value!.id,
                },
                data: {
                  status: 'concluded'
                },
              });

              // no need to update user, since whatsapp verification failed
              return {
                newSession,
                whatsappEvent: whatsappConfirmationEvents[0]!,
                userCreationEvent: userCreationEvents[0]!,
              };
            }));

            if (transactionResult._tag === 'err') {
              logger.log(InfoLvl.Error, 'Unable to cancel whatsapp confirmation attempt', {
                userId: session.value!.userId,
                sessionId: session.value!.id,
                error: transactionResult.error,
              });

              return err(new InternalServerError('Unable to cancel whatsapp confirmation'));
            }

            return ok({
              success: true,
              message: 'WhatsApp verification cancelled' as const,
            });
          }

          default: {
            const whatsappNotFoundResponse = await whatsappService.sendText({ user: user.value!, text: 'Por favor, responda com \'SIM\' ou \'NÃO\'' });

            if (whatsappNotFoundResponse._tag === 'err') {
              logger.log(InfoLvl.Error, 'Unable to send message to user saying that the option was not found', {
                reqId: req.id,
                userId: user.value.id,
                sessionId: session.value!.id,
                error: whatsappNotFoundResponse.error,
              });

              return err(new InternalServerError('Unable to send message to user saying that the option was not found'));
            }

            return ok({
              sucess: true,
              message: 'WhatsApp verification continues' as const,
            });
          }
        }
      }

      default: {
        logger.log(InfoLvl.Fatal, 'Inconsistent application state: session.status should be either created or pending_confirmation', {
          sessionId: session.value!.id,
          status: session.value!.status,
        });

        return ok({
          success: false,
          message: 'Inconsistent application state' as const,
        });
      }
    }
  }

  // if we get here, the state of the application is compromised
  logger.log(InfoLvl.Fatal, `Inconsistent application state: session.kind should be either ${SessionKind.whatsapp_confirmation} or ${SessionKind.transaction}`, {
    sessionId: session.value!.id,
    kind: session.value!.kind,
  });

  // we return ok to avoid retries by the whatsapp provider
  return ok({
    success: false,
    message: 'Inconsistent application state' as const,
  });
};

const processUnofficialWebhookRoute = validatedRoute({ body: UnofficialWebhookBodySchema }, processUnofficialWebhook);

export type ProcessUnofficialWebhookResponseBody = AsyncReturn<typeof processUnofficialWebhookRoute>;

export class EmailIsMandatoryError extends Error {
  readonly _tag = 'EmailIsMandatory'
  message: string

  constructor(message: string) {
    super();
    this.message = message;
  }
}

const processClerkWebhook = async (req: TypedRequest<{ body: ClerkWebhook }>) => {
  if (!req.body.data.email_addresses.length) {
    logger.log(InfoLvl.Error, 'User created in Clerk without email', {
      credentialsProviderId: req.body.data.id,
    });

    return err(new EmailIsMandatoryError('Email field is mandatory on user creation'));
  }

  const transactionResult = await tryCatch(db.$transaction(async tx => {
    const user = await tx.user.create({
      data: {
        email: req.body.data.email_addresses[0]!.email_address,
        name: req.body.data.first_name + ' ' + req.body.data.last_name,

        credentialsProvider: 'CLERK',
        credentialsProviderId: req.body.data.id,

        createdAt: new Date(req.body.data.created_at),
      },
    });

    const event = await tx.event.create({
      data: {
        name: 'users_creation',
        userId: user.id,
        processingStage: EventProcessingStates.users_creation.user_created_in_credentials_provider,
        idempotencyKey: quickHash(),
      },
    });

    return { user, event };
  }));

  if (transactionResult._tag === 'err') {
    logger.log(InfoLvl.Error, 'Unable to create clerk user in database internally', {
      credentialsProvider: 'CLERK',
      credentialsProviderId: req.body.data.id,
      error: transactionResult.error,
    });

    return err(new InternalServerError('Could not create user in internal database. Please, try again later'));
  }

  return ok({
    success: true as const,
    message: 'User created sucessfully!' as const,
  });
};

const processClerkWebhookRoute = verifyClerkWebhook(validatedRoute({ body: ClerkWebhookSchema }, processClerkWebhook));

export const webhookRoutes: FastifyPluginAsync = async (app, opts) => {
  app.post('/whatsapp/unofficial', async (req, res) => {
    const response = await processUnofficialWebhookRoute(req);

    if (response._tag === 'err') {
      switch (response.error._tag) {
        case 'ValidationError':
          return res.code(400).send(response);
        case 'InternalServerError':
          return res.code(500).send(response);
      }
    }

    return res.code(200).send(ok(response.value));
  });

  app.post('/clerk', async (req, res) => {
    const response = await processClerkWebhookRoute(req);

    if (response._tag === 'err') {
      switch (response.error._tag) {
        case 'ValidationError':
        case 'EmailIsMandatory':
          return res.code(400).send(response);
        case 'Forbidden':
          return res.code(403).send(response);
        case 'InternalServerError':
          return res.code(500).send(response);
      }
    }

    return res.code(200).send(ok(response.value));
  });
};
