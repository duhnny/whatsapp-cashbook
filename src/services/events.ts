import { Event, EventName } from '../../prisma/client/client.js';
import { auth, db } from '../config/config.js';
import { InconsistentEventError, InternalServerError, UserNotFoundError } from '../schemas/global.js';
import { InfoLvl, logger, Logger } from '../utils/logging.js';
import { err, ok, tryCatch } from '../utils/result.js';

import { User } from '@clerk/fastify';
import { whatsappService } from './whatsapp.js';

class ClerkError extends Error {
  readonly _tag = 'Clerk'
  message: string

  constructor(message: string) {
    super();
    this.message = message;
  }
}

class UnknownEventError extends Error {
  readonly _tag = 'UnknownEvent'
  name: EventName
  message: string

  constructor(name: EventName, message: string) {
    super();
    this.name = name;
    this.message = message;
  }
}

class UnableToUpdateEventError extends Error {
  readonly _tag = 'UnableToUpdateEvent'
  message: string
  id: Event['id']
  name: EventName
  processingStage: number
  done: boolean

  constructor(params: {
    message: string
    id: Event['id']
    name: EventName
    processingStage: number
    done: boolean
  }) {
    super();
    this.message = params.message;
    this.id = params.id;
    this.name = params.name;
    this.processingStage = params.processingStage;
    this.done = params.done;
  }
}

class EventsHandlerService {
  private running: boolean
  private logger: Logger

  constructor(logger: Logger) {
    this.running = false;
    this.logger = logger;
  }

  async run() {
    if (this.running) {
      return;
    }

    this.running = true;

    // get events
    const now = new Date();

    const events = await tryCatch(db.event.findMany({
      where: {
        done: false,
        OR: [
          { expiresAt: { gte: now } },
          { expiresAt: null },
        ]
      },
    }));

    if (events._tag === 'err') {
      this.logger.log(InfoLvl.Error, 'Unable to get events in database', {
        error: events.error,
      });

      this.running = false;
      return;
    }

    for (const event of events.value) {
      this.logger.log(InfoLvl.Trace, 'Starting processing of event', {
        eventId: event.id,
        processingStage: event.processingStage,
        done: event.done,
      });

      const result = await this.processEvent(event);

      if (result._tag === 'err') {
        this.logger.log(InfoLvl.Trace, 'Error while trying to process event', {
          eventId: event.id,
          error: result.error,
        });

        continue;
      }

      this.logger.log(InfoLvl.Trace, 'Finished processing event', {
        eventId: event.id,
        processingStage: result.value.processingStage,
        done: result.value.done,
      });
    }

    this.running = false;
  }

  private async processEvent(event: Event) {
    if (event.name === 'users_creation') {
      let done = event.done;
      let processingStage = event.processingStage;

      if (event.processingStage <= 0) {
        // user ready for creation in Clerk
        if (event.userId === null) {
          this.logger.log(InfoLvl.Error, `${EventName.users_creation} event does not have user attatched`, {
            id: event.id,
          });

          return err(new InconsistentEventError(`${EventName.users_creation} event does not have user attatched`));
        }

        const user = await tryCatch(db.user.findUnique({
          where: {
            id: event.userId,
          },
        }));

        if (user._tag === 'err') {
          this.logger.log(InfoLvl.Error, `Unable to find user for ${EventName.users_creation} event`, {
            eventId: event.id,
            userId: event.userId,
          });

          return err(new InternalServerError(`Unable to find user for ${EventName.users_creation} event`));
        }

        if (!user.value) {
          this.logger.log(InfoLvl.Error, `User for ${EventName.users_creation} event not found`, {
            eventId: event.id,
            userId: event.userId,
          });

          return err(new UserNotFoundError(`User for ${EventName.users_creation} event not found`));
        }

        // create user in clerk

        // first, check if user was already created
        const clerkUsers = await tryCatch(auth.users.getUserList({
          phoneNumber: [String(user.value.phone)],
        }));

        if (clerkUsers._tag === 'err') {
          this.logger.log(InfoLvl.Error, 'Unable to get users from Clerk', {
            eventId: event.id,
          });

          return err(new ClerkError('Unable to get users from Clerk'));
        }

        // this will be the user in Clerk service
        let clerkUser: User;

        if (clerkUsers.value.data.length !== 0) {
          this.logger.log(InfoLvl.Debug, 'User exists in clerk, but database was not yet updated... Updating now', {
            userId: event.userId,
          });

          clerkUser = clerkUsers.value.data[0]!;
        } else {
          const clerkUserCreation = await tryCatch(auth.users.createUser({
            firstName: user.value.name.split(' ')[0],
            lastName: user.value.name.split(' ').slice(1).join(' '),
            phoneNumber: [String(user.value.phone)],
          }));

          if (clerkUserCreation._tag === 'err') {
            this.logger.log(InfoLvl.Warning, `Unable to create user on clerk`, {
              eventId: event.id,
              userId: event.userId,
              error: clerkUserCreation.error,
            });

            return err(new ClerkError(`Unable to create user on clerk`));
          }

          clerkUser = clerkUserCreation.value;
        }

        const transactionResult = await tryCatch(db.$transaction(async tx => {
          const updatedUser = await tx.user.update({
            where: {
              id: event.userId!,
            },
            data: {
              credentialsProviderId: clerkUser.id,
            },
          });

          const updatedEvent = await tx.event.update({
            where: {
              id: event.id,
            },
            data: {
              processingStage: 1
            },
          });

          return { updatedUser, updatedEvent };
        }));

        if (transactionResult._tag === 'err') {
          this.logger.log(InfoLvl.Warning, 'Unable to update user with credentials provider id', {
            eventId: event.id,
            userId: event.userId,
            credentialsProviderId: clerkUser.id,
            error: transactionResult.error,
          });

          return err(new InternalServerError('Unable to update database user with credentials provider id'));
        }

        done = transactionResult.value.updatedEvent.done;
        processingStage = transactionResult.value.updatedEvent.processingStage;

        this.logger.log(InfoLvl.Debug, 'User created on Clerk sucessfully', {
          eventId: event.id,
          userId: event.userId,
          credentialsProviderId: clerkUser.id,
        });
      }

      if (event.processingStage <= 1) {
        // whatsapp confirmation
        // do nothing
      }

      return ok({
        processingStage,
        done,
      });
    } else if (event.name === 'whatsapp_confirmation_requested') {
      let processingStage = event.processingStage;

      if (processingStage === 0) {
        // event just created: we need to send a whatsapp message
        if (event.userId === null) {
          this.logger.log(InfoLvl.Error, `${EventName.whatsapp_confirmation_requested} event does not have user attatched`, {
            id: event.id,
          });

          return err(new InconsistentEventError(`${EventName.whatsapp_confirmation_requested} event does not have user attatched`));
        }

        if (event.sessionId === null) {
          this.logger.log(InfoLvl.Error, `${EventName.whatsapp_confirmation_requested} event does not have session attatched`, {
            id: event.id,
          });

          return err(new InconsistentEventError(`${EventName.whatsapp_confirmation_requested} event does not have session attatched`));
        }

        // get the user

        const user = await tryCatch(db.user.findUnique({
          where: {
            id: event.userId,
          },
        }));

        if (user._tag === 'err') {
          this.logger.log(InfoLvl.Error, `Unable to find user for ${EventName.users_creation} event`, {
            eventId: event.id,
            userId: event.userId,
          });

          return err(new InternalServerError(`Unable to find user for ${EventName.users_creation} event`));
        }

        if (!user.value) {
          this.logger.log(InfoLvl.Error, `User for ${EventName.users_creation} event not found`, {
            eventId: event.id,
            userId: event.userId,
          });

          return err(new UserNotFoundError(`User for ${EventName.users_creation} event not found`));
        }

        // send whatsapp message
        const whatsappResponse = await whatsappService.sendText(
          user.value,
          `Verificação por WhatsApp: Se você é ${user.value.name} e registrou recentemente nos`
          + `nossos serviços, por favor digite 'SIM' para confirmar. Caso contrário, responda com 'NÃO'.`
        );

        if (whatsappResponse._tag === 'err') {
          logger.log(InfoLvl.Warning, 'Unable to send whatsapp verification message', {
            userId: event.userId,
            error: whatsappResponse.error,
          });

          return whatsappResponse;
        }

        const transactionResult = await tryCatch(db.$transaction(async tx => {
          const newWhatsappConfirmationEvent = await tx.event.update({
            where: {
              id: event.id,
            },
            data: {
              processingStage: 1,
            },
          });

          const newWhatsappSession = await tx.session.update({
            where: {
              id: event.sessionId!,
            },
            data: {
              status: 'pending_confirmation',
            },
          });

          return { newWhatsappConfirmationEvent, newWhatsappSession };
        }));

        if (transactionResult._tag === 'err') {
          logger.log(InfoLvl.Warning, 'Unable to update whatsapp confirmation event or whatsapp confirmation session after sending message', {
            eventId: event.id,
            sessionId: event.sessionId,
            processingStage: 1,
            done: false,
            error: transactionResult.error,
          });

          return err(new UnableToUpdateEventError({
            message: 'Message was sent but the event could not be updated',
            id: event.id,
            name: event.name,
            processingStage: 1,
            done: false,
          }));
        }

        // if we get here, everything went right
        logger.log(InfoLvl.Debug, 'Whatsapp verification message sent sucessfully!', {
          sucess: whatsappResponse.value.success,
        });
        return ok({
          processingStage: 1,
          done: false,
        });
      }
    }

    this.logger.log(InfoLvl.Fatal, 'Unknown event in event handler service', {
      eventId: event.id,
      eventName: event.name,
    });
    return err(new UnknownEventError(event.name, 'Unknown event in event handler service'));
  }
}

export const eventsHandlerService = new EventsHandlerService(logger);
