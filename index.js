require("dotenv").config();
const express = require("express");
const axios = require("axios");
const crypto = require("crypto");

const app = express();

const LAZADA_APP_KEY = process.env.LAZADA_APP_KEY;
const LAZADA_APP_SECRET = process.env.LAZADA_APP_SECRET;
const LAZADA_AUTH_API = "https://auth.lazada.com/rest";
const LAZADA_API_URL = "https://api.lazada.vn/rest";
const fs = require("fs");
const pathToken = "./token.json";

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
    const now = Date.now();
    const tokenToSave = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      // expires_in, refresh_expires_in là số giây Lazada trả về
      expires_at: now + data.expires_in * 1000,
      refresh_expires_at: now + data.refresh_expires_in * 1000,
    };

    fs.writeFileSync(pathToken, JSON.stringify(tokenToSave, null, 2));

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

function getAccessTokenFromFile() {
  const raw = fs.readFileSync(pathToken, "utf8");
  const token = JSON.parse(raw);
  return token.access_token;
}

app.get("/products", async (req, res) => {
  try {
    const path = "/products/get";
    const params = {
      app_key: LAZADA_APP_KEY,
      access_token: getAccessTokenFromFile(),
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
      access_token: getAccessTokenFromFile(),
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
      access_token: getAccessTokenFromFile(),
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
      access_token: getAccessTokenFromFile(),
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

// GET /seller-performance?language=vi-VN (mặc định en-US)
app.get("/seller-performance", async (req, res) => {
  // 1. Lấy tham số language từ query, mặc định là en-US
  // Các ngôn ngữ hỗ trợ theo tài liệu: en-US, zh-CN, ms-MY, th-TH, vi-VN, id-ID
  const { language } = req.query;

  try {
    const path = "/seller/performance/get";

    // 2. Chuẩn bị tham số gọi Lazada
    const params = {
      app_key: LAZADA_APP_KEY,
      access_token: getAccessTokenFromFile(),
      sign_method: "sha256",
      timestamp: Date.now(),
      // language là tham số tùy chọn (Optional)
      ...(language && { language }),
    };

    // 3. Ký request
    params.sign = signLazada(path, params);

    // 4. Gọi API Lazada
    const response = await axios.get(`${LAZADA_API_URL}${path}`, { params });

    // 5. Trả về kết quả JSON cho Client (Flutter App)
    // Response sẽ chứa data.indicators (các chỉ số)
    res.json(response.data);
  } catch (e) {
    console.error(e.response?.data || e.message);
    res.status(500).json(e.response?.data || { message: e.message });
  }
});

// GET /warehouse
app.get("/warehouse", async (req, res) => {
  try {
    const path = "/rc/warehouse/get";

    // 1. Chuẩn bị tham số
    const params = {
      app_key: LAZADA_APP_KEY,
      access_token: getAccessTokenFromFile(),
      sign_method: "sha256",
      timestamp: Date.now(),
      // API này không yêu cầu tham số nào khác ngoài auth
    };

    // 2. Ký request
    params.sign = signLazada(path, params);

    // 3. Gọi API Lazada
    const response = await axios.get(`${LAZADA_API_URL}${path}`, { params });

    // 4. Trả về kết quả
    // Cấu trúc trả về thường là response.data.result.module (chứa list kho)
    res.json(response.data);
  } catch (e) {
    console.error(e.response?.data || e.message);
    res.status(500).json(e.response?.data || { message: e.message });
  }
});

// GET /warehouse-detail
app.get("/warehouse-detail", async (req, res) => {
  try {
    const path = "/rc/warehouse/detail/get";

    // 1. Chuẩn bị tham số
    const params = {
      app_key: LAZADA_APP_KEY,
      access_token: getAccessTokenFromFile(),
      sign_method: "sha256",
      timestamp: Date.now(),
      // API này không cần thêm tham số khác
    };

    // 2. Ký request
    params.sign = signLazada(path, params);

    // 3. Gọi API Lazada
    const response = await axios.get(`${LAZADA_API_URL}${path}`, { params });

    // 4. Trả về kết quả
    // Cấu trúc response: response.data.result.module
    res.json(response.data);
  } catch (e) {
    console.error(e.response?.data || e.message);
    res.status(500).json(e.response?.data || { message: e.message });
  }
});

// GET /seller-notifications?page=1&pageSize=10&language=vi
app.get("/seller-notifications", async (req, res) => {
  const { page, pageSize, language } = req.query;

  try {
    const path = "/sellercenter/msg/list";

    // 1. Chuẩn bị tham số
    const params = {
      app_key: LAZADA_APP_KEY,
      access_token: getAccessTokenFromFile(),
      sign_method: "sha256",
      timestamp: Date.now(),
      // Các tham số tùy chọn (Optional Parameters)
      page: page || "1", // Mặc định trang 1
      pageSize: pageSize || "20", // Mặc định 20 tin/trang
      language: language || "vi", // Mặc định tiếng Việt (vi/en/id...)
    };

    // 2. Ký request
    params.sign = signLazada(path, params);

    // 3. Gọi API Lazada
    const response = await axios.get(`${LAZADA_API_URL}${path}`, { params });

    // 4. Trả về kết quả
    // Dữ liệu chính nằm trong: response.data.result.data.dataSource
    res.json(response.data);
  } catch (e) {
    console.error(e.response?.data || e.message);
    res.status(500).json(e.response?.data || { message: e.message });
  }
});

// ví dụ trong index.js
// app.use(express.json());

// app.post("/login", async (req, res) => {
//   const { email, password } = req.body;
//   // TODO: kiểm tra trong DB; hiện có thể mock:
//   if (email === "test@example.com" && password === "123456") {
//     return res.json({
//       user: { id: "1", email },
//       token: "dummy-jwt-or-session",
//     });
//   }
//   return res.status(401).json({ message: "Email hoặc mật khẩu không đúng" });
// });
