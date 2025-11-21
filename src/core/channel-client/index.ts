import {
  CHANNEL_AUTH_ID,
  CHANEL_CONTRACT_ID,
  NETWORK_CONFIG,
  CHANNEL_ASSET,
} from "../../config/env.ts";
import { PrivacyChannel } from "@moonlight/moonlight-sdk";

export const CHANNEL_CLIENT = new PrivacyChannel(
  NETWORK_CONFIG,
  CHANEL_CONTRACT_ID,
  CHANNEL_AUTH_ID,
  CHANNEL_ASSET.contractId
);
