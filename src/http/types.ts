import { Context } from "@oak/oak";

export type ContextWith<T, TKey extends string> = {
  ctx: Context;
} & Record<TKey, T>;
