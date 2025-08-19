import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

// Токены
const TOKENS = [
  { symbol: "NAKA", address: "0x311434160d7537be358930def317afb606c0d737" },
  { symbol: "SAND", address: "0xbbba073c31bf03b8acf7c28ef0738decf3695683" },
  { symbol: "NWS",  address: "0x13646e0e2d768d31b75d1a1e375e3e17f18567f2" }
];

const CHAIN_ID = 137; // Polygon
const USDT = "0xc2132d05d31c914a87c6611c10748aeb04b58e8f"; // USDT (Polygon)

// Функция: считаем среднюю цену покупки USDT объема по ордерам
function calcAvgPrice(asks, usdtAmount) {
  let remainingUSDT = usdtAmount;
  let totalTokens = 0;

  for (const [priceStr, qtyStr] of asks) {
    const price = parseFloat(priceStr);
    const qty = parseFloat(qtyStr);
    const cost = price * qty;

    if (remainingUSDT >= cost) {
      totalTokens += qty;
      remainingUSDT -= cost;
    } else {
      totalTokens += remainingUSDT / price;
      remainingUSDT = 0;
      break;
    }
  }

  if (totalTokens === 0) return null;
  return usdtAmount / totalTokens; // средняя цена покупки токена
}

app.get("/prices", async (req, res) => {
  try {
    const odosPrices = {};
    const mexcPrices = {};
    const spread = {};

    for (const token of TOKENS) {
      // === ODOS цена покупки токена на 50 USDT ===
      try {
        const odosRes = await fetch("https://api.odos.xyz/sor/quote/v2", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chainId: CHAIN_ID,
            inputTokens: [{ tokenAddress: USDT, amount: String(50 * 1e6) }], // 50 USDT (6 decimals)
            outputTokens: [{ tokenAddress: token.address }],
            slippageLimitPercent: 1
          })
        });

        const odosData = await odosRes.json();
        const out = odosData.outAmounts?.[0];
        if (out) {
          // теперь считаем цену 1 токена (50 USDT / полученные токены)
          const tokensReceived = Number(out) / 1e18;
          odosPrices[token.symbol] = 50 / tokensReceived;
        } else {
          odosPrices[token.symbol] = null;
        }
      } catch {
        odosPrices[token.symbol] = null;
      }

      // === MEXC средняя цена продажи токена на 50 USDT ===
      try {
        const depthRes = await fetch(`https://api.mexc.com/api/v3/depth?symbol=${token.symbol}USDT&limit=50`);
        const depthData = await depthRes.json();
        const asks = depthData.asks;

        if (asks && asks.length > 0) {
          mexcPrices[token.symbol] = calcAvgPrice(asks, 50);
        } else {
          mexcPrices[token.symbol] = null;
        }
      } catch {
        mexcPrices[token.symbol] = null;
      }

      // === Спред ===
      if (odosPrices[token.symbol] && mexcPrices[token.symbol]) {
        spread[token.symbol] =
          ((odosPrices[token.symbol] - mexcPrices[token.symbol]) / mexcPrices[token.symbol]) * 100;
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
