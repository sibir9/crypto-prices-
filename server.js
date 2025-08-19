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

const CHAIN_ID = 137;
const USDT = "0xc2132d05d31c914a87c6611c10748aeb04b58e8f";

const ODOS_FEE = 0.002; // 0.2%
const MEXC_FEE = 0.001; // 0.1%

// ========== Вспомогательные функции ==========
function calcAvgPrice(orders, usdtAmount) {
  let remainingUSDT = usdtAmount;
  let totalTokens = 0;

  for (const [priceStr, qtyStr] of orders) {
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
  return { avgPrice: usdtAmount / totalTokens, tokens: totalTokens };
}

// ========== ODOS → MEXC ==========
app.get("/prices-odos-mexc", async (req, res) => {
  try {
    const odosPrices = {};
    const mexcPrices = {};
    const spread = {};
    const profit = {};

    for (const token of TOKENS) {
      let tokensBought = null;

      // ODOS покупка на 50 USDT
      try {
        const effectiveUSDT = 50 * (1 - ODOS_FEE);
        const odosRes = await fetch("https://api.odos.xyz/sor/quote/v2", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chainId: CHAIN_ID,
            inputTokens: [{ tokenAddress: USDT, amount: String(effectiveUSDT * 1e6) }],
            outputTokens: [{ tokenAddress: token.address }],
            slippageLimitPercent: 1
          })
        });
        const odosData = await odosRes.json();
        const out = odosData.outAmounts?.[0];
        if (out) {
          tokensBought = Number(out) / 1e18;
          odosPrices[token.symbol] = effectiveUSDT / tokensBought;
        } else {
          odosPrices[token.symbol] = null;
        }
      } catch {
        odosPrices[token.symbol] = null;
      }

      // MEXC продажа
      try {
        const depthRes = await fetch(`https://api.mexc.com/api/v3/depth?symbol=${token.symbol}USDT&limit=50`);
        const depthData = await depthRes.json();
        const bids = depthData.bids;

        if (bids && tokensBought) {
          let remaining = tokensBought;
          let totalUSDT = 0;

          for (const [priceStr, qtyStr] of bids) {
            const price = parseFloat(priceStr);
            const qty = parseFloat(qtyStr);

            if (remaining >= qty) {
              totalUSDT += price * qty;
              remaining -= qty;
            } else {
              totalUSDT += price * remaining;
              remaining = 0;
              break;
            }
          }

          if (remaining === 0) {
            const usdtAfterFee = totalUSDT * (1 - MEXC_FEE);
            mexcPrices[token.symbol] = totalUSDT / tokensBought;
            profit[token.symbol] = usdtAfterFee - 50;
          }
        }
      } catch {
        mexcPrices[token.symbol] = null;
        profit[token.symbol] = null;
      }

      if (odosPrices[token.symbol] && mexcPrices[token.symbol]) {
        spread[token.symbol] = ((mexcPrices[token.symbol] - odosPrices[token.symbol]) / odosPrices[token.symbol]) * 100;
      }
    }

    res.json({ odos: odosPrices, mexc: mexcPrices, spread, profit });
  } catch (e) {
    res.status(500).json({ error: "Ошибка ODOS → MEXC" });
  }
});

// ========== MEXC → ODOS ==========
app.get("/prices-mexc-odos", async (req, res) => {
  try {
    const mexcPrices = {};
    const odosPrices = {};
    const spread = {};
    const profit = {};

    for (const token of TOKENS) {
      let tokensBought = null;

      // MEXC покупка
      try {
        const depthRes = await fetch(`https://api.mexc.com/api/v3/depth?symbol=${token.symbol}USDT&limit=50`);
        const depthData = await depthRes.json();
        const asks = depthData.asks;

        if (asks) {
          const result = calcAvgPrice(asks, 50);
          if (result) {
            tokensBought = result.tokens * (1 - MEXC_FEE);
            mexcPrices[token.symbol] = result.avgPrice;
          }
        }
      } catch {
        mexcPrices[token.symbol] = null;
      }

      // ODOS продажа
      if (tokensBought) {
        try {
          const odosRes = await fetch("https://api.odos.xyz/sor/quote/v2", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chainId: CHAIN_ID,
              inputTokens: [{ tokenAddress: token.address, amount: String(tokensBought * 1e18) }],
              outputTokens: [{ tokenAddress: USDT }],
              slippageLimitPercent: 1
            })
          });
          const odosData = await odosRes.json();
          const out = odosData.outAmounts?.[0];
          if (out) {
            const usdtReceived = (Number(out) / 1e6) * (1 - ODOS_FEE);
            odosPrices[token.symbol] = usdtReceived / tokensBought;
            profit[token.symbol] = usdtReceived - 50;
          }
        } catch {
          odosPrices[token.symbol] = null;
          profit[token.symbol] = null;
        }
      }

      if (odosPrices[token.symbol] && mexcPrices[token.symbol]) {
        spread[token.symbol] = ((odosPrices[token.symbol] - mexcPrices[token.symbol]) / mexcPrices[token.symbol]) * 100;
      }
    }

    res.json({ mexc: mexcPrices, odos: odosPrices, spread, profit });
  } catch (e) {
    res.status(500).json({ error: "Ошибка MEXC → ODOS" });
  }
});

app.listen(PORT, () => console.log(`Server running on ${PORT}`));
