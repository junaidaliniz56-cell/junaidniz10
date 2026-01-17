require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 5000;

// --- CONFIGURATION ---
const CREDENTIALS = {
    username: "Junaidjnd786", // Aapka Username
    password: "Junaidjnd786"  // Aapka Password
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

// --- HELPER: KEY EXTRACTION ---
function extractKey(html) {
    // Ye regex sesskey ki value ko " " ya & se pehle tak uthaye ga
    let match = html.match(/sesskey=([^&"']+)/);
    if (match) return match[1];
    return null;
}

// --- LOGIN LOGIC ---
async function performLogin() {
    if (STATE.isLoggingIn) return;
    STATE.isLoggingIn = true;
    
    console.log("🔄 Logging in to Panel for:", CREDENTIALS.username);

    try {
        const instance = axios.create({ withCredentials: true, headers: COMMON_HEADERS });

        // 1. Get Login Page & Captcha
        const r1 = await instance.get(`${BASE_URL}/login`);
        let tempCookie = r1.headers['set-cookie']?.find(x => x.includes('PHPSESSID'))?.split(';')[0];

        const match = r1.data.match(/What is (\d+) \+ (\d+) = \?/);
        if (!match) throw new Error("Captcha not found on page");
        const ans = parseInt(match[1]) + parseInt(match[2]);

        // 2. Submit Login
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
        
        // 3. Get SessKey from Stats Page
        const r3 = await axios.get(STATS_PAGE_URL, {
            headers: { ...COMMON_HEADERS, "Cookie": STATE.cookie }
        });

        const key = extractKey(r3.data);
        if (key) {
            STATE.sessKey = key;
            console.log("✅ Login Success! SessKey:", STATE.sessKey);
        } else {
            console.log("❌ Login done but SessKey not found.");
        }

    } catch (e) {
        console.error("❌ Login Failed:", e.message);
    } finally {
        STATE.isLoggingIn = false;
    }
}

// Refresh login every 2 minutes
setInterval(performLogin, 120000);

// --- API ENDPOINT ---
app.get('/api', async (req, res) => {
    let { type } = req.query;

    if (!STATE.cookie || !STATE.sessKey) {
        await performLogin();
        if (!STATE.sessKey) return res.status(503).json({ error: "Logging in... please wait 10 seconds." });
    }

    const ts = Date.now();
    let targetUrl = "";
    let referer = "";

    if (type === 'numbers' || type === 'number') {
        referer = `${BASE_URL}/client/MySMSNumbers`;
        targetUrl = `${BASE_URL}/client/res/data_smsnumbers.php?sEcho=2&iDisplayStart=0&iDisplayLength=-1&_=${ts}`;
    } 
    else if (type === 'sms') {
        referer = STATS_PAGE_URL;
        
        // Aaj ki date nikalne ke liye format: 2026-01-17
        const today = new Date().toISOString().split('T')[0];
        const fdate1 = `${today}%2000:00:00`;
        const fdate2 = `${today}%2023:59:59`;

        // Pura URL jo aap ne bheja tha (parameters ke sath)
        targetUrl = `${BASE_URL}/client/res/data_smscdr.php?fdate1=${fdate1}&fdate2=${fdate2}&frange=&fnum=&fcli=&fgdate=&fgmonth=&fgrange=&fgnumber=&fgcli=&fg=0&sesskey=${STATE.sessKey}&sEcho=2&iColumns=7&sColumns=%2C%2C%2C%2C%2C%2C&iDisplayStart=0&iDisplayLength=-1&mDataProp_0=0&sSearch_0=&bRegex_0=false&bSearchable_0=true&bSortable_0=true&mDataProp_1=1&sSearch_1=&bRegex_1=false&bSearchable_1=true&bSortable_1=true&mDataProp_2=2&sSearch_2=&bRegex_2=false&bSearchable_2=true&bSortable_2=true&mDataProp_3=3&sSearch_3=&bRegex_3=false&bSearchable_3=true&bSortable_3=true&mDataProp_4=4&sSearch_4=&bRegex_4=false&bSearchable_4=true&bSortable_4=true&mDataProp_5=5&sSearch_5=&bRegex_5=false&bSearchable_5=true&bSortable_5=true&mDataProp_6=6&sSearch_6=&bRegex_6=false&bSearchable_6=true&bSortable_6=true&sSearch=&bRegex=false&iSortCol_0=0&sSortDir_0=desc&iSortingCols=1&_=${ts}`;
    } 
    else {
        return res.status(400).json({ error: "Use ?type=numbers or ?type=sms" });
    }

    try {
        const response = await axios.get(targetUrl, {
            headers: { ...COMMON_HEADERS, "Cookie": STATE.cookie, "Referer": referer },
            timeout: 20000
        });

        // Check for session expiry
        if (typeof response.data === 'string' && response.data.includes('<html')) {
            STATE.cookie = null; STATE.sessKey = null;
            return res.status(503).json({ error: "Session Expired. Refreshing..." });
        }

        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: "Panel Error: " + error.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 API active on Port ${PORT}`);
    performLogin();
});
