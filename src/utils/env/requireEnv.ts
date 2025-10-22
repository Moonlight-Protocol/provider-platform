import { load } from "dotenv";

const env = await load(); // Reads from .env file

export default function (key: string): string {
  const value = env[key as keyof typeof env];

  if (value === undefined) {
    const denoVal = Deno.env.get(key);

    if (denoVal === undefined) {
      throw new Error(`${key} is not loaded`);
    }
    return denoVal;
  }
  return value;
}
