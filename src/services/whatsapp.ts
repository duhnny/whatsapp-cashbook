import { User } from "../../prisma/client/client.js";
import { config } from "../config/config.js";
import { WhatsappCheckPhoneResponseBodySchema, WhatsappGetAnonIdResponseBodySchema } from "../schemas/whatsapp.js";
import { logger, InfoLvl } from "../utils/logging.js";
import { err, ok, tryCatch } from "../utils/result.js";

class NoChatIdError extends Error {
  readonly _tag = 'NoChatId';
  message: string

  constructor(message: string) {
    super();
    this.message = message;
  }
}

class WhatsappApiError extends Error {
  readonly _tag = 'WhatsappApi';
  message: string

  constructor(message: string) {
    super();
    this.message = message;
  }
}

interface WhatsappUser {
  phone?: User['phone'],
  whatsappAnonId?: User['whatsappAnonId'],
}

interface SendTextParams<T extends WhatsappUser> {
  user: T,
  text: string,
  idempotencyKey?: string,
}

class WhatsappService {
  baseUrl: string
  sessionId: string

  constructor(baseUrl: string, sessionId: string) {
    this.baseUrl = baseUrl;
    this.sessionId = sessionId;
  }

  public changeSessionId(newSessionId: string) {
    this.sessionId = newSessionId;
  }

  public async sendText<T extends WhatsappUser>({ user, text, idempotencyKey }: SendTextParams<T>) {
    if (user.phone === undefined && user.whatsappAnonId === undefined) {
      logger.log(InfoLvl.Warning, 'whatsappService.sendText was called with user without whatsapp identification', {
        user,
        text,
      });
      return err(new NoChatIdError('Provided user does not have phone or whatsappId. At least one of these is needed to identify the chat'));
    }

    const url = `${this.baseUrl}/sessions/${this.sessionId}/messages/send-text`;

    const headers = new Headers({
      'X-API-Key': config.OPENWA_API_KEY,
      'Content-Type': 'application/json',
    });

    if (idempotencyKey) {
      headers.append('Idempotency-Key', idempotencyKey);
    }

    const response = await tryCatch(fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        chatId: user.whatsappAnonId ? `${user.whatsappAnonId}@lid` : `${user.phone}@c.us`,
        text,
      }),
    }));

    if (response._tag === 'err') {
      logger.log(InfoLvl.Error, 'Whatsapp api returned error', {
        phone: user.phone,
        whatsappAnonId: user.whatsappAnonId,
        error: response.error.message,
      });
      return err(new WhatsappApiError('Unable to send message through whatsapp API'));
    }

    if (!response.value.ok) {
      const body = await response.value.json();

      logger.log(InfoLvl.Error, 'Whatsapp api returned error', {
        phone: user.phone,
        whatsappAnonId: user.whatsappAnonId,
        response: body,
      });
      return err(new WhatsappApiError('Unable to send message through whatsapp API'));
    }

    return ok({
      success: true,
    });
  }

  public async checkPhone(phone: bigint) {
    const url = `${this.baseUrl}/sessions/${this.sessionId}/contacts/check/${phone}`;

    const response = await tryCatch(fetch(url, {
      method: 'GET',
      headers: {
        'X-API-Key': config.OPENWA_API_KEY,
      },
    }));

    if (response._tag === 'err') {
      logger.log(InfoLvl.Error, 'Whatsapp api returned error while trying to check number', {
        phone: phone,
        error: response.error.message,
      });

      return err(new WhatsappApiError('Unable to check phone number'));
    }

    const responseBody = await tryCatch(response.value.json());

    if (responseBody._tag === 'err') {
      const bytes = await tryCatch(response.value.bytes());

      logger.log(InfoLvl.Error, 'Whatsapp api did not return valid json', {
        url,
        raw: bytes._tag === 'ok' ? bytes.value.toBase64() : undefined,
      });

      return err(new WhatsappApiError('WhatsApp api did not return valid JSON'));
    }

    const parsedBody = WhatsappCheckPhoneResponseBodySchema.safeParse(responseBody.value);

    if (!parsedBody.success) {
      logger.log(InfoLvl.Error, 'Whatsapp api did not return expected response schema while checking phone', {
        phone,
        url,
        body: responseBody.value,
      });

      return err(new WhatsappApiError('Whatsapp api did not return expected schema'));
    }

    if (parsedBody.data.exists && parsedBody.data.whatsappId) {
      logger.log(InfoLvl.Trace, 'Checked and found whatsapp phone', {
        phone,
        whatsappId: parsedBody.data.whatsappId,
      });

      return ok({
        exists: parsedBody.data.exists,
        whatsappId: parsedBody.data.whatsappId,
      });
    } else {
      return ok({
        exists: false,
      });
    }
  }

  /** 
  * will return null if either the number does not exist in whatsapp
  * or if it does not have an anonymous id.
  */
  public async getWhatsappAnonId(phone: bigint) {
    const url = `${this.baseUrl}/sessions/${this.sessionId}/contacts/${phone}/lid`;

    const response = await tryCatch(fetch(url, {
      method: 'GET',
      headers: {
        'X-API-Key': config.OPENWA_API_KEY,
      },
    }));

    if (response._tag === 'err') {
      logger.log(InfoLvl.Error, 'Whatsapp api returned error while trying to get anon id', {
        phone: phone,
        error: response.error.message,
      });

      return err(new WhatsappApiError('Unable to get anon id'));
    }

    const responseBody = await tryCatch(response.value.json());

    if (responseBody._tag === 'err') {
      const bytes = await tryCatch(response.value.bytes());

      logger.log(InfoLvl.Error, 'Whatsapp api did not return valid json', {
        url,
        raw: bytes._tag === 'ok' ? bytes.value.toBase64() : undefined,
      });

      return err(new WhatsappApiError('WhatsApp api did not return valid JSON'));
    }

    const parsedBody = WhatsappGetAnonIdResponseBodySchema.safeParse(responseBody.value);

    if (!parsedBody.success) {
      logger.log(InfoLvl.Error, 'Whatsapp api did not return expected response schema while getting anon id', {
        phone,
        url,
        body: responseBody.value,
      });

      return err(new WhatsappApiError('Whatsapp api did not return expected schema'));
    }

    return ok({
      whatsappAnonId: parsedBody.data.lid,
    });
  }
}

export const whatsappService = new WhatsappService(
  config.WHATSAPP_API_BASE_URL,
  config.OPENWA_SESSION_ID,
);
