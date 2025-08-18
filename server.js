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
  { symbol: "NWS", address: "0x13646e0e2d768d31b75d1a1e375e3e17f18567f2" }
];

// USDT (Polygon)
const USDT = "0xc2132d05d31c914a87c6611c10748aeb04b58e8f";

// ODOS chainId для Polygon
const CHAIN_ID = 137;

// API route для цен
app.get("/prices", async (req, res) => {
  try {
    const odosPrices = {};
    const mexcPrices = {};

    // Запросы к ODOS (через sor/quote/v2)
    for (const token of TOKENS) {
      try {
        const odosUrl = `https://api.odos.xyz/sor/quote/v2`;
        const body = {
          chainId: CHAIN_ID,
          inputTokens: [
            {
              tokenAddress: token.address,
              amount: "1000000000000000000" // 1 токен (в wei, для ERC20 с 18 decimals)
            }
          ],
          outputTokens: [
            {
              tokenAddress: USDT,
              proportion: 1
            }
          ]
        };

        const odosRes = await fetch(odosUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });

        const odosData = await odosRes.json();

        if (odosData.outputTokens && odosData.outputTokens.length > 0) {
          const amountOut = odosData.outputTokens[0].amount;
          // USDT тоже с 6 decimals → делим на 1e6
          const price = parseFloat(amountOut) / 1e6;
          odosPrices[token.symbol] = price;
        } else {
          odosPrices[token.symbol] = null;
        }
      } catch (err) {
        console.error(`ODOS error for ${token.symbol}:`, err);
        odosPrices[token.symbol] = null;
      }
    }

    // Запросы к MEXC (спот API)
    for (const token of TOKENS) {
      const pair = `${token.symbol}USDT`;
      try {
        const mexcUrl = `https://api.mexc.com/api/v3/ticker/price?symbol=${pair}`;
        const mexcRes = await fetch(mexcUrl);
        const mexcData = await mexcRes.json();

        mexcPrices[token.symbol] = mexcData.price ? parseFloat(mexcData.price) : null;
      } catch {
        mexcPrices[token.symbol] = null;
      }
    }

    res.json({ odos: odosPrices, mexc: mexcPrices });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка при получении цен" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
