require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 5000;

// --- CONFIGURATION ---
// 1. FIXED: Username/Password ko quotes ("") mein hona chahiye
const CREDENTIALS = {
    username: "Junaidali786",
    password: "Junaidali786"
};

const BASE_URL = "http://51.89.99.105/NumberPanel";
const STATS_PAGE_URL = `${BASE_URL}/client/SMSCDRStats`; 

const COMMON_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Mobile Safari/537.36",
    "X-Requested-With": "XMLHttpRequest",
    "Accept-Language": "en-US,en;q=0.9"
};

let STATE = {
    cookie: null,
    sessKey: null,
    isLoggingIn: false
};

// --- HELPERS ---
// 2. FIXED: Regex ko simple rakha hai taake sesskey sahi extract ho
function extractKey(html) {
    let match = html.match(/sesskey=([^&"']+)/);
    if (match) return match[1];
    return null;
}

// --- LOGIN LOGIC ---
async function performLogin() {
    if (STATE.isLoggingIn) return;
    STATE.isLoggingIn = true;
    
    console.log("🔄 Attempting Login for:", CREDENTIALS.username);

    try {
        const instance = axios.create({ 
            withCredentials: true, 
            headers: COMMON_HEADERS,
            timeout: 20000 
        });

        // Step 1: Get Login Page
        const r1 = await instance.get(`${BASE_URL}/login`);
        let tempCookie = r1.headers['set-cookie']?.find(x => x.includes('PHPSESSID'))?.split(';')[0];

        // Step 2: Solve Captcha
        const match = r1.data.match(/What is (\d+) \+ (\d+) = \?/);
        if (!match) throw new Error("Captcha pattern not found on page");
        const ans = parseInt(match[1]) + parseInt(match[2]);

        // Step 3: Sign In
        const params = new URLSearchParams();
        params.append('username', CREDENTIALS.username);
        params.append('password', CREDENTIALS.password);
        params.append('capt', ans);

        const r2 = await instance.post(`${BASE_URL}/signin`, params, {
            headers: { 
                "Content-Type": "application/x-www-form-urlencoded", 
                "Cookie": tempCookie,
                "Referer": `${BASE_URL}/login`
            },
            maxRedirects: 0, 
            validateStatus: () => true
        });

        STATE.cookie = r2.headers['set-cookie']?.find(x => x.includes('PHPSESSID'))?.split(';')[0] || tempCookie;
        
        // Step 4: Extract SessKey
        const r3 = await axios.get(STATS_PAGE_URL, {
            headers: { ...COMMON_HEADERS, "Cookie": STATE.cookie }
        });

        const key = extractKey(r3.data);
        if (key) {
            STATE.sessKey = key;
            console.log("✅ Login Success! SessKey:", STATE.sessKey);
        } else {
            console.log("❌ Login seemed okay but SessKey not found in HTML");
        }

    } catch (e) {
        console.error("❌ Login Error:", e.message);
    } finally {
        STATE.isLoggingIn = false;
    }
}

// Har 2 minute baad refresh (Session active rakhne ke liye)
setInterval(performLogin, 120000);

// --- API ROUTES ---
app.get('/api', async (req, res) => {
    let { type } = req.query;

    if (!STATE.cookie || !STATE.sessKey) {
        await performLogin();
        if (!STATE.sessKey) return res.status(503).json({ error: "System is logging in, please refresh in 10 seconds." });
    }

    const ts = Date.now();
    let targetUrl = "";
    let referer = "";

    if (type === 'numbers' || type === 'number') {
        referer = `${BASE_URL}/client/MySMSNumbers`;
        targetUrl = `${BASE_URL}/client/res/data_smsnumbers.php?sEcho=2&iDisplayStart=0&iDisplayLength=-1&_=${ts}`;
    } else if (type === 'sms') {
        referer = STATS_PAGE_URL;
        targetUrl = `${BASE_URL}/client/res/data_smscdr.php?sesskey=${STATE.sessKey}&sEcho=2&iDisplayStart=0&iDisplayLength=-1&_=${ts}`;
    } else {
        return res.status(400).json({ error: "Invalid type. Use ?type=numbers or ?type=sms" });
    }

    try {
        const response = await axios.get(targetUrl, {
            headers: { ...COMMON_HEADERS, "Cookie": STATE.cookie, "Referer": referer },
            timeout: 15000
        });

        if (typeof response.data === 'string' && (response.data.includes('<html') || response.data.includes('login'))) {
            STATE.cookie = null; STATE.sessKey = null; // Reset state
            return res.status(503).json({ error: "Session Expired. System is re-logging. Please try again." });
        }

        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: "Panel Request Failed: " + error.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 API is running on port ${PORT}`);
    performLogin();
});
