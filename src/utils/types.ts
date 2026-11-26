export type AsyncReturn<T extends (arg0: any) => Promise<any>> = Awaited<ReturnType<T>>;
