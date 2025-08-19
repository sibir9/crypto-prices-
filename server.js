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

// Комиссии
const ODOS_FEE = 0.002; // 0.2%
const MEXC_FEE = 0.001; // 0.1%

// --- Вспомогательная функция для средней цены покупки в стакане ---
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
  return { avgPrice: usdtAmount / totalTokens, tokensBought: totalTokens };
}

app.get("/prices", async (req, res) => {
  try {
    const scenario1 = {}; // ODOS -> MEXC
    const scenario2 = {}; // MEXC -> ODOS

    for (const token of TOKENS) {
      // --- Сценарий 1: ODOS → MEXC ---
      let tokensBought1 = null;
      let odosPrice1 = null;
      let mexcPrice1 = null;
      let profit1 = null;
      let spread1 = null;

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
          tokensBought1 = Number(out) / 1e18;
          odosPrice1 = effectiveUSDT / tokensBought1;
        }
      } catch {}

      try {
        const depthRes = await fetch(`https://api.mexc.com/api/v3/depth?symbol=${token.symbol}USDT&limit=50`);
        const depthData = await depthRes.json();
        const bids = depthData.bids;

        if (bids && bids.length > 0 && tokensBought1) {
          let remainingTokens = tokensBought1;
          let totalUSDT = 0;

          for (const [priceStr, qtyStr] of bids) {
            const price = parseFloat(priceStr);
            const qty = parseFloat(qtyStr);

            if (remainingTokens >= qty) {
              totalUSDT += price * qty;
              remainingTokens -= qty;
            } else {
              totalUSDT += price * remainingTokens;
              remainingTokens = 0;
              break;
            }
          }

          const usdtAfterFee = totalUSDT * (1 - MEXC_FEE);
          mexcPrice1 = totalUSDT / tokensBought1;
          profit1 = usdtAfterFee - 50;
        }
      } catch {}

      if (odosPrice1 && mexcPrice1) {
        spread1 = ((mexcPrice1 - odosPrice1) / odosPrice1) * 100;
      }

      scenario1[token.symbol] = {
        odosPrice: odosPrice1,
        mexcPrice: mexcPrice1,
        profit: profit1,
        spread: spread1
      };

      // --- Сценарий 2: MEXC → ODOS ---
      let tokensBought2 = null;
      let mexcPrice2 = null;
      let odosPrice2 = null;
      let profit2 = null;
      let spread2 = null;

      try {
        const depthRes = await fetch(`https://api.mexc.com/api/v3/depth?symbol=${token.symbol}USDT&limit=50`);
        const depthData = await depthRes.json();
        const asks = depthData.asks;

        if (asks && asks.length > 0) {
          const { avgPrice, tokensBought } = calcAvgPrice(asks, 50 * (1 - MEXC_FEE)) || {};
          if (avgPrice) {
            mexcPrice2 = avgPrice;
            tokensBought2 = tokensBought;
          }
        }
      } catch {}

      try {
        if (tokensBought2) {
          const odosRes = await fetch("https://api.odos.xyz/sor/quote/v2", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chainId: CHAIN_ID,
              inputTokens: [{ tokenAddress: token.address, amount: String(tokensBought2 * 1e18) }],
              outputTokens: [{ tokenAddress: USDT }],
              slippageLimitPercent: 1
            })
          });

          const odosData = await odosRes.json();
          const out = odosData.outAmounts?.[0];
          if (out) {
            const usdtOut = Number(out) / 1e6;
            const usdtAfterFee = usdtOut * (1 - ODOS_FEE);
            odosPrice2 = usdtOut / tokensBought2;
            profit2 = usdtAfterFee - 50;
          }
        }
      } catch {}

      if (mexcPrice2 && odosPrice2) {
        spread2 = ((odosPrice2 - mexcPrice2) / mexcPrice2) * 100;
      }

      scenario2[token.symbol] = {
        mexcPrice: mexcPrice2,
        odosPrice: odosPrice2,
        profit: profit2,
        spread: spread2
      };
    }

    res.json({ scenario1, scenario2 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка при получении цен" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
