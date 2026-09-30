import { DatabaseSync } from "node:sqlite";
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";
import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  randomUUID,
} from "node:crypto";
import { catalog } from "./domain.mjs";
export function createStore(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const keyPath = join(dir, "master.key");
  if (!existsSync(keyPath))
    writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: "wx" });
  const key = readFileSync(keyPath);
  const db = new DatabaseSync(join(dir, "yield.sqlite"));
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, value TEXT NOT NULL);",
  );
  chmodSync(join(dir, "yield.sqlite"), 0o600);
  const get = (id, fallback) => {
    const row = db.prepare("SELECT value FROM settings WHERE id=?").get(id);
    return row ? JSON.parse(row.value) : fallback;
  };
  const put = (id, value) =>
    db
      .prepare(
        "INSERT INTO settings VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      )
      .run(id, JSON.stringify(value));
  const encrypt = (value) => {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([c.update(value, "utf8"), c.final()]);
    return [iv, c.getAuthTag(), encrypted]
      .map((b) => b.toString("base64"))
      .join(".");
  };
  const decrypt = (value) => {
    if (!value) return "";
    const [iv, tag, data] = value
      .split(".")
      .map((v) => Buffer.from(v, "base64"));
    const c = createDecipheriv("aes-256-gcm", key, iv);
    c.setAuthTag(tag);
    return Buffer.concat([c.update(data), c.final()]).toString("utf8");
  };
  if (!get("providers", null))
    put("providers", [
      {
        id: "kraken",
        type: "kraken",
        name: "Kraken",
        priority: 10,
        enabled: true,
        rpm: 60,
      },
      {
        id: "coinbase",
        type: "coinbase",
        name: "Coinbase",
        priority: 20,
        enabled: true,
        rpm: 60,
      },
      {
        id: "twelve",
        type: "twelve",
        name: "Twelve Data",
        priority: 30,
        enabled: false,
        rpm: 8,
      },
    ]);
  if (!get("watchlists", null))
    put("watchlists", [
      {
        id: "default",
        name: "Mijn markten",
        instruments: catalog
          .filter((i) =>
            [
              "BTC/USD",
              "ETH/USD",
              "SOL/USD",
              "AAPL",
              "MSFT",
              "XAU/USD",
            ].includes(i.symbol),
          )
          .map((i) => i.id),
      },
    ]);
  // One-time, non-destructive migration. A deliberately removed provider stays removed.
  if (!get("migration:alpaca-v1", false)) {
    const providers = get("providers", []);
    if (!providers.some((p) => p.type === "alpaca") && providers.length < 20)
      put("providers", [
        ...providers,
        {
          id: randomUUID(),
          type: "alpaca",
          name: "Alpaca",
          priority: 40,
          enabled: false,
          rpm: 120,
          feed: "iex",
        },
      ]);
    put("migration:alpaca-v1", true);
  }
  if (!get("migration:okx-v1", false)) {
    const providers = get("providers", []);
    if (!providers.some((p) => p.type === "okx") && providers.length < 20)
      put("providers", [
        ...providers,
        {
          id: randomUUID(),
          type: "okx",
          name: "OKX",
          priority: 50,
          enabled: true,
          rpm: 60,
        },
      ]);
    put("migration:okx-v1", true);
  }
  if (!get("migration:okx-spot-pairs-v1", false)) {
    const lists = get("watchlists", []);
    if (lists.length < 20 && get("providers", []).some((p) => p.type === "okx"))
      put("watchlists", [
        ...lists,
        {
          id: randomUUID(),
          name: "OKX spot",
          instruments: ["BTC", "ETH", "SOL"].flatMap((base) =>
            ["EUR", "USDC"].map((currency) => `crypto:${base}:${currency}`),
          ),
        },
      ]);
    put("migration:okx-spot-pairs-v1", true);
  }
  return {
    db,
    get,
    put,
    encrypt,
    decrypt,
    id: randomUUID,
    providers: () => get("providers", []),
    instruments: () =>
      [
        ...new Map(
          [
            ...catalog,
            ...get("instruments", []),
            ...get("discovered-instruments", []),
          ].map((i) => [i.id, i]),
        ).values(),
      ].map((i) => ({
        ...i,
        mappings: {
          ...i.mappings,
          ...(!i.catalogSources &&
          ["stock", "etf"].includes(i.assetClass) &&
          i.currency === "USD" &&
          ["NASDAQ", "NYSE", "NYSEARCA", "AMEX", "ARCA", "BATS"].includes(
            i.exchange.toUpperCase(),
          )
            ? { alpaca: i.symbol }
            : {}),
        },
      })),
    watchlists: () => get("watchlists", []),
    publicProvider: (p) => {
      const { secret, ...safe } = p;
      return { ...safe, hasKey: !!secret };
    },
  };
}
