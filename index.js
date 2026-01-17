require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 5000;

// --- CONFIGURATION ---
const CREDENTIALS = {
    username: process.env.Junaidali786,
    password: process.env.Junaidali786
};

const BASE_URL = "http://51.89.99.105/NumberPanel";
const STATS_PAGE_URL = `${BASE_URL}/client/SMSCDRStats`; 

const COMMON_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 15; V2423 Build/AP3A.240905.015.A2_D1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.146 Mobile Safari/537.36",
    "X-Requested-With": "XMLHttpRequest",
    "Accept-Language": "en-PK,en-US;q=0.9,en;q=0.8"
};

let STATE = {
    cookie: null,
    sessKey: null,
    isLoggingIn: false
};

// --- HELPERS ---
function extractKey(html) {
    let match = html.match(/sesskey=([PHPSESSID=u5ur4fn3kcbtp285i6hqri3pke]+)/);
    if (match) return match[1];
    return null;
}

// --- LOGIN LOGIC ---
async function performLogin() {
    if (STATE.isLoggingIn) return;
    STATE.isLoggingIn = true;
    
    console.log("🔄 Logging in to Panel...");

    try {
        const instance = axios.create({ withCredentials: true, headers: COMMON_HEADERS });

        // 1. Get Login Page & Captcha
        const r1 = await instance.get(`${BASE_URL}/login`);
        let tempCookie = r1.headers['set-cookie']?.find(x => x.includes('PHPSESSID'))?.split(';')[0];

        const match = r1.data.match(/What is (\d+) \+ (\d+) = \?/);
        if (!match) throw new Error("Captcha not found");
        const ans = parseInt(match[1]) + parseInt(match[2]);

        // 2. Submit Login
        const params = new URLSearchParams();
        params.append('username', CREDENTIALS.username);
        params.append('password', CREDENTIALS.password);
        params.append('capt', ans);

        const r2 = await instance.post(`${BASE_URL}/signin`, params, {
            headers: { "Content-Type": "application/x-www-form-urlencoded", "Cookie": tempCookie },
            maxRedirects: 0, validateStatus: () => true
        });

        STATE.cookie = r2.headers['set-cookie']?.find(x => x.includes('PHPSESSID'))?.split(';')[0] || tempCookie;
        
        // 3. Get SessKey
        const r3 = await axios.get(STATS_PAGE_URL, {
            headers: { ...COMMON_HEADERS, "Cookie": STATE.cookie }
        });

        STATE.sessKey = extractKey(r3.data);
        console.log("✅ Login Success! SessKey:", STATE.sessKey);

    } catch (e) {
        console.error("❌ Login Failed:", e.message);
    } finally {
        STATE.isLoggingIn = false;
    }
}

// Auto Refresh every 5 minutes
setInterval(performLogin, 300000);

// --- API ROUTES ---
app.get('/api', async (req, res) => {
    let { type } = req.query;

    if (!STATE.cookie || !STATE.sessKey) {
        await performLogin();
    }

    const ts = Date.now();
    let targetUrl = "";
    let referer = "";

    // Normalize type (numbers vs number)
    if (type === 'numbers' || type === 'number') {
        referer = `${BASE_URL}/client/MySMSNumbers`;
        targetUrl = `${BASE_URL}/client/res/data_smsnumbers.php?sEcho=2&iDisplayStart=0&iDisplayLength=-1&_=${ts}`;
    } else if (type === 'sms') {
        referer = STATS_PAGE_URL;
        targetUrl = `${BASE_URL}/client/res/data_smscdr.php?sesskey=${STATE.sessKey}&sEcho=2&iDisplayStart=0&iDisplayLength=-1&_=${ts}`;
    } else {
        return res.status(400).json({ error: "Use ?type=numbers or ?type=sms" });
    }

    try {
        const response = await axios.get(targetUrl, {
            headers: { ...COMMON_HEADERS, "Cookie": STATE.cookie, "Referer": referer },
            timeout: 15000
        });

        // Check if session expired (server sends HTML instead of JSON)
        if (typeof response.data === 'string' && response.data.includes('<html')) {
            await performLogin();
            return res.status(503).json({ error: "Session expired, retrying..." });
        }

        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server active on port ${PORT}`);
    performLogin();
});
