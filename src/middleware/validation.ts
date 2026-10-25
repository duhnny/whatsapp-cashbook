import z from 'zod';
import { TypedRequest } from '../schemas/global.js';
import { Err, err } from '../utils/result.js';
import { ValidationError } from '../schemas/global.js';

type ExtractValidationError<
  Where extends 'params' | 'body' | 'query', 
  Schema extends z.ZodType | undefined
> = Schema extends z.ZodType 
  ? Err<ValidationError<Where, z.ZodError<z.infer<Schema>>>>
  : never;

export interface ValidatedRouteMiddleware {
  <
    T,
    R extends TypedRequest<{
      params: P extends z.ZodType ? z.infer<P> : R['params'],
      query: Q extends z.ZodType ? z.infer<Q> : R['query'],
      body: B extends z.ZodType ? z.infer<B> : R['body']
    }>,
    P extends z.ZodType | undefined = undefined,
    Q extends z.ZodType | undefined = undefined,
    B extends z.ZodType | undefined = undefined,
  >(
    schema: { params?: P, query?: Q; body?: B },
    next: (req: R) => Promise<T>
  ): (req: Omit<R, 'params' | 'query' | 'body'> & {
    params: unknown,
    query: unknown,
    body: unknown,
  }) => Promise<
    T
    | ExtractValidationError<'params', P>
    | ExtractValidationError<'query', Q>
    | ExtractValidationError<'body', B>
  >;
}

export const validatedRoute: ValidatedRouteMiddleware = (
  schema: { params?: z.ZodType, query?: z.ZodType; body?: z.ZodType },
  next
): any => {
  return async (req: any) => {
    // validate input
    let parsedParams = req.params;
    if (schema.params) {
      const result = schema.params.safeParse(req.params);

      if (!result.success) {
        return err(new ValidationError('params', result.error))
      }
      
      parsedParams = result.data
    }

    let parsedQuery = req.query;
    if (schema.query) {
      const result = schema.query.safeParse(req.query);

      if (!result.success) {
        return err(new ValidationError('query', result.error))
      }
      
      parsedQuery = result.data
    }
    
    let parsedBody = req.body;
    if (schema.body) {
      const result = schema.body.safeParse(req.body);
      
      if (!result.success) {
        return err(new ValidationError('body', result.error))
      }
      
      parsedBody = result.data
    }

    // run next in line
    return await next({
      ...req,
      params: parsedParams,
      query: parsedQuery,
      body: parsedBody,
    });
  }
}
