import type { SuccessStatus } from "../schema/default.schema.ts";
import type { ResponseData, WithContext } from "../types.ts";

export type SuccessResponseInput<DATA> = WithContext<ResponseData<DATA>> & {
  status: SuccessStatus;
  message?: string;
};
