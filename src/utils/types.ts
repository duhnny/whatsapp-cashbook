export type AsyncReturn<T extends (arg0: any) => Promise<any>> = Awaited<ReturnType<T>>;

export function omitKeys<T extends object, K extends keyof T>(obj: T, chaves: K[]): Omit<T, K> {
  const chavesParaRemover = new Set(chaves);
  
  // Filtra as entradas do objeto e reconstrói um novo objeto
  return Object.fromEntries(
    Object.entries(obj).filter(([chave]) => !chavesParaRemover.has(chave as K))
  ) as Omit<T, K>;
}
