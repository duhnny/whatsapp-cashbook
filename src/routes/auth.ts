import { FastifyPluginAsync } from "fastify";
import { config, db } from "../config/config.js";
import { validatedRoute } from "../middleware/validation.js";
import {
  RequestWhatsappVerificationRequestBody,
  RequestWhatsappVerificationRequestBodySchema,
  SignupRequestBody,
  SignupRequestBodySchema,
} from "../schemas/auth.js";
import { InternalServerError, TypedAuthedRequest, TypedRequest } from "../schemas/global.js";
import { InfoLvl, logger } from "../utils/logging.js";
import { err, ok, syncTryCatch, tryCatch } from "../utils/result.js";
import { EventProcessingStates, eventsHandlerService } from "../services/events.js";
import { quickHash } from "../utils/strings.js";
import { authenticatedRoute } from "../middleware/auth.js";
import { whatsappService } from "../services/whatsapp.js";
import { AsyncReturn } from "../utils/types.js";

export class UserAlreadyExistsError extends Error {
  readonly _tag = 'UserAlreadyExists'
  readonly duplicateField = 'email'
  message: string

  constructor(message: string) {
    super();
    this.message = message;
  }
}

export class NumberIsNotOnWhatsappError extends Error {
  readonly _tag = 'NumberIsNotOnWhatsapp'
  message: string
  phone: bigint

  constructor(phone: bigint, message: string) {
    super();
    this.phone = phone;
    this.message = message;
  }
}

// const signup = async (req: TypedRequest<{ body: SignupRequestBody }>) => {
//   const foundUsers = await tryCatch(db.user.findMany({
//     where: {
//       email: req.body.email,
//     },
//   }));
// 
//   if (foundUsers._tag === 'err') {
//     logger.log(InfoLvl.Error, 'Could not check for email on signup', {
//       reqId: req.id,
//       email: req.body.email,
//       error: foundUsers.error,
//     });
//     return err(new InternalServerError('Unable to signup. Please try again later'));
//   }
// 
//   if (foundUsers.value.length !== 0) {
//     logger.log(InfoLvl.Trace, 'Tried to sign up with email that already exists in database', {
//       reqId: req.id,
//       email: req.body.email,
//     });
// 
//     return err(new UserAlreadyExistsError(`User with email <${req.body.email}> already exists`));
//   }
// 
//   // if we get here, user creation is possible
//   const transactionResult = await tryCatch(db.$transaction(async (tx) => {
//     const user = await tx.user.create({
//       data: {
//         name: req.body.name,
//         email: req.body.email,
// 
//         credentialsProvider: 'CLERK',
//       },
//     });
// 
//     const event = await tx.event.create({
//       data: {
//         name: 'users_creation',
//         idempotencyKey: quickHash(),
//         userId: user.id,
//       },
//     });
// 
//     return { user, event };
//   }));
// 
//   if (transactionResult._tag === 'err') {
//     logger.log(InfoLvl.Error, 'Unable to create user or user creation event in db', {
//       reqId: req.id,
//       email: req.body.email,
//       error: transactionResult.error,
//     });
// 
//     return err(new InternalServerError('Unable to signup. Please try again later'));
//   }
// 
//   // trigger event processing to do background tasks after user creation
//   // IMPORTANT: we do this without awaiting, so that the thread is not blocked
//   eventsHandlerService.run();
// 
//   return ok({
//     message: 'User created successfully! Please, verify WhatsApp to finish sign up.' as const,
//   });
// }
// 
// const signupRoute = validatedRoute({ body: SignupRequestBodySchema }, signup);
// 
// export type SignupResponseBody = AsyncReturn<typeof signupRoute>;

class ServerProcessingUserCreationError extends Error {
  readonly _tag = 'ServerProcessingUserCreation'
  message: string

  constructor(message: string) {
    super();
    this.message = message;
  }
}

const requestWhatsappVerification = async (req: TypedAuthedRequest<{ body: RequestWhatsappVerificationRequestBody }>) => {
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

  if (event.value.done || event.value.processingStage >= EventProcessingStates.users_creation.whatsapp_verification_passed) {
    logger.log(InfoLvl.Trace, 'Whatsapp verification requested for already verified user', {
      userId: req.user.id,
      eventId: event.value.id,
      eventDone: event.value.done,
      eventProcessingStage: event.value.processingStage,
    });

    return ok({
      alreadyVerified: true,
      message: 'User has already verified whatsapp' as const,
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

  // check whatsapp phone number and anonymous id
  const checkPhone = await whatsappService.checkPhone(req.body.phone);

  if (checkPhone._tag === 'err') {
    logger.log(InfoLvl.Warning, 'Whatsapp api returned error while checking phone', {
      reqId: req.id,
      phone: req.body.phone,
      error: checkPhone.error,
    });

    return err(new InternalServerError('WhatsApp service temporarily unavailable. Please try again in a few minutes'));
  }

  if (!checkPhone.value.exists) {
    logger.log(InfoLvl.Debug, 'Attempt to create an account with a phone that is not registered on Whatsapp', {
      reqId: req.id,
      userId: event.value.userId,
      phone: req.body.phone,
    });

    return err(new NumberIsNotOnWhatsappError(req.body.phone, 'The number provided is not on WhatsApp. Please provide a valid number'));
  }

  const whatsappAnonIdResponse = await whatsappService.getWhatsappAnonId(req.body.phone);

  if (whatsappAnonIdResponse._tag === 'err') {
    logger.log(InfoLvl.Warning, 'Whatsapp api returned error while trying to get anon id', {
      reqId: req.id,
      phone: req.body.phone,
      error: whatsappAnonIdResponse.error,
    });

    return err(new InternalServerError('WhatsApp service temporarily unavailable. Please try again in a few minutes'));
  }

  // now we know that whatsappAnonIdResponse.value.whatsappAnonId holds the whatsapp anon id
  // if it exists, because we already checked the number
  let whatsappAnonId: bigint | null = null;

  if (whatsappAnonIdResponse.value.whatsappAnonId) {
    const match = whatsappAnonIdResponse.value.whatsappAnonId.match(/\d+\@lid/);

    if (!match) {
      logger.log(InfoLvl.Error, 'Whatsapp anon id not in expected format', {
        expected: '<number>@lid',
        anonId: whatsappAnonIdResponse.value.whatsappAnonId,
      });

      return err(new InternalServerError('Whatsapp service behaving unexpectedly. Please try again in a few minutes'));
    }

    const numbersOfWhatsappAnonId = whatsappAnonIdResponse.value.whatsappAnonId.replace('@lid', '');

    const parsedWhatsappId = syncTryCatch(() => BigInt(numbersOfWhatsappAnonId))

    if (parsedWhatsappId._tag === 'err') {
      logger.log(InfoLvl.Error, 'Whatsapp anon id not in expected format', {
        expected: '<number>@lid',
        anonId: whatsappAnonIdResponse.value.whatsappAnonId,
      });

      return err(new InternalServerError('Whatsapp service behaving unexpectedly. Please try again in a few minutes'));
    }

    whatsappAnonId = parsedWhatsappId.value;
  }
  
  // now we can create a session and update the phone in the users table
  logger.log(InfoLvl.Trace, 'Creating whatsapp session for whatsapp confirmation', {
    reqId: req.id,
    userId: req.user.id,
  });

  const transactionResult = await tryCatch(db.$transaction(async tx => {
    const expiration = new Date(Date.now() + config.WHATSAPP_SESSION_EXPIRY_SECS * 1000);

    const session = await tx.session.create({
      data: {
        userId: req.user.id,
        kind: 'whatsapp_confirmation',
        status: 'created',
        expiresAt: expiration,
      },
    });

    const whatsappConfirmationEvent = await tx.event.create({
      data: {
        name: 'whatsapp_confirmation_requested',

        userId: req.user.id,
        sessionId: session.id,

        idempotencyKey: quickHash(),
        expiresAt: expiration,
      },
    });

    // TODO: create check in database that does not allow users_creation event without userId
    const user = await tx.user.update({
      where: {
        id: event.value!.userId!,
      },
      data: {
        phone: req.body.phone,
        whatsappAnonId,
      },
    })

    return { whatsappConfirmationEvent, session, user };
  }));

  if (transactionResult._tag === 'err') {
    logger.log(InfoLvl.Error, 'Unable to create whatsapp confirmation event', {
      reqId: req.id,
      userId: req.user.id,
      error: transactionResult.error,
    });

    return err(new InternalServerError('Unable to send whatsapp verification. Please try again later'));
  }

  // trigger event processing to do background tasks after user creation
  // IMPORTANT: we do this without awaiting, so that the thread is not blocked
  eventsHandlerService.run();

  return ok({
    alreadyVerified: false,
    message: 'Verification message sent' as const,
  });
}

const requestWhatsappVerificationRoute = authenticatedRoute(
  validatedRoute(
    {
      body: RequestWhatsappVerificationRequestBodySchema,
    },
    requestWhatsappVerification,
  ),
);

export type RequestWhatsappVerificationResponseBody = AsyncReturn<typeof requestWhatsappVerificationRoute>;

export const authRoutes: FastifyPluginAsync = async (app, opts) => {
  // app.post('/signup', async (req, res) => {
  //   const response = await signupRoute(req);

  //   if (response._tag === 'err') {
  //     switch (response.error._tag) {
  //       case 'ValidationError':
  //       case 'UserAlreadyExists':
  //         return res.code(400).send(response);
  //       case 'InternalServerError':
  //         return res.code(500).send(response);
  //     }
  //   }

  //   return res.code(200).send(ok(response.value));
  // });

  app.post('/whatsapp-verification', async (req, res) => {
    const response = await requestWhatsappVerificationRoute(req);

    if (response._tag === 'err') {
      switch (response.error._tag) {
        case 'Unauthenticated':
        case 'MalformedJWT':
          return res.code(401).send(response);
        case 'ValidationError':
          return res.code(400).send(response);
        case 'NumberIsNotOnWhatsapp':
          return res.code(404).send(response);
        case 'InternalServerError':
          return res.code(500).send(response);
        case 'ServerProcessingUserCreation':
          return res.code(503).send(response);
      }
    }

    return res.code(200).send(ok(response.value));
  });
}
