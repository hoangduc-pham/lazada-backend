require("dotenv").config();
const express = require("express");
const axios = require("axios");
const crypto = require("crypto");

const app = express();

const LAZADA_APP_KEY = process.env.LAZADA_APP_KEY;
const LAZADA_APP_SECRET = process.env.LAZADA_APP_SECRET;
const LAZADA_AUTH_API = "https://auth.lazada.com/rest";
const LAZADA_API_URL = "https://api.lazada.vn/rest";

// Hàm ký request Lazada
function signLazada(path, params) {
  const keys = Object.keys(params).sort();
  let str = path;
  keys.forEach((k) => {
    str += k + params[k];
  });
  return crypto
    .createHmac("sha256", LAZADA_APP_SECRET)
    .update(str)
    .digest("hex")
    .toUpperCase();
}

app.get("/", (req, res) => {
  res.send("Lazada backend OK");
});

// CALLBACK URL cho Lazada
app.get("/lazada/callback", async (req, res) => {
  const { code, state } = req.query;
  if (!code) return res.status(400).send("Missing code");

  console.log("Received code from Lazada:", code, "state:", state);

  // Gọi Lazada để đổi code lấy access_token (sau này dùng quản lý đơn)
  try {
    const path = "/auth/token/create";
    const params = {
      app_key: LAZADA_APP_KEY,
      code,
      sign_method: "sha256",
      timestamp: Date.now(),
    };
    params.sign = signLazada(path, params);

    const response = await axios.get(`${LAZADA_AUTH_API}${path}`, { params });
    const data = response.data;

    console.log("Lazada token response:", data);
    // TODO: lưu data.access_token, data.refresh_token vào DB

    res.send("Lazada connected successfully, check server log.");
  } catch (e) {
    console.error(e.response?.data || e.message);
    res.status(500).send("Error when getting Lazada token");
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});

const ACCESS_TOKEN =
  "50000101941fBVesqc8BeqAqz0eihPKzjtX9i58QOfywXpPRYEHh612f72370stq";

app.get("/products", async (req, res) => {
  try {
    const path = "/products/get";
    const params = {
      app_key: LAZADA_APP_KEY,
      access_token: ACCESS_TOKEN,
      sign_method: "sha256",
      timestamp: Date.now(),
      filter: "all",
      offset: 0,
      limit: 50,
    };
    params.sign = signLazada(path, params);

    const response = await axios.get(`${LAZADA_API_URL}${path}`, { params });
    // Lazada trả về { code: '0', data: { products: [...] }, request_id: ... }
    res.json(response.data);
  } catch (e) {
    console.error(e.response?.data || e.message);
    res.status(500).json(e.response?.data || { message: e.message });
  }
});

app.get("/shop", async (req, res) => {
  try {
    const path = "/seller/get";
    const params = {
      app_key: LAZADA_APP_KEY,
      access_token: ACCESS_TOKEN, // token đang dùng
      sign_method: "sha256",
      timestamp: Date.now(),
    };
    params.sign = signLazada(path, params);

    const response = await axios.get(`https://api.lazada.vn/rest${path}`, {
      params,
    });
    // Trong response.data.data.name là tên shop [web:82]
    res.json(response.data);
  } catch (e) {
    console.error(e.response?.data || e.message);
    res.status(500).json(e.response?.data || { message: e.message });
  }
});

// GET /product-item?item_id=123456789
app.get("/product-item", async (req, res) => {
  const { item_id } = req.query;
  if (!item_id) {
    return res.status(400).json({ message: "Missing item_id" });
  }

  try {
    const path = "/product/item/get";
    const params = {
      app_key: LAZADA_APP_KEY,
      access_token: ACCESS_TOKEN,
      sign_method: "sha256",
      timestamp: Date.now(),
      item_id, // tham số bắt buộc [web:71]
      // seller_sku đã deprecated, docs khuyên dùng item_id [web:71]
    };
    params.sign = signLazada(path, params);

    const response = await axios.get(`${LAZADA_API_URL}${path}`, { params });
    // Trả về toàn bộ JSON Lazada
    res.json(response.data);
  } catch (e) {
    console.error(e.response?.data || e.message);
    res.status(500).json(e.response?.data || { message: e.message });
  }
});

// GET /payout-status?created_after=2025-01-01T00:00:00
app.get("/payout-status", async (req, res) => {
  const { created_after } = req.query;

  // Tham số này là bắt buộc theo docs [web:62]
  if (!created_after) {
    return res.status(400).json({
      message: "Missing created_after (format YYYY-MM-DDThh:mm:ss)",
    });
  }

  try {
    const path = "/finance/payout/status/get";
    const params = {
      app_key: LAZADA_APP_KEY,
      access_token: ACCESS_TOKEN,
      sign_method: "sha256",
      timestamp: Date.now(),
      created_after, // filter statement tạo sau thời điểm này [web:62]
    };
    params.sign = signLazada(path, params);

    const response = await axios.get(`${LAZADA_API_URL}${path}`, { params });
    // Trả nguyên JSON từ Lazada: code, data (các payout), request_id...
    res.json(response.data);
  } catch (e) {
    console.error(e.response?.data || e.message);
    res.status(500).json(e.response?.data || { message: e.message });
  }
});
