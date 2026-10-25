import { InfoLvl, logger } from '../utils/logging.js';
import { auth, config, db } from '../config/config.js';
import { preHandlerHookHandler } from 'fastify';
import z from 'zod';
import jwt from 'jsonwebtoken';
import { CredentialsProvider, Role } from '../../prisma/client/enums.js';
import { err, syncTryCatch, tryCatch } from '../utils/result.js';
import { BasicRequest, BasicUserData, InternalServerError, RoleRequiredError, UnauthenticatedError } from '../schemas/global.js';
import { getAuth } from '@clerk/fastify';
import { HyperlinkSchema } from '../utils/strings.js';

const DecodedTokenSchema = z.object({
  // expiration
  exp: z.int(),

  // not before: when it starts being valid
  nbf: z.int(),

  // authorized party: frontend url
  azp: HyperlinkSchema.optional(),

  // session id
  sid: z.string(),

  // subject: userId
  sub: z.string(),
})

export class MalformedJWTError extends Error {
  readonly _tag = 'MalformedJWT'
  message: string

  constructor(message: string) {
    super();
    this.message = message;
  }
}

export const authenticatedRoute = <T, R extends BasicRequest>(
  next: (req: R) => Promise<T>
) => {
  return async (req: R) => {
    // Your public key should be set as an environment variable
    const publicKey = config.CLERK_JWT_KEY;

    // Retrieve session token from either `__session` cookie for a same-origin request
    // or from the `Authorization` header for cross-origin requests
    const tokenSameOrigin = req.cookies['__session'];
    const tokenCrossOrigin = req.headers.authorization;

    if (!tokenSameOrigin && !tokenCrossOrigin) {
      logger.log(InfoLvl.Info, 'Unauthenticated call', {
        reqId: req.id,
        ip: req.ip,
      });
      return err(new UnauthenticatedError('Please authenticate'));
    }

    let decoded;
    const options: { algorithms: jwt.Algorithm[] } = { algorithms: ['RS256'] }; // The algorithm used to sign the token.
    const permittedOrigins = config.ALLOWED_ORIGINS; // Replace with your permitted origins

    try {
      if (tokenSameOrigin) {
        decoded = jwt.verify(tokenSameOrigin, publicKey, options);
      } else {
        decoded = jwt.verify(tokenCrossOrigin!, publicKey, options);
      }
    } catch (error) {
      logger.log(InfoLvl.Warning, 'Received invalid JWT token for auth', {
        reqId: req.id,
        ip: req.ip,
        token: tokenSameOrigin || tokenCrossOrigin,
      });
      return err(new UnauthenticatedError('Invalid auth token'));
    }

    if (typeof decoded === 'string') {
      logger.log(InfoLvl.Warning, 'Received malformed JWT token for auth', {
        reqId: req.id,
        ip: req.ip,
        token: tokenSameOrigin || tokenCrossOrigin,
      });
      return err(new MalformedJWTError('JWT could not be parsed'));
    }

    const parsed = DecodedTokenSchema.safeParse(decoded);

    if (!parsed.success) {
      logger.log(InfoLvl.Warning, 'Received malformed JWT token for auth', {
        reqId: req.id,
        ip: req.ip,
        token: tokenSameOrigin || tokenCrossOrigin,
      });
      return err(new MalformedJWTError('JWT could not be parsed'));
    }

    // Validate the token's expiration (exp) and not before (nbf) claims
    const currentTime = Math.floor(Date.now() / 1000);
    if (parsed.data.exp < currentTime || parsed.data.nbf > currentTime) {
      logger.log(InfoLvl.Debug, 'Received expired JWT token for auth', {
        reqId: req.id,
        ip: req.ip,
        token: tokenSameOrigin || tokenCrossOrigin,
      });
      return err(new UnauthenticatedError('Auth token is now invalid'));
    }

    // Validate the token's authorized party (azp) claim
    if (parsed.data.azp && !permittedOrigins.includes(parsed.data.azp)) {
      logger.log(InfoLvl.Debug, 'JWT token\'s azp claim does not match allowed origins', {
        reqId: req.id,
        ip: req.ip,
        token: tokenSameOrigin || tokenCrossOrigin,
      });
      return err(new UnauthenticatedError('Invalid \'azp\' claim'));
    }

    // get user id in auth provider
    const authId = parsed.data.sub;

    // find user in database
    const query = {
      credentialsProvider: CredentialsProvider.CLERK,
      credentialsProviderId: authId,
    };

    const user = await tryCatch(db.user.findUnique({
      where: query,
      select: {
        id: true,
        email: true,
        phone: true,
        roles: true
      },
    }));

    if (user._tag === 'err') {
      logger.log(InfoLvl.Error, 'Unable to query database for user during auth validation', {
        authId,
        reqId: req.id,
      });
      return err(new InternalServerError('Unable to authenticate user. Try again later'));
    }

    if (!user.value) {
      logger.log(InfoLvl.Trace, 'User not found', query);
      return err(new UnauthenticatedError('User not found. Please register'));
    }

    // add user data to request object
    return await next({
      ...req,
      user,
    } as R);
  }
}

/**
 * Middleware para verificar role do usuário
 * ATUALIZADO: Busca por email em vez de UID
 */
export const requiredRolesRoute = <T, R extends BasicRequest>(
  allowedRoles: Role[],
  next: (req: R) => Promise<T>,
) => {
  return async (req: R & { user: BasicUserData }) => {
    // check if list of allowed roles includes at least one user role
    if (!req.user.roles.some(role => allowedRoles.includes(role))) {
      return err(new RoleRequiredError(req.user.roles, allowedRoles));
    }

    // run next in line
    return await next(req);
  }
}
