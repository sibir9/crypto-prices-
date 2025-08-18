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

// USDT адрес в сети Polygon
const USDT = "0xc2132d05d31c914a87c6611c10748aeb04b58e8f";

// ODOS chainId для Polygon
const CHAIN_ID = 137;

// --- Вспомогательная функция: получить decimals токена из ODOS ---
async function getDecimals(address) {
  const url = `https://api.odos.xyz/info/token/${CHAIN_ID}/${address}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    return data.decimals || 18; // если нет данных — по умолчанию 18
  } catch {
    return 18;
  }
}

// --- Получаем реальный курс через sor/quote/v2 ---
async function getOdosPrice(token) {
  try {
    const decimals = await getDecimals(token.address);

    // amount = 1 * 10^decimals
    const amount = BigInt(10) ** BigInt(decimals);

    const body = {
      chainId: CHAIN_ID,
      inputTokens: [
        {
          tokenAddress: token.address,
          amount: amount.toString()
        }
      ],
      outputTokens: [
        {
          tokenAddress: USDT,
          proportion: 1
        }
      ]
    };

    const res = await fetch("https://api.odos.xyz/sor/quote/v2", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const data = await res.json();

    const out = data.outputTokens?.find(
      (o) => o.tokenAddress.toLowerCase() === USDT.toLowerCase()
    );

    if (!out) return null;

    // amountOut в формате smallest unit (6 знаков у USDT)
    const price = Number(out.amount) / 10 ** 6; // USDT = 6 decimals
    return price;
  } catch (e) {
    console.error(`ODOS error for ${token.symbol}:`, e);
    return null;
  }
}

// --- Получаем цену с MEXC ---
async function getMexcPrice(token) {
  const pair = `${token.symbol}USDT`;
  try {
    const res = await fetch(
      `https://api.mexc.com/api/v3/ticker/price?symbol=${pair}`
    );
    const data = await res.json();
    return data.price ? parseFloat(data.price) : null;
  } catch {
    return null;
  }
}

// --- API /prices ---
app.get("/prices", async (req, res) => {
  try {
    const odosPrices = {};
    const mexcPrices = {};

    for (const token of TOKENS) {
      odosPrices[token.symbol] = await getOdosPrice(token);
      mexcPrices[token.symbol] = await getMexcPrice(token);
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
