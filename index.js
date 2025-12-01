require('dotenv').config();
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');


const app = express();

const LAZADA_APP_KEY = process.env.LAZADA_APP_KEY;
const LAZADA_APP_SECRET = process.env.LAZADA_APP_SECRET;
const LAZADA_AUTH_API = 'https://auth.lazada.com/rest';

// Hàm ký request Lazada
function signLazada(path, params) {
  const keys = Object.keys(params).sort();
  let str = path;
  keys.forEach(k => {
    str += k + params[k];
  });
  return crypto
    .createHmac('sha256', LAZADA_APP_SECRET)
    .update(str)
    .digest('hex')
    .toUpperCase();
}

app.get('/', (req, res) => {
  res.send('Lazada backend OK');
});

// CALLBACK URL cho Lazada
app.get('/lazada/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code) return res.status(400).send('Missing code');

  console.log('Received code from Lazada:', code, 'state:', state);

  // Gọi Lazada để đổi code lấy access_token (sau này dùng quản lý đơn)
  try {
    const path = '/auth/token/create';
    const params = {
      app_key: LAZADA_APP_KEY,
      code,
      sign_method: 'sha256',
      timestamp: Date.now()
    };
    params.sign = signLazada(path, params);

    const response = await axios.get(`${LAZADA_AUTH_API}${path}`, { params });
    const data = response.data;

    console.log('Lazada token response:', data);
    // TODO: lưu data.access_token, data.refresh_token vào DB

    res.send('Lazada connected successfully, check server log.');
  } catch (e) {
    console.error(e.response?.data || e.message);
    res.status(500).send('Error when getting Lazada token');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Server running on port', PORT);
});
