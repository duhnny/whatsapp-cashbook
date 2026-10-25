import { FastifyRequest } from 'fastify';
import { Role } from "../../prisma/client/enums.js";

import z from 'zod';

export type BasicUserData = {
  id: ID,
  phone: bigint,
  email: string | null,
  roles: Role[]
};

// export type BasicRequest = {
//   headers: {
//     authorization?: string | undefined
//   }
//   user?: BasicUserData | undefined
//   params: unknown
//   query: unknown
//   body: unknown
// };
export type BasicRequest = Omit<FastifyRequest, 'user'> & { user: BasicUserData | undefined };

export type AuthedRequest = Omit<BasicRequest, 'user'> & { user: BasicUserData };

export type TypedRequest<T extends { params?: any, query?: any; body?: any } = {}> = BasicRequest & {
  params: 'params' extends keyof T ? T['params'] : unknown;
  query: 'query' extends keyof T ? T['query'] : unknown;
  body: 'body' extends keyof T ? T['body'] : unknown;
};

export type TypedAuthedRequest<T extends { params?: any, query?: any; body?: any } = {}> =
  Omit<TypedRequest<T>, 'user'>
  & { user: BasicUserData };

export class UnauthenticatedError {
  readonly _tag = 'Unauthenticated'
  message?: string
  
  constructor(message?: string) {
    this.message = message;
  }
}

export class ForbiddenError {
  readonly _tag = 'Forbidden'
  message?: string
  
  constructor(message?: string) {
    this.message = message;
  }
}

export class UserNotFoundError {
  readonly _tag = 'UserNotFound'
  message?: string

  constructor(message?: string) {
    this.message = message;
  }
}

export class RoleRequiredError {
  readonly _tag = 'RoleRequired'
  userRoles: Role[]
  requiredRoles: Role[]
  message?: string
  
  constructor(userRoles: Role[], requiredRoles: Role[], message?: string) {
    this.userRoles = userRoles;
    this.requiredRoles = requiredRoles;
    this.message = message;
  }
}

export class ValidationError<W extends 'params' | 'body' | 'query', E> {
  readonly _tag = 'ValidationError'
  where: W
  parseError: E
  message?: string
  
  constructor(where: W, parseError: E, message?: string) {
    this.where = where;
    this.parseError = parseError;
    this.message = message;
  }
}

export class InternalServerError {
  readonly _tag = 'InternalServerError'
  message: string

  constructor(message: string) {
    this.message = message;
  }
}

export const IdSchema = z.int();
export const StringIdSchema = z.coerce.number().int();

export type ID = z.infer<typeof IdSchema>;
