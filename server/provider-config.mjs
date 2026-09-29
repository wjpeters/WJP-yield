import { z } from "zod";
import { adaptersInfo, alpacaFeeds } from "./domain.mjs";
export const providerSchema = z.object({
  type: z.enum(adaptersInfo.map((a) => a.type)),
  name: z.string().trim().min(1).max(48),
  priority: z.number().int().min(1).max(1000),
  enabled: z.boolean(),
  rpm: z.number().int().min(1).max(6000),
  apiKey: z.string().trim().max(512).optional(),
  apiSecret: z.string().trim().max(512).optional(),
  clearKey: z.boolean().optional(),
  feed: z.enum(alpacaFeeds.map((f) => f.value)).optional(),
});
export function configureProvider(input, old, store) {
  const { apiKey, apiSecret, clearKey, feed, ...body } =
    providerSchema.parse(input);
  const fail = (message) => {
    const e = new Error(message);
    e.statusCode = 400;
    throw e;
  };
  if (old && old.type !== body.type)
    fail("Adaptertype kan niet worden gewijzigd");
  let secret = old?.secret;
  if (body.type === "alpaca") {
    if (!!apiKey !== !!apiSecret)
      fail(
        "Vul API Key ID en Secret Key samen in, of laat beide leeg om de opgeslagen sleutels te behouden",
      );
    if (clearKey && (apiKey || apiSecret))
      fail("Kies sleutels vervangen of verwijderen");
    if (apiKey && apiSecret)
      secret = store.encrypt(
        JSON.stringify({ key: apiKey, secret: apiSecret }),
      );
    if (clearKey) secret = undefined;
    if (body.enabled && !secret)
      fail("Voeg eerst beide Alpaca-sleutels toe of schakel de bron uit");
  } else {
    if (apiSecret || feed)
      fail("Deze adapter ondersteunt geen tweede sleutel of Alpaca-feed");
    if (clearKey) secret = undefined;
    else if (apiKey) secret = store.encrypt(apiKey);
  }
  return {
    ...old,
    ...body,
    id: old?.id ?? store.id(),
    secret,
    ...(body.type === "alpaca" ? { feed: feed ?? old?.feed ?? "iex" } : {}),
  };
}
