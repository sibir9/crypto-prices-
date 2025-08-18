import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3000;

// Раздаём статику из папки public
app.use(express.static("public"));

// Наши токены
const TOKENS = [
  { symbol: "NAKA", address: "0x311434160d7537be358930def317afb606c0d737" },
  { symbol: "SAND", address: "0xbbba073c31bf03b8acf7c28ef0738decf3695683" },
  { symbol: "NWS",  address: "0x13646e0e2d768d31b75d1a1e375e3e17f18567f2" }
];

// USDT адрес на Polygon
const USDT = "0xc2132d05d31c914a87c6611c10748aeb04b58e8f";

// ODOS chainId для Polygon
const CHAIN_ID = 137;

// Получаем цену токена через ODOS sor/quote/v2
async function getOdosPrice(token) {
  try {
    const body = {
      chainId: CHAIN_ID,
      inputTokens: [{ tokenAddress: token.address, amount: "1000000000000000000" }], // 1 токен (1e18 wei)
      outputTokens: [{ tokenAddress: USDT }],
      slippageLimitPercent: 1
    };

    const res = await fetch("https://api.odos.xyz/sor/quote/v2", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const data = await res.json();
    const out = data.outAmounts?.[0];
    if (!out) return null;

    return Number(out) / 1e6; // USDT = 6 decimals
  } catch (e) {
    console.error(`Ошибка ODOS для ${token.symbol}:`, e);
    return null;
  }
}

// Получаем цену с MEXC
async function getMexcPrice(token) {
  const pair = `${token.symbol}USDT`;
  try {
    const res = await fetch(`https://api.mexc.com/api/v3/ticker/price?symbol=${pair}`);
    const data = await res.json();
    return data.price ? parseFloat(data.price) : null;
  } catch {
    return null;
  }
}

// API /prices
app.get("/prices", async (req, res) => {
  try {
    const odosPrices = {};
    const mexcPrices = {};
    const spreads = {};

    for (const token of TOKENS) {
      odosPrices[token.symbol] = await getOdosPrice(token);
      mexcPrices[token.symbol] = await getMexcPrice(token);

      const odos = odosPrices[token.symbol];
      const mexc = mexcPrices[token.symbol];

      if (odos !== null && mexc !== null) {
        spreads[token.symbol] = ((odos - mexc) / mexc) * 100;
      } else {
        spreads[token.symbol] = null;
      }
    }

    res.json({ odos: odosPrices, mexc: mexcPrices, spread: spreads });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка при получении цен" });
  }
});

