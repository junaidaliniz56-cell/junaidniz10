import telebot
import sqlite3
import os
from telebot import types

BOT_TOKEN = "8551649985:AAFXK9U4kCOe6fCKQAl9mKJqKvECEUyBDK8"
ADMINS = [7011937754]

# بوٹ کو تھریڈز کے ساتھ چلائیں تاکہ سپیڈ تیز ہو
bot = telebot.TeleBot(BOT_TOKEN, parse_mode="HTML", threaded=True, num_threads=10)

# ================= DATABASE SETUP =================
def get_db():
    conn = sqlite3.connect("bot_data.db", check_same_thread=False)
    return conn

db = get_db()
cursor = db.cursor()

# ٹیبلز بنانا
cursor.execute("CREATE TABLE IF NOT EXISTS numbers (id INTEGER PRIMARY KEY, country TEXT, phone TEXT)")
cursor.execute("CREATE TABLE IF NOT EXISTS channels (id INTEGER PRIMARY KEY, name TEXT, link TEXT, type TEXT)")
db.commit()

def is_admin(uid): return uid in ADMINS

# ================= JOIN CHECK =================
def check_join(uid):
    required_channels = ["@LegendTech92", "@LegendNumber92"]
    for ch in required_channels:
        try:
            m = bot.get_chat_member(ch, uid)
            if m.status in ["left", "kicked"]: return False
        except: return False
    return True

# ================= START =================
@bot.message_handler(commands=["start"])
def start(m):
    if not check_join(m.chat.id):
        kb = types.InlineKeyboardMarkup()
        kb.add(types.InlineKeyboardButton("📢 Join", url="https://t.me/LegendTech92"))
        kb.add(types.InlineKeyboardButton("📢 Join", url="https://t.me/jndtech1"))
        kb.add(types.InlineKeyboardButton(f"📢 Join", url="https://t.me/LegendNumber92"))
        kb.add(types.InlineKeyboardButton(f"📢 Join", url="https://whatsapp.com/channel/0029Vb7TrKS2kNFqNa0SRI3C"))
        kb.add(types.InlineKeyboardButton(f"📢 Join", url="https://whatsapp.com/channel/0029Vaf1X3f6hENsP7dKm81z"
        kb.add(types.InlineKeyboardButton("✅ Verify", callback_data="verify"))
        bot.send_message(m.chat.id, "❌ <b>Join required channels first!</b>", reply_markup=kb)
        return
    show_countries(m.chat.id)

@bot.callback_query_handler(func=lambda c: c.data == "verify")
def verify(c):
    if check_join(c.from_user.id):
        bot.delete_message(c.message.chat.id, c.message.message_id)
        show_countries(c.from_user.id)
    else:
        bot.answer_callback_query(c.id, "❌ Still not joined!", show_alert=True)

# ================= USER PANEL =================
def show_countries(cid):
    cursor.execute("SELECT country, COUNT(*) FROM numbers GROUP BY country")
    rows = cursor.fetchall()
    
    if not rows:
        bot.send_message(cid, "❌ No numbers available")
        return

    kb = types.InlineKeyboardMarkup(row_width=2)
    for country, count in rows:
        kb.add(types.InlineKeyboardButton(f"🌍 {country} ({count})", callback_data=f"get|{country}"))
    
    kb.add(types.InlineKeyboardButton("🔄 Refresh", callback_data="change"))
    bot.send_message(cid, "🌍 <b>Select Country:</b>", reply_markup=kb)

@bot.callback_query_handler(func=lambda c: c.data.startswith("get|"))
def pick_country(c):
    country = c.data.split("|")[1]
    
    # ڈیٹا بیس سے ایک نمبر نکالنا اور ساتھ ہی اسے ڈیلیٹ کرنا (تاکہ ڈپلیکیٹ نہ ہو)
    cursor.execute("SELECT id, phone FROM numbers WHERE country = ? LIMIT 1", (country,))
    res = cursor.fetchone()
    
    if res:
        db_id, phone = res
        cursor.execute("DELETE FROM numbers WHERE id = ?", (db_id,))
        db.commit()

        kb = types.InlineKeyboardMarkup()
        kb.add(types.InlineKeyboardButton("🔄 Change Number", callback_data=f"get|{country}"))
        kb.add(types.InlineKeyboardButton("🌍 Change Country", callback_data="change"))
        kb.add(types.InlineKeyboardButton("📱 OTP Group", url="https://t.me/freeotpm"))

        bot.edit_message_text(
            f"🌍 <b>Your Number ({country})</b>\n\n📞 <code>{phone}</code>\n\n⏳ Waiting for OTP...",
            c.message.chat.id,
            c.message.message_id,
            reply_markup=kb
        )
    else:
        bot.answer_callback_query(c.id, "❌ Out of stock!", show_alert=True)

@bot.callback_query_handler(func=lambda c: c.data == "change")
def change(c):
    show_countries(c.message.chat.id)

# ================= ADMIN PANEL =================
@bot.message_handler(commands=["admin"])
def admin(m):
    if not is_admin(m.chat.id): return
    kb = types.ReplyKeyboardMarkup(resize_keyboard=True)
    kb.add("➕ Add Numbers", "📋 Number List")
    kb.add("❌ Close")
    bot.send_message(m.chat.id, "🛠 <b>Admin Panel</b>", reply_markup=kb)

STATE = {}

@bot.message_handler(func=lambda m: m.text == "➕ Add Numbers")
def add_num_start(m):
    if not is_admin(m.chat.id): return
    STATE[m.chat.id] = "waiting_country"
    bot.send_message(m.chat.id, "🌍 Send Country Name:")

@bot.message_handler(func=lambda m: STATE.get(m.chat.id) == "waiting_country")
def get_country_name(m):
    STATE[m.chat.id] = {"country": m.text}
    bot.send_message(m.chat.id, f"📄 Send .txt file for {m.text}:")

@bot.message_handler(content_types=["document"])
def handle_file(m):
    if m.chat.id not in STATE or not isinstance(STATE[m.chat.id], dict): return
    
    country = STATE[m.chat.id]["country"]
    file_info = bot.get_file(m.document.file_id)
    file_data = bot.download_file(file_info.file_path).decode("utf-8")
    
    nums = [n.strip() for n in file_data.splitlines() if n.strip()]
    
    # Bulk insert for speed
    data_to_insert = [(country, n) for n in nums]
    cursor.executemany("INSERT INTO numbers (country, phone) VALUES (?, ?)", data_to_insert)
    db.commit()
    
    bot.send_message(m.chat.id, f"✅ {len(nums)} numbers added to {country}!")
    del STATE[m.chat.id]

@bot.message_handler(func=lambda m: m.text == "📋 Number List")
def list_nums(m):
    if not is_admin(m.chat.id): return
    cursor.execute("SELECT country, COUNT(*) FROM numbers GROUP BY country")
    rows = cursor.fetchall()
    kb = types.InlineKeyboardMarkup()
    for country, count in rows:
        kb.add(types.InlineKeyboardButton(f"❌ Delete {country} ({count})", callback_data=f"del|{country}"))
    bot.send_message(m.chat.id, "Tap to delete country stock:", reply_markup=kb)

@bot.callback_query_handler(func=lambda c: c.data.startswith("del|"))
def delete_stock(c):
    country = c.data.split("|")[1]
    cursor.execute("DELETE FROM numbers WHERE country = ?", (country,))
    db.commit()
    bot.edit_message_text(f"✅ Deleted all numbers for {country}", c.message.chat.id, c.message.message_id)

@bot.message_handler(func=lambda m: m.text == "❌ Close")
def close(m):
    bot.send_message(m.chat.id, "Closed", reply_markup=types.ReplyKeyboardRemove())

print("🤖 Fast Bot Running...")
bot.infinity_polling()
    
