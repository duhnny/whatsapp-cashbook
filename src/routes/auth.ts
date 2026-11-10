import { FastifyPluginAsync } from "fastify";
import { db } from "../config/config.js";
import { validatedRoute } from "../middleware/validation.js";
import { SignupRequestBody, SignupRequestBodySchema } from "../schemas/auth.js";
import { AuthedRequest, InternalServerError, TypedRequest } from "../schemas/global.js";
import { InfoLvl, logger } from "../utils/logging.js";
import { err, ok, tryCatch } from "../utils/result.js";
import { eventsHandlerService } from "../services/events.js";
import { whatsappService } from "../services/whatsapp.js";
import { quickHash } from "../utils/strings.js";

export class UserAlreadyExistsError extends Error {
  readonly _tag = 'UserAlreadyExists'
  duplicateField: 'email' | 'phone'
  message: string

  constructor(duplicateField: 'email' | 'phone', message: string) {
    super();
    this.duplicateField = duplicateField;
    this.message = message;
  }
}

const signup = async (req: TypedRequest<{ body: SignupRequestBody }>) => {
  const foundUsers = await tryCatch(db.user.findMany({
    where: {
      OR: [
        { email: req.body.email },
        { phone: req.body.phone },
      ],
    },
  }));

  if (foundUsers._tag === 'err') {
    logger.log(InfoLvl.Error, 'Could not check for email on signup', {
      reqId: req.id,
      email: req.body.email,
      error: foundUsers.error,
    });
    return err(new InternalServerError('Unable to signup. Please try again later'));
  }

  if (foundUsers.value.length !== 0) {
    const user = foundUsers.value[0];

    if (user?.email === req.body.email) {
      logger.log(InfoLvl.Trace, 'Tried to sign up with email that already exists in database', {
        reqId: req.id,
        email: req.body.email,
      });

      return err(new UserAlreadyExistsError('email', `User with email <${req.body.email}> already exists`));

    } else if (user?.phone === req.body.phone) {
      logger.log(InfoLvl.Trace, 'Tried to sign up with phone that already exists in database', {
        reqId: req.id,
        phone: req.body.phone,
      });

      return err(new UserAlreadyExistsError('phone', `User with phone <${req.body.phone}> already exists`));

    } else {
      logger.log(InfoLvl.Error, 'Found users when querying the database for email or phone, but they do not match', {
        reqId: req.id,
        userId: user?.id,
        email: req.body.email,
        phone: req.body.phone,
      });

      return err(new InternalServerError('Unable to signup. Please try again later'));
    }
  }

  // if we get here, user creation is possible
  const transactionResult = await tryCatch(db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name: req.body.name,
        email: req.body.email,
        phone: req.body.phone,

        credentialsProvider: 'CLERK',
      },
    });

    const event = await tx.event.create({
      data: {
        name: 'users_creation',
        idempotencyKey: quickHash(),
        userId: user.id,
      },
    });

    return { user, event };
  }));

  if (transactionResult._tag === 'err') {
    logger.log(InfoLvl.Error, 'Unable to create user or user creation event in db', {
      reqId: req.id,
      email: req.body.email,
      error: transactionResult.error,
    });

    return err(new InternalServerError('Unable to signup. Please try again later'));
  }

  // trigger event processing to do background tasks after user creation
  // IMPORTANT: we do this without awaiting, so that the thread is not blocked
  eventsHandlerService.run();

  return ok({
    message: 'User created successfully! Please, verify WhatsApp to finish sign up.' as const,
  });
}

const signupRoute = validatedRoute({ body: SignupRequestBodySchema }, signup);

class ServerProcessingUserCreationError extends Error {
  readonly _tag = 'ServerProcessingUserCreation'
  message: string

  constructor(message: string) {
    super();
    this.message = message;
  }
}

const requestWhatsappVerification = async (req: AuthedRequest) => {
  // get user creation event
  const event = await tryCatch(db.event.findFirst({
    where: {
      name: 'users_creation',
      userId: req.user.id,
    },
  }));

  if (event._tag === 'err') {
    logger.log(InfoLvl.Error, 'Unable to locate user creation event with error', {
      reqId: req.id,
      userId: req.user.id,
      error: event.error,
    });

    return err(new InternalServerError('Unable to send whatsapp verification. Please try again later'));
  }

  if (!event.value) {
    logger.log(InfoLvl.Error, 'Unable to locate user creation event', {
      reqId: req.id,
      userId: req.user.id,
    });

    return err(new InternalServerError('Unable to send whatsapp verification. Please try again later'));
  }

  if (event.value.done || event.value.processingStage >= 2) {
    logger.log(InfoLvl.Trace, 'Whatsapp verification requested for already verified user', {
      userId: req.user.id,
      eventId: event.value.id,
      eventDone: event.value.done,
      eventProcessingStage: event.value.processingStage,
    });

    return ok({
      alreadyVerified: true,
      message: 'Verification message sent' as const,
    });
  }

  if (event.value.processingStage === 0) {
    logger.log(InfoLvl.Trace, 'Attempt to verify whatsapp before credentials provider user creation', {
      reqId: req.id,
      userId: req.user.id,
      eventId: event.value.id,
    });

    return err(new ServerProcessingUserCreationError('The server is still processing the user creation. Please wait a few seconds and try again'));
  }

  logger.log(InfoLvl.Trace, 'Sending whatsapp confirmation message');

  whatsappService.sendText()
}

export const authRoutes: FastifyPluginAsync = async (app, opts) => {
  app.post('/signup', async (req, res) => {
    const response = await signupRoute(req);

    if (response._tag === 'err') {
      switch (response.error._tag) {
        case 'ValidationError':
        case 'UserAlreadyExists':
          return res.code(400).send(response);
        case 'InternalServerError':
          return res.code(500).send(response);
      }
    }

    return res.code(200).send(ok(response.value));
  });
}
