export class Ok<T> {
  readonly _tag = "ok"
  value: T

  constructor(value: T) {
    this.value = value;
  }
}

export class Err<E> {
  readonly _tag = "err"
  error: E

  constructor(error: E) {
    this.error = error
  }
}

export function ok<T>(value: T): Ok<T> {
  return new Ok(value)
}

export function err<E>(error: E): Err<E> {
  return new Err(error)
}

export async function tryCatch<T, E = Error>(
  promise: Promise<T>,
): Promise<Ok<T> | Err<E>> {
  try {
    const data = await promise;
    return ok(data);
  } catch (error) {
    return err(error as E);
  }
}

export function syncTryCatch<T, E = Error>(
  fn: () => T,
): Ok<T> | Err<E> {
  try {
    const data = fn();
    return ok(data);
  } catch (error) {
    return err(error as E);
  }
}
