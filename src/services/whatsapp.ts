import { User } from "../../prisma/client/client.js";
import { config } from "../config/config.js";
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

  public async sendText<T extends {
    phone?: User['phone'],
    whatsappAnonId?: User['whatsappAnonId'],
  }>(user: T, text: string) {
    if (user.phone === undefined && user.whatsappAnonId === undefined) {
      logger.log(InfoLvl.Warning, 'whatsappService.sendText was called with user without whatsapp identification', {
        user,
        text,
      });
      return err(new NoChatIdError('Provided user does not have phone or whatsappId. At least one of these is needed to identify the chat'));
    }

    const url = `${this.baseUrl}/sessions/${this.sessionId}/messages/send-text`;

    const response = await tryCatch(fetch(url, {
      method: 'POST',
      headers: {
        'X-API-Key': config.OPENWA_API_KEY,
        'Content-Type': 'application/json',
      },
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
}

export const whatsappService = new WhatsappService(
  config.WHATSAPP_API_BASE_URL,
  config.OPENWA_SESSION_ID,
);
