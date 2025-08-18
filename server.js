import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3000;

// Раздаём статику из папки public
app.use(express.static("public"));

// Токены
const TOKENS = [
  { symbol: "NAKA", address: "0x311434160d7537be358930def317afb606c0d737" },
  { symbol: "SAND", address: "0xbbba073c31bf03b8acf7c28ef0738decf3695683" },
  { symbol: "NWS",  address: "0x13646e0e2d768d31b75d1a1e375e3e17f18567f2" }
];

const CHAIN_ID = 137; // Polygon
const USDT = "0xc2132d05d31c914a87c6611c10748aeb04b58e8f"; // USDT на Polygon

app.get("/prices", async (req, res) => {
  try {
    const odosPrices = {};
    const mexcPrices = {};
    const spread = {};

    // Получаем ODOS цены
    for (const token of TOKENS) {
      try {
        const odosRes = await fetch("https://api.odos.xyz/sor/quote/v2", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chainId: CHAIN_ID,
            inputTokens: [{ tokenAddress: token.address, amount: "1000000000000000000" }],
            outputTokens: [{ tokenAddress: USDT }],
            slippageLimitPercent: 1
          })
        });
        const odosData = await odosRes.json();
        odosPrices[token.symbol] = odosData.outAmounts?.[0] ? Number(odosData.outAmounts[0])/1e6 : null;
      } catch {
        odosPrices[token.symbol] = null;
      }
    }

    // Получаем MEXC цены
    for (const token of TOKENS) {
      try {
        const mexcRes = await fetch(`https://api.mexc.com/api/v3/ticker/price?symbol=${token.symbol}USDT`);
        const mexcData = await mexcRes.json();
        mexcPrices[token.symbol] = mexcData.price ? Number(mexcData.price) : null;
      } catch {
        mexcPrices[token.symbol] = null;
      }
    }

    // Вычисляем спред
    for (const token of TOKENS) {
      if (odosPrices[token.symbol] !== null && mexcPrices[token.symbol] !== null) {
        spread[token.symbol] = ((odosPrices[token.symbol] - mexcPrices[token.symbol]) / mexcPrices[token.symbol]) * 100;
      } else {
        spread[token.symbol] = null;
      }
    }

    res.json({ odos: odosPrices, mexc: mexcPrices, spread });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка при получении цен" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
