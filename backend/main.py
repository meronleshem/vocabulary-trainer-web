import os
import re
import math
import random
import json as _json
from datetime import date, datetime, timedelta, timezone
from typing import List, Optional
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import requests
from bs4 import BeautifulSoup

# ── Database backend ──────────────────────────────────────────────────────────
# Set DATABASE_URL env var for PostgreSQL (e.g. Neon); otherwise SQLite is used.
DATABASE_URL = os.environ.get("DATABASE_URL")
IS_POSTGRES = bool(DATABASE_URL)

if IS_POSTGRES:
    import psycopg2
    import psycopg2.extras

    class _PgCursor:
        """Wraps a psycopg2 RealDictCursor to behave like a sqlite3 cursor."""
        def __init__(self, raw):
            self._c = raw

        def execute(self, sql, params=None):
            sql = sql.replace("?", "%s")
            self._c.execute(sql, params) if params is not None else self._c.execute(sql)
            return self  # support chaining like sqlite3 cursors

        def fetchone(self):  return self._c.fetchone()
        def fetchall(self):  return self._c.fetchall()

        @property
        def rowcount(self): return self._c.rowcount
        @property
        def lastrowid(self): return None  # use RETURNING id instead

    class _PgConn:
        """Wraps a psycopg2 connection to expose conn.execute() like sqlite3."""
        def __init__(self, raw):
            self._conn = raw

        def cursor(self):
            return _PgCursor(self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor))

        def execute(self, sql, params=None):
            c = self.cursor()
            c.execute(sql, params)
            return c

        def commit(self):    self._conn.commit()
        def rollback(self):  self._conn.rollback()
        def close(self):     self._conn.close()

    def get_db() -> _PgConn:
        return _PgConn(psycopg2.connect(DATABASE_URL))

    _AI_PK = "SERIAL PRIMARY KEY"

else:
    import sqlite3
    DB_PATH = os.path.join(os.path.dirname(__file__), "..", "Database", "vocabulary.db")

    def get_db():
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        return conn

    _AI_PK = "INTEGER PRIMARY KEY AUTOINCREMENT"

# Hebrew niqqud (vowel marks) U+05B0–U+05C7
_NIQQUD_RE = re.compile(r'[ְ-ׇ]')

def _strip_niqqud(text: str) -> str:
    return _NIQQUD_RE.sub('', text)

def _normalize_answer(text: str) -> str:
    text = re.sub(r'\([^)]*\)', '', text)   # strip (parenthetical)
    text = re.sub(r'\[[^\]]*\]', '', text)  # strip [bracketed]
    text = _strip_niqqud(text)
    return text.strip()

def _split_translations(stored: str) -> list:
    """Split a stored translation string into individual normalized alternatives."""
    parts = re.split(r'[,;/|]', stored)
    seen, result = set(), []
    for p in parts:
        n = _normalize_answer(p)
        if n and n not in seen:
            seen.add(n)
            result.append(n)
    return result

def _validate_answer(user_input: str, stored: str) -> bool:
    if not user_input or not user_input.strip():
        return False
    return _normalize_answer(user_input) in _split_translations(stored)

IMAGES_DIR = os.path.join(os.path.dirname(__file__), "..", "Images")
WORD_FREQ_PATH = os.path.join(os.path.dirname(__file__), "..", "Database", "word_frequency.json")

# ---------------------------------------------------------------------------
# Word-frequency data — loaded once at startup.
# Format: { "word": { "rank": int, "frequency_level": int, "frequency_label": str } }
# ---------------------------------------------------------------------------

def _load_word_frequency() -> dict:
    try:
        with open(WORD_FREQ_PATH, "r", encoding="utf-8") as _f:
            return _json.load(_f)
    except Exception:
        return {}

WORD_FREQ: dict = _load_word_frequency()

# Pre-build a set of words per level for O(1) look-ups: { level: set(words) }
_FREQ_BY_LEVEL: dict[int, set] = {}
for _w, _meta in WORD_FREQ.items():
    _lvl = _meta.get("frequency_level")
    if _lvl is not None:
        _FREQ_BY_LEVEL.setdefault(_lvl, set()).add(_w.lower())

FREQ_LABELS = {1: "Essential", 2: "Very Common", 3: "Common", 4: "Useful", 5: "Rare"}

# ── Progress / Rewards configuration ────────────────────────────────────────

LEARN_THRESHOLD = 1       # correct answers needed to mark a word as "learned"
XP_CORRECT_ANSWER = 2     # XP per correct quiz answer
XP_NEW_WORD_LEARNED = 10  # XP bonus when a word is newly learned
XP_SESSION = 20           # XP for completing any session

ACHIEVEMENTS = [
    {"id": "words_10",    "emoji": "🌱", "label": "First Steps",     "desc": "Learn 10 words",        "xp": 50},
    {"id": "words_50",    "emoji": "📚", "label": "Getting Started", "desc": "Learn 50 words",        "xp": 100},
    {"id": "words_100",   "emoji": "💯", "label": "Century",         "desc": "Learn 100 words",       "xp": 200},
    {"id": "words_500",   "emoji": "⚡", "label": "Word Enthusiast", "desc": "Learn 500 words",       "xp": 500},
    {"id": "words_1000",  "emoji": "🏆", "label": "Word Master",     "desc": "Learn 1,000 words",     "xp": 1000},
    {"id": "sessions_5",  "emoji": "🎯", "label": "Committed",       "desc": "Complete 5 sessions",   "xp": 50},
    {"id": "sessions_10", "emoji": "💪", "label": "Dedicated",       "desc": "Complete 10 sessions",  "xp": 100},
    {"id": "sessions_50", "emoji": "🏃", "label": "Marathon Learner","desc": "Complete 50 sessions",  "xp": 300},
    {"id": "streak_3",    "emoji": "🔥", "label": "On a Roll",       "desc": "3-day streak",          "xp": 30},
    {"id": "streak_7",    "emoji": "⚔️", "label": "Week Warrior",    "desc": "7-day streak",          "xp": 100},
    {"id": "streak_30",   "emoji": "👑", "label": "Streak Legend",   "desc": "30-day streak",         "xp": 500},
]


def init_progress_db():
    conn = get_db()
    cur = conn.cursor()

    stmts = [
        """CREATE TABLE IF NOT EXISTS user_progress (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            total_xp INTEGER NOT NULL DEFAULT 0,
            daily_goal INTEGER NOT NULL DEFAULT 10,
            current_streak INTEGER NOT NULL DEFAULT 0,
            longest_streak INTEGER NOT NULL DEFAULT 0,
            last_activity_date TEXT DEFAULT NULL
        )""",
        "INSERT INTO user_progress (id) VALUES (1) ON CONFLICT DO NOTHING",
        """CREATE TABLE IF NOT EXISTS word_progress (
            word_id INTEGER PRIMARY KEY,
            correct_count INTEGER NOT NULL DEFAULT 0,
            attempt_count INTEGER NOT NULL DEFAULT 0,
            learned INTEGER NOT NULL DEFAULT 0,
            learned_at TEXT DEFAULT NULL,
            last_attempt_date TEXT DEFAULT NULL
        )""",
        """CREATE TABLE IF NOT EXISTS daily_activity (
            date TEXT PRIMARY KEY,
            words_studied INTEGER NOT NULL DEFAULT 0,
            sessions_completed INTEGER NOT NULL DEFAULT 0,
            xp_earned INTEGER NOT NULL DEFAULT 0,
            correct_answers INTEGER NOT NULL DEFAULT 0,
            total_answers INTEGER NOT NULL DEFAULT 0
        )""",
        """CREATE TABLE IF NOT EXISTS achievements (
            id TEXT PRIMARY KEY,
            unlocked_at TEXT NOT NULL,
            xp_awarded INTEGER NOT NULL DEFAULT 0
        )""",
        """CREATE TABLE IF NOT EXISTS daily_words (
            date TEXT NOT NULL,
            word_id INTEGER NOT NULL,
            PRIMARY KEY (date, word_id)
        )""",
        f"""CREATE TABLE IF NOT EXISTS difficulty_history (
            id {_AI_PK},
            date TEXT NOT NULL,
            word_id INTEGER NOT NULL,
            difficulty TEXT NOT NULL
        )""",
        f"""CREATE TABLE IF NOT EXISTS sessions (
            id {_AI_PK},
            session_type TEXT NOT NULL,
            started_at TEXT NOT NULL,
            ended_at TEXT,
            word_count INTEGER NOT NULL DEFAULT 0,
            correct_count INTEGER NOT NULL DEFAULT 0,
            incorrect_count INTEGER NOT NULL DEFAULT 0,
            duration_seconds INTEGER DEFAULT NULL
        )""",
    ]
    for stmt in stmts:
        cur.execute(stmt)

    # Migrate existing databases — add columns that may not exist yet.
    migrations = [
        ("word_progress",  "attempt_count",      "INTEGER NOT NULL DEFAULT 0"),
        ("word_progress",  "last_attempt_date",   "TEXT DEFAULT NULL"),
        ("daily_activity", "correct_answers",     "INTEGER NOT NULL DEFAULT 0"),
        ("daily_activity", "total_answers",       "INTEGER NOT NULL DEFAULT 0"),
    ]
    for table, col, col_def in migrations:
        if IS_POSTGRES:
            cur.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {col} {col_def}")
        else:
            try:
                cur.execute(f"ALTER TABLE {table} ADD COLUMN {col} {col_def}")
            except Exception:
                pass  # Column already exists

    conn.commit()
    conn.close()


app = FastAPI(title="VocabularyApp API", version="1.0.0")

if os.path.isdir(IMAGES_DIR):
    app.mount("/api/images", StaticFiles(directory=IMAGES_DIR), name="images")

# ALLOWED_ORIGINS env var: comma-separated list of allowed origins.
# Set to your Vercel URL in production, e.g.:
#   ALLOWED_ORIGINS=https://vocabulary-trainer-web.vercel.app
_raw_origins = os.environ.get(
    "ALLOWED_ORIGINS",
    "http://localhost:5174,http://127.0.0.1:5174"
)
_allowed_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Initialise progress tables on startup (idempotent).
init_progress_db()


def _freq_filter(frequency_level: list[int]) -> tuple[list, list]:
    """
    Return (extra_conditions, extra_params) to restrict a query to the given
    frequency levels.  Words absent from the frequency file count as Rare (5).
    Returns (["1=0"], []) when levels are requested but no words match.
    """
    if not frequency_level:
        return [], []
    selected = set(frequency_level)
    conn_tmp = get_db()
    cur_tmp = conn_tmp.cursor()
    cur_tmp.execute("SELECT LOWER(engWord) as eng FROM vocabulary")
    vocab_words = [r["eng"] for r in cur_tmp.fetchall()]
    conn_tmp.close()
    matching = [
        w for w in vocab_words
        if WORD_FREQ.get(w, {}).get("frequency_level", 5) in selected
    ]
    if not matching:
        return ["1=0"], []
    placeholders = ",".join("?" * len(matching))
    return [f"LOWER(engWord) IN ({placeholders})"], matching


_MORFIX_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Referer": "https://www.google.com/",
}

def _scrape_morfix(eng_word: str) -> dict:
    url = f"https://www.morfix.co.il/{eng_word}"
    try:
        resp = requests.get(url, headers=_MORFIX_HEADERS, timeout=8)
        resp.raise_for_status()
    except Exception as e:
        raise HTTPException(502, f"Could not reach morfix.co.il: {e}")

    soup = BeautifulSoup(resp.text, "html.parser")

    heb_parts = []
    content_blocks = soup.find_all("div", class_="Translation_content_enTohe")
    for block in content_blocks:
        top = block.find("div", class_="Translation_divTop_enTohe")
        pos = ""
        if top:
            top_text = top.get_text(separator=" ", strip=True)
            tokens = top_text.split()
            for tok in tokens:
                if tok.lower() in ("verb", "noun", "adjective", "adverb", "preposition", "pronoun", "conjunction"):
                    pos = tok.lower()
                    break

        trans_div = block.find("div", class_="normal_translation_div")
        if trans_div:
            trans = trans_div.get_text(strip=True)
            if trans:
                heb_parts.append(f"({pos}) {trans}" if pos else trans)

    heb_word = " | ".join(heb_parts)

    examples = ""
    for ul in soup.find_all("ul", class_="Translation_ulFooter_enTohe"):
        items = ul.find_all("li")[:3]
        if items:
            examples = "\n".join(li.get_text(strip=True) for li in items)
            break

    return {"hebWord": heb_word, "examples": examples}


def extract_book(group_name: str) -> str:
    if not group_name or not group_name.strip():
        return "Uncategorized"
    name = group_name.replace("_", " ").strip()
    name = re.sub(r"\s+\d+$", "", name).strip()
    return name if name else "Uncategorized"


def natural_sort_key(group_name: str):
    """Sort key that treats trailing numbers numerically, e.g. 'book 2' < 'book 10'."""
    if not group_name:
        return ("", 0)
    name = group_name.replace("_", " ").strip()
    m = re.search(r"(\d+)$", name)
    if m:
        return (name[: m.start()].strip().lower(), int(m.group()))
    return (name.lower(), 0)


# ── Pydantic models ──────────────────────────────────────────────────────────

class WordCreate(BaseModel):
    engWord: str
    hebWord: str
    examples: Optional[str] = ""
    difficulty: str = "NEW_WORD"
    group_name: Optional[str] = ""
    image_url: Optional[str] = ""


class WordUpdate(BaseModel):
    engWord: Optional[str] = None
    hebWord: Optional[str] = None
    examples: Optional[str] = None
    difficulty: Optional[str] = None
    group_name: Optional[str] = None
    image_url: Optional[str] = None


class DifficultyUpdate(BaseModel):
    difficulty: str


class RecordAnswerBody(BaseModel):
    word_id: int
    correct: bool


class RecordSessionBody(BaseModel):
    session_type: str  # quiz | fill_quiz | study | study_session
    word_ids: List[int] = []  # unique word IDs studied in this session
    duration_seconds: Optional[int] = None
    correct_count: int = 0
    incorrect_count: int = 0


class DailyGoalBody(BaseModel):
    daily_goal: int


# ── Words ────────────────────────────────────────────────────────────────────

@app.get("/api/word-frequency")
def get_word_frequency(
    frequency_level: List[int] = Query(default=[]),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
):
    if not WORD_FREQ:
        raise HTTPException(503, "Word frequency data not available")

    valid_levels = {1, 2, 3, 4, 5}
    for lvl in frequency_level:
        if lvl not in valid_levels:
            raise HTTPException(400, f"Invalid frequency_level: {lvl}. Must be 1–5.")

    results = [
        {"word": w, **meta}
        for w, meta in WORD_FREQ.items()
        if not frequency_level or meta["frequency_level"] in frequency_level
    ]
    results.sort(key=lambda x: x["rank"])

    total = len(results)
    page_items = results[offset : offset + limit]
    return {
        "total": total,
        "offset": offset,
        "limit": limit,
        "frequency_levels": {k: v for k, v in FREQ_LABELS.items()},
        "words": page_items,
    }


@app.get("/api/words")
def list_words(
    search: Optional[str] = None,
    difficulty: Optional[str] = None,
    group_name: Optional[str] = None,
    frequency_level: List[int] = Query(default=[]),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    sort_by: str = "id",
    sort_dir: str = "asc",
):
    allowed_sort = {"id", "engWord", "hebWord", "difficulty", "group_name"}
    if sort_by not in allowed_sort:
        sort_by = "id"
    if sort_dir not in ("asc", "desc"):
        sort_dir = "asc"

    conditions, params = [], []
    if search:
        conditions.append("(engWord LIKE ? OR hebWord LIKE ?)")
        params += [f"%{search}%", f"%{search}%"]
    if difficulty:
        conditions.append("difficulty = ?")
        params.append(difficulty)
    if group_name:
        conditions.append("group_name = ?")
        params.append(group_name)

    if frequency_level:
        selected = set(frequency_level)
        conn_tmp = get_db()
        cur_tmp = conn_tmp.cursor()
        cur_tmp.execute("SELECT LOWER(engWord) as eng FROM vocabulary")
        vocab_words = [r["eng"] for r in cur_tmp.fetchall()]
        conn_tmp.close()

        matching = [
            w for w in vocab_words
            if WORD_FREQ.get(w, {}).get("frequency_level", 5) in selected
        ]

        if not matching:
            return {"total": 0, "page": page, "limit": limit, "words": []}

        placeholders = ",".join("?" * len(matching))
        conditions.append(f"LOWER(engWord) IN ({placeholders})")
        params.extend(matching)

    where = (" WHERE " + " AND ".join(conditions)) if conditions else ""

    conn = get_db()
    cur = conn.cursor()
    cur.execute(f"SELECT COUNT(*) AS cnt FROM vocabulary{where}", params)
    total = cur.fetchone()["cnt"]

    db_offset = (page - 1) * limit
    cur.execute(
        f"SELECT * FROM vocabulary{where} ORDER BY {sort_by} {sort_dir} LIMIT ? OFFSET ?",
        params + [limit, db_offset],
    )
    words = [dict(r) for r in cur.fetchall()]
    conn.close()
    return {"total": total, "page": page, "limit": limit, "words": words}


@app.get("/api/words/study")
def get_study_words(
    difficulty: Optional[str] = None,
    group_names: List[str] = Query(default=[]),
    frequency_level: List[int] = Query(default=[]),
    limit: int = Query(20, ge=1, le=100),
):
    conditions, params = [], []
    if difficulty:
        conditions.append("difficulty = ?")
        params.append(difficulty)
    if group_names:
        placeholders = ",".join(["?"] * len(group_names))
        conditions.append(f"group_name IN ({placeholders})")
        params.extend(group_names)
    freq_cond, freq_params = _freq_filter(frequency_level)
    conditions.extend(freq_cond)
    params.extend(freq_params)

    where = (" WHERE " + " AND ".join(conditions)) if conditions else ""
    conn = get_db()
    cur = conn.cursor()
    cur.execute(f"SELECT * FROM vocabulary{where} ORDER BY RANDOM() LIMIT ?", params + [limit])
    words = [dict(r) for r in cur.fetchall()]
    conn.close()
    return words


@app.get("/api/words/quiz")
def get_quiz(
    difficulty: List[str] = Query(default=[]),
    group_names: List[str] = Query(default=[]),
    frequency_level: List[int] = Query(default=[]),
    count: int = Query(10, ge=1, le=50),
    direction: str = "eng_to_heb",
):
    conditions, params = [], []
    if difficulty:
        placeholders = ",".join(["?"] * len(difficulty))
        conditions.append(f"difficulty IN ({placeholders})")
        params.extend(difficulty)
    if group_names:
        placeholders = ",".join(["?"] * len(group_names))
        conditions.append(f"group_name IN ({placeholders})")
        params.extend(group_names)
    freq_cond, freq_params = _freq_filter(frequency_level)
    conditions.extend(freq_cond)
    params.extend(freq_params)

    where = (" WHERE " + " AND ".join(conditions)) if conditions else ""
    conn = get_db()
    cur = conn.cursor()

    cur.execute(f"SELECT * FROM vocabulary{where} ORDER BY RANDOM() LIMIT ?", params + [count])
    questions_raw = [dict(r) for r in cur.fetchall()]

    cur.execute("SELECT hebWord, engWord FROM vocabulary ORDER BY RANDOM() LIMIT 200")
    pool = [dict(r) for r in cur.fetchall()]
    conn.close()

    questions = []
    for word in questions_raw:
        if direction == "eng_to_heb":
            question_text = word["engWord"]
            correct = word["hebWord"]
            distractor_field = "hebWord"
        else:
            question_text = word["hebWord"]
            correct = word["engWord"]
            distractor_field = "engWord"

        distractors = [
            p[distractor_field]
            for p in pool
            if p[distractor_field] != correct
        ]
        distractors = list(set(distractors))
        random.shuffle(distractors)
        options = distractors[:3] + [correct]
        random.shuffle(options)

        questions.append({
            "id": word["id"],
            "question": question_text,
            "correct": correct,
            "options": options,
            "word": word,
        })

    return questions


@app.get("/api/words/hard-quiz")
def get_hard_quiz(
    difficulty: List[str] = Query(default=[]),
    group_names: List[str] = Query(default=[]),
    frequency_level: List[int] = Query(default=[]),
    count: int = Query(10, ge=1, le=50),
    direction: str = "eng_to_heb",
):
    conditions, params = [], []
    if difficulty:
        placeholders = ",".join(["?"] * len(difficulty))
        conditions.append(f"difficulty IN ({placeholders})")
        params.extend(difficulty)
    if group_names:
        placeholders = ",".join(["?"] * len(group_names))
        conditions.append(f"group_name IN ({placeholders})")
        params.extend(group_names)
    freq_cond, freq_params = _freq_filter(frequency_level)
    conditions.extend(freq_cond)
    params.extend(freq_params)

    where = (" WHERE " + " AND ".join(conditions)) if conditions else ""
    conn = get_db()
    cur = conn.cursor()
    cur.execute(f"SELECT * FROM vocabulary{where} ORDER BY RANDOM() LIMIT ?", params + [count])
    words = [dict(r) for r in cur.fetchall()]
    conn.close()

    questions = []
    for word in words:
        if direction == "eng_to_heb":
            question_text = word["engWord"]
            correct = word["hebWord"]
        else:
            question_text = word["hebWord"]
            correct = word["engWord"]

        questions.append({
            "id": word["id"],
            "question": question_text,
            "correct": correct,
            "accepted": _split_translations(correct),
            "word": word,
        })

    return questions


class CheckAnswerBody(BaseModel):
    word_id: int
    user_answer: str
    direction: str = "eng_to_heb"


@app.post("/api/words/hard-quiz/check")
def check_hard_answer(body: CheckAnswerBody):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT hebWord, engWord FROM vocabulary WHERE id = ?", (body.word_id,))
    row = cur.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Word not found")

    stored = row["hebWord"] if body.direction == "eng_to_heb" else row["engWord"]
    correct = _validate_answer(body.user_answer, stored)
    return {"correct": correct, "accepted": _split_translations(stored)}


@app.get("/api/words/fill-quiz")
def get_fill_quiz(
    difficulty: List[str] = Query(default=[]),
    group_names: List[str] = Query(default=[]),
    frequency_level: List[int] = Query(default=[]),
    count: int = Query(10, ge=1, le=50),
):
    conditions = ["(examples IS NOT NULL AND examples != '')"]
    params = []
    if difficulty:
        placeholders = ",".join(["?"] * len(difficulty))
        conditions.append(f"difficulty IN ({placeholders})")
        params.extend(difficulty)
    if group_names:
        placeholders = ",".join(["?"] * len(group_names))
        conditions.append(f"group_name IN ({placeholders})")
        params.extend(group_names)
    freq_cond, freq_params = _freq_filter(frequency_level)
    conditions.extend(freq_cond)
    params.extend(freq_params)

    where = " WHERE " + " AND ".join(conditions)
    conn = get_db()
    cur = conn.cursor()

    cur.execute(f"SELECT * FROM vocabulary{where} ORDER BY RANDOM() LIMIT ?", params + [count])
    words_raw = [dict(r) for r in cur.fetchall()]

    cur.execute("SELECT engWord FROM vocabulary ORDER BY RANDOM() LIMIT 200")
    pool = [r["engWord"] for r in cur.fetchall()]
    conn.close()

    questions = []
    for word in words_raw:
        eng = word["engWord"]
        lines = [l.strip() for l in word["examples"].split("\n") if l.strip()]
        matching = [l for l in lines if re.search(re.escape(eng), l, re.IGNORECASE)]
        if not matching:
            continue
        example_line = random.choice(matching)

        sentence = re.sub(re.escape(eng), "____", example_line, flags=re.IGNORECASE)

        distractors = [w for w in pool if w.lower() != eng.lower()]
        distractors = list(dict.fromkeys(distractors))
        random.shuffle(distractors)
        options = distractors[:3] + [eng]
        random.shuffle(options)

        questions.append({
            "id": word["id"],
            "sentence": sentence,
            "correct": eng,
            "options": options,
            "word": word,
        })

    return questions


@app.get("/api/words/lookup")
def lookup_word(q: str = Query(..., min_length=1)):
    """Scrape morfix.co.il and return hebWord + examples without saving."""
    return _scrape_morfix(q.strip())


@app.get("/api/words/{word_id}")
def get_word(word_id: int):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM vocabulary WHERE id = ?", (word_id,))
    row = cur.fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Word not found")
    return dict(row)


@app.post("/api/words", status_code=201)
def create_word(word: WordCreate):
    valid_diffs = {"EASY", "MEDIUM", "HARD", "NEW_WORD"}
    if word.difficulty not in valid_diffs:
        raise HTTPException(400, "Invalid difficulty")

    eng_lower = word.engWord.strip().lower()

    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT id FROM vocabulary WHERE LOWER(engWord) = ?", (eng_lower,))
    if cur.fetchone():
        conn.close()
        raise HTTPException(409, f'"{eng_lower}" already exists in the database.')

    insert_sql = "INSERT INTO vocabulary (engWord, hebWord, examples, difficulty, group_name, image_url) VALUES (?,?,?,?,?,?)"
    insert_params = (eng_lower, word.hebWord, word.examples or "", word.difficulty, word.group_name or "", word.image_url or "")

    if IS_POSTGRES:
        cur.execute(insert_sql + " RETURNING id", insert_params)
        new_id = cur.fetchone()["id"]
    else:
        cur.execute(insert_sql, insert_params)
        new_id = cur._c.lastrowid  # sqlite3 cursor

    conn.commit()
    cur.execute("SELECT * FROM vocabulary WHERE id = ?", (new_id,))
    row = dict(cur.fetchone())
    conn.close()
    return row


@app.put("/api/words/{word_id}")
def update_word(word_id: int, word: WordUpdate):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM vocabulary WHERE id = ?", (word_id,))
    existing = cur.fetchone()
    if not existing:
        conn.close()
        raise HTTPException(404, "Word not found")

    updates = {k: v for k, v in word.model_dump().items() if v is not None}
    if updates:
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        cur.execute(
            f"UPDATE vocabulary SET {set_clause} WHERE id = ?",
            list(updates.values()) + [word_id],
        )
        conn.commit()

    cur.execute("SELECT * FROM vocabulary WHERE id = ?", (word_id,))
    row = dict(cur.fetchone())
    conn.close()
    return row


@app.delete("/api/words/{word_id}")
def delete_word(word_id: int):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT id FROM vocabulary WHERE id = ?", (word_id,))
    if not cur.fetchone():
        conn.close()
        raise HTTPException(404, "Word not found")
    cur.execute("DELETE FROM vocabulary WHERE id = ?", (word_id,))
    conn.commit()
    conn.close()
    return {"message": "Deleted"}


@app.patch("/api/words/{word_id}/difficulty")
def patch_difficulty(word_id: int, body: DifficultyUpdate):
    valid = {"EASY", "MEDIUM", "HARD", "NEW_WORD"}
    if body.difficulty not in valid:
        raise HTTPException(400, "Invalid difficulty value")
    conn = get_db()
    cur = conn.cursor()
    cur.execute("UPDATE vocabulary SET difficulty = ? WHERE id = ?", (body.difficulty, word_id))
    if cur.rowcount == 0:
        conn.close()
        raise HTTPException(404, "Word not found")
    today_str = date.today().isoformat()
    cur.execute(
        "INSERT INTO difficulty_history (date, word_id, difficulty) VALUES (?, ?, ?)",
        (today_str, word_id, body.difficulty),
    )
    if body.difficulty in {"EASY", "MEDIUM", "HARD"}:
        cur.execute("""
            INSERT INTO word_progress (word_id, correct_count, learned, learned_at)
            VALUES (?, ?, 1, ?)
            ON CONFLICT(word_id) DO UPDATE SET
                learned = 1,
                learned_at = COALESCE(word_progress.learned_at, excluded.learned_at),
                correct_count = MAX(word_progress.correct_count, excluded.correct_count)
        """, (word_id, LEARN_THRESHOLD, today_str))

    conn.commit()
    conn.close()
    return {"id": word_id, "difficulty": body.difficulty}


# ── Study Session ─────────────────────────────────────────────────────────────

@app.get("/api/study-session")
def get_study_session(word_ids: List[int] = Query(...)):
    if len(word_ids) < 2:
        raise HTTPException(400, "Select at least 2 words")

    conn = get_db()
    cur = conn.cursor()

    placeholders = ",".join(["?"] * len(word_ids))
    cur.execute(f"SELECT * FROM vocabulary WHERE id IN ({placeholders})", word_ids)
    words = [dict(r) for r in cur.fetchall()]

    if not words:
        conn.close()
        raise HTTPException(404, "No words found")

    cur.execute(
        f"SELECT id, engWord, hebWord, image_url FROM vocabulary "
        f"WHERE id NOT IN ({placeholders}) ORDER BY RANDOM() LIMIT 200",
        word_ids,
    )
    pool = [dict(r) for r in cur.fetchall()]
    conn.close()

    result = []
    for word in words:
        shuffled = random.sample(pool, len(pool))

        heb_seen: set = set()
        heb_distractors = []
        for p in shuffled:
            if p["hebWord"] not in heb_seen and p["hebWord"] != word["hebWord"]:
                heb_distractors.append({"hebWord": p["hebWord"], "image_url": p.get("image_url") or ""})
                heb_seen.add(p["hebWord"])
            if len(heb_distractors) == 2:
                break

        eng_seen: set = set()
        eng_distractors = []
        for p in shuffled:
            if p["engWord"] not in eng_seen and p["engWord"] != word["engWord"]:
                eng_distractors.append(p["engWord"])
                eng_seen.add(p["engWord"])
            if len(eng_distractors) == 2:
                break

        result.append({**word, "heb_distractors": heb_distractors, "eng_distractors": eng_distractors})

    return result


# ── Meta ─────────────────────────────────────────────────────────────────────

@app.get("/api/groups")
def list_groups():
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        "SELECT group_name, COUNT(*) as count FROM vocabulary GROUP BY group_name"
    )
    rows = [{"group_name": r["group_name"], "count": r["count"]} for r in cur.fetchall()]
    conn.close()
    rows.sort(key=lambda r: natural_sort_key(r["group_name"]))
    return rows


@app.get("/api/books")
def list_books():
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        "SELECT group_name, difficulty, COUNT(*) as count FROM vocabulary GROUP BY group_name, difficulty ORDER BY group_name"
    )
    rows = cur.fetchall()
    conn.close()

    group_counts: dict = {}
    for row in rows:
        gname = row["group_name"]
        diff = row["difficulty"]
        cnt = row["count"]
        if gname not in group_counts:
            group_counts[gname] = {"total": 0, "NEW_WORD": 0, "EASY": 0, "MEDIUM": 0, "HARD": 0}
        group_counts[gname]["total"] += cnt
        if diff in group_counts[gname]:
            group_counts[gname][diff] += cnt

    books: dict = {}
    for gname, counts in group_counts.items():
        book = extract_book(gname)
        if book not in books:
            books[book] = {"book": book, "total": 0, "groups": []}
        books[book]["total"] += counts["total"]
        books[book]["groups"].append({
            "group_name": gname,
            "count": counts["total"],
            "easy": counts["EASY"],
            "medium": counts["MEDIUM"],
            "hard": counts["HARD"],
            "new_word": counts["NEW_WORD"],
        })

    for b in books.values():
        b["groups"].sort(key=lambda g: natural_sort_key(g["group_name"]))

    return sorted(books.values(), key=lambda b: b["book"].lower())


@app.put("/api/groups/{group_name}")
def rename_group(group_name: str, body: dict):
    new_name = (body.get("new_name") or "").strip()
    if not new_name:
        raise HTTPException(status_code=422, detail="new_name is required")
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) AS cnt FROM vocabulary WHERE group_name = ?", (new_name,))
    if cur.fetchone()["cnt"] > 0:
        conn.close()
        raise HTTPException(status_code=409, detail=f'Group "{new_name}" already exists')
    cur.execute("UPDATE vocabulary SET group_name = ? WHERE group_name = ?", (new_name, group_name))
    conn.commit()
    affected = cur.rowcount
    conn.close()
    return {"renamed": affected, "old_name": group_name, "new_name": new_name}


@app.get("/api/stats")
def get_stats():
    conn = get_db()
    cur = conn.cursor()

    cur.execute("SELECT COUNT(*) AS cnt FROM vocabulary")
    total = cur.fetchone()["cnt"]

    cur.execute("SELECT difficulty, COUNT(*) AS cnt FROM vocabulary GROUP BY difficulty")
    by_difficulty = {r["difficulty"]: r["cnt"] for r in cur.fetchall()}

    cur.execute(
        "SELECT group_name, difficulty, COUNT(*) AS cnt FROM vocabulary GROUP BY group_name, difficulty"
    )
    by_book: dict = {}
    for row in cur.fetchall():
        gname = row["group_name"]
        diff  = row["difficulty"]
        cnt   = row["cnt"]
        book  = extract_book(gname)
        if book not in by_book:
            by_book[book] = {"total": 0, "NEW_WORD": 0, "EASY": 0, "MEDIUM": 0, "HARD": 0}
        by_book[book]["total"] += cnt
        if diff in by_book[book]:
            by_book[book][diff] += cnt

    cur.execute("SELECT * FROM vocabulary ORDER BY id DESC LIMIT 6")
    recent = [dict(r) for r in cur.fetchall()]

    cur.execute("SELECT LOWER(engWord) as eng FROM vocabulary")
    by_frequency: dict = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}
    for row in cur.fetchall():
        meta = WORD_FREQ.get(row["eng"])
        lvl = meta["frequency_level"] if meta else 5
        by_frequency[lvl] = by_frequency.get(lvl, 0) + 1

    conn.close()
    return {
        "total": total,
        "by_difficulty": by_difficulty,
        "by_frequency": by_frequency,
        "by_book": by_book,
        "recent": recent,
    }


# ── Progress & Rewards ────────────────────────────────────────────────────────

def _check_achievements(cur, today_str: str, learned_count: int,
                        sessions_count: int, streak: int) -> list:
    cur.execute("SELECT id FROM achievements")
    already = {r["id"] for r in cur.fetchall()}
    new_unlocked = []

    thresholds = {
        "words_10": learned_count >= 10,
        "words_50": learned_count >= 50,
        "words_100": learned_count >= 100,
        "words_500": learned_count >= 500,
        "words_1000": learned_count >= 1000,
        "sessions_5": sessions_count >= 5,
        "sessions_10": sessions_count >= 10,
        "sessions_50": sessions_count >= 50,
        "streak_3": streak >= 3,
        "streak_7": streak >= 7,
        "streak_30": streak >= 30,
    }

    for ach in ACHIEVEMENTS:
        if ach["id"] not in already and thresholds.get(ach["id"], False):
            cur.execute(
                "INSERT INTO achievements (id, unlocked_at, xp_awarded) VALUES (?, ?, ?)",
                (ach["id"], today_str, ach["xp"]),
            )
            cur.execute(
                "UPDATE user_progress SET total_xp = total_xp + ? WHERE id = 1",
                (ach["xp"],),
            )
            new_unlocked.append(ach)

    return new_unlocked


@app.post("/api/progress/record-answer")
def record_answer(body: RecordAnswerBody):
    today_str = date.today().isoformat()
    yesterday_str = (date.today() - timedelta(days=1)).isoformat()

    conn = get_db()
    cur = conn.cursor()

    xp_earned = 0
    newly_learned = False

    cur.execute("""
        INSERT INTO word_progress (word_id, correct_count, attempt_count, learned, last_attempt_date)
        VALUES (?, 0, 1, 0, ?)
        ON CONFLICT(word_id) DO UPDATE SET
            attempt_count = attempt_count + 1,
            last_attempt_date = excluded.last_attempt_date
    """, (body.word_id, today_str))

    if body.correct:
        xp_earned += XP_CORRECT_ANSWER

        cur.execute("""
            UPDATE word_progress
            SET correct_count = correct_count + 1
            WHERE word_id = ? AND learned = 0
        """, (body.word_id,))

        cur.execute(
            "SELECT correct_count, learned FROM word_progress WHERE word_id = ?",
            (body.word_id,),
        )
        wp = cur.fetchone()
        if wp and wp["correct_count"] >= LEARN_THRESHOLD and not wp["learned"]:
            newly_learned = True
            cur.execute(
                "UPDATE word_progress SET learned = 1, learned_at = ? WHERE word_id = ?",
                (today_str, body.word_id),
            )
            xp_earned += XP_NEW_WORD_LEARNED

    correct_int = 1 if body.correct else 0
    cur.execute("""
        INSERT INTO daily_activity (date, xp_earned, correct_answers, total_answers)
        VALUES (?, ?, ?, 1)
        ON CONFLICT(date) DO UPDATE SET
            xp_earned = xp_earned + excluded.xp_earned,
            correct_answers = correct_answers + excluded.correct_answers,
            total_answers = total_answers + 1
    """, (today_str, xp_earned, correct_int))

    cur.execute("UPDATE user_progress SET total_xp = total_xp + ? WHERE id = 1", (xp_earned,))

    cur.execute(
        "SELECT current_streak, longest_streak, last_activity_date FROM user_progress WHERE id = 1"
    )
    up = cur.fetchone()
    current_streak = up["current_streak"]
    longest_streak = up["longest_streak"]
    last_date = up["last_activity_date"]

    if last_date != today_str:
        if last_date == yesterday_str:
            current_streak += 1
        else:
            current_streak = 1
        longest_streak = max(longest_streak, current_streak)
        cur.execute("""
            UPDATE user_progress SET
                current_streak = ?,
                longest_streak = ?,
                last_activity_date = ?
            WHERE id = 1
        """, (current_streak, longest_streak, today_str))

    cur.execute("SELECT COUNT(*) as cnt FROM word_progress WHERE learned = 1")
    learned_count = cur.fetchone()["cnt"]
    cur.execute("SELECT COALESCE(SUM(sessions_completed), 0) as cnt FROM daily_activity")
    sessions_count = cur.fetchone()["cnt"]

    new_achievements = _check_achievements(cur, today_str, learned_count, sessions_count, current_streak)

    conn.commit()
    conn.close()

    return {
        "correct": body.correct,
        "newly_learned": newly_learned,
        "xp_earned": xp_earned,
        "new_achievements": new_achievements,
    }


@app.post("/api/progress/record-session")
def record_session(body: RecordSessionBody):
    today_str = date.today().isoformat()
    yesterday_str = (date.today() - timedelta(days=1)).isoformat()
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    now_str = now.isoformat()

    conn = get_db()
    cur = conn.cursor()

    word_count = len(set(body.word_ids))
    started_at = (
        (now - timedelta(seconds=body.duration_seconds)).isoformat()
        if body.duration_seconds else now_str
    )
    cur.execute("""
        INSERT INTO sessions
            (session_type, started_at, ended_at, word_count, correct_count, incorrect_count, duration_seconds)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (body.session_type, started_at, now_str, word_count,
          body.correct_count, body.incorrect_count, body.duration_seconds))

    for wid in set(body.word_ids):
        cur.execute(
            "INSERT INTO daily_words (date, word_id) VALUES (?, ?) ON CONFLICT DO NOTHING",
            (today_str, wid),
        )

    cur.execute("SELECT COUNT(*) as cnt FROM daily_words WHERE date = ?", (today_str,))
    unique_words_today = cur.fetchone()["cnt"]

    cur.execute("""
        INSERT INTO daily_activity (date, words_studied, sessions_completed, xp_earned)
        VALUES (?, ?, 1, ?)
        ON CONFLICT(date) DO UPDATE SET
            words_studied = ?,
            sessions_completed = sessions_completed + 1,
            xp_earned = xp_earned + ?
    """, (today_str, unique_words_today, XP_SESSION, unique_words_today, XP_SESSION))

    cur.execute("UPDATE user_progress SET total_xp = total_xp + ? WHERE id = 1", (XP_SESSION,))

    cur.execute(
        "SELECT current_streak, longest_streak, last_activity_date FROM user_progress WHERE id = 1"
    )
    up = cur.fetchone()
    current_streak = up["current_streak"]
    longest_streak = up["longest_streak"]
    last_date = up["last_activity_date"]

    if last_date != today_str:
        if last_date == yesterday_str:
            current_streak += 1
        else:
            current_streak = 1
        longest_streak = max(longest_streak, current_streak)
        cur.execute("""
            UPDATE user_progress SET
                current_streak = ?,
                longest_streak = ?,
                last_activity_date = ?
            WHERE id = 1
        """, (current_streak, longest_streak, today_str))

    cur.execute("SELECT COUNT(*) as cnt FROM word_progress WHERE learned = 1")
    learned_count = cur.fetchone()["cnt"]
    cur.execute("SELECT COALESCE(SUM(sessions_completed), 0) as cnt FROM daily_activity")
    sessions_count = cur.fetchone()["cnt"]

    new_achievements = _check_achievements(cur, today_str, learned_count, sessions_count, current_streak)

    conn.commit()
    conn.close()

    return {"xp_earned": XP_SESSION, "new_achievements": new_achievements}


@app.get("/api/progress")
def get_progress():
    conn = get_db()
    cur = conn.cursor()

    cur.execute("SELECT * FROM user_progress WHERE id = 1")
    up = dict(cur.fetchone())

    cur.execute("SELECT COUNT(*) as cnt FROM word_progress WHERE learned = 1")
    total_learned = cur.fetchone()["cnt"]

    cur.execute("SELECT LOWER(engWord) as eng, id FROM vocabulary")
    all_vocab = {r["eng"]: r["id"] for r in cur.fetchall()}

    cur.execute("SELECT word_id FROM word_progress WHERE learned = 1")
    learned_ids = {r["word_id"] for r in cur.fetchall()}

    by_freq: dict = {
        lvl: {"learned": 0, "total": 0, "label": FREQ_LABELS[lvl]}
        for lvl in range(1, 6)
    }
    for eng, wid in all_vocab.items():
        lvl = WORD_FREQ.get(eng, {}).get("frequency_level", 5)
        by_freq[lvl]["total"] += 1
        if wid in learned_ids:
            by_freq[lvl]["learned"] += 1

    cur.execute("SELECT COALESCE(SUM(sessions_completed), 0) as cnt FROM daily_activity")
    total_sessions = cur.fetchone()["cnt"]

    cur.execute("""
        SELECT date, words_studied, sessions_completed, xp_earned
        FROM daily_activity
        ORDER BY date DESC
        LIMIT 30
    """)
    daily_activity = [dict(r) for r in cur.fetchall()]

    today_str = date.today().isoformat()
    cur.execute("SELECT * FROM daily_activity WHERE date = ?", (today_str,))
    today_row = cur.fetchone()
    today_activity = (
        dict(today_row)
        if today_row
        else {"date": today_str, "words_studied": 0, "sessions_completed": 0, "xp_earned": 0}
    )

    cur.execute("SELECT id FROM achievements")
    unlocked_ids = {r["id"] for r in cur.fetchall()}
    all_achievements = [
        {**ach, "unlocked": ach["id"] in unlocked_ids}
        for ach in ACHIEVEMENTS
    ]

    xp = up["total_xp"]
    level = 1 + int(math.sqrt(xp / 50)) if xp > 0 else 1
    xp_for_level = 50 * (level - 1) ** 2
    xp_for_next = 50 * level ** 2
    xp_progress = xp - xp_for_level
    xp_needed = xp_for_next - xp_for_level

    conn.close()

    return {
        "total_xp": xp,
        "level": level,
        "xp_progress": xp_progress,
        "xp_needed": xp_needed,
        "daily_goal": up["daily_goal"],
        "current_streak": up["current_streak"],
        "longest_streak": up["longest_streak"],
        "last_activity_date": up["last_activity_date"],
        "total_learned": total_learned,
        "total_sessions": total_sessions,
        "by_frequency": by_freq,
        "daily_activity": daily_activity,
        "today": today_activity,
        "achievements": all_achievements,
    }


@app.patch("/api/progress/daily-goal")
def patch_daily_goal(body: DailyGoalBody):
    if body.daily_goal < 1 or body.daily_goal > 200:
        raise HTTPException(400, "daily_goal must be between 1 and 200")
    conn = get_db()
    cur = conn.cursor()
    cur.execute("UPDATE user_progress SET daily_goal = ? WHERE id = 1", (body.daily_goal,))
    conn.commit()
    conn.close()
    return {"daily_goal": body.daily_goal}


@app.get("/api/progress/difficulty-tracking")
def get_difficulty_tracking():
    conn = get_db()
    cur = conn.cursor()

    _date_col = "started_at::date" if IS_POSTGRES else "DATE(started_at)"

    cur.execute(f"""
        SELECT
            da.date,
            da.words_studied,
            CASE WHEN COALESCE(s.total_correct, 0) + COALESCE(s.total_incorrect, 0) > 0
                 THEN ROUND(CAST(s.total_correct AS FLOAT) / (s.total_correct + s.total_incorrect) * 100)
                 ELSE NULL END AS accuracy_pct,
            COALESCE(dh.easy,   0) AS easy,
            COALESCE(dh.medium, 0) AS medium,
            COALESCE(s.total_duration, 0) AS total_duration_seconds,
            COALESCE(s.session_count,  0) AS session_count
        FROM daily_activity da
        LEFT JOIN (
            SELECT date,
                   SUM(CASE WHEN difficulty = 'EASY'   THEN 1 ELSE 0 END) AS easy,
                   SUM(CASE WHEN difficulty = 'MEDIUM' THEN 1 ELSE 0 END) AS medium
            FROM difficulty_history
            WHERE difficulty IN ('EASY', 'MEDIUM')
            GROUP BY date
        ) dh ON dh.date = da.date
        LEFT JOIN (
            SELECT {_date_col} AS date,
                   SUM(COALESCE(duration_seconds, 0)) AS total_duration,
                   COUNT(*) AS session_count,
                   SUM(COALESCE(correct_count, 0)) AS total_correct,
                   SUM(COALESCE(incorrect_count, 0)) AS total_incorrect
            FROM sessions
            GROUP BY {_date_col}
        ) s ON s.date = da.date
        ORDER BY da.date DESC
        LIMIT 60
    """)
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows


@app.get("/api/sessions")
def get_sessions(limit: int = Query(50, ge=1, le=1000)):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        SELECT id, session_type, started_at, ended_at,
               word_count, correct_count, incorrect_count, duration_seconds
        FROM sessions
        ORDER BY started_at DESC
        LIMIT ?
    """, (limit,))
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows


@app.get("/api/progress/weak-words")
def get_weak_words():
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        SELECT
            v.id, v.engWord, v.hebWord, v.difficulty, v.group_name,
            wp.correct_count,
            wp.attempt_count,
            ROUND(CAST(wp.correct_count AS FLOAT) / wp.attempt_count * 100) AS accuracy_pct,
            wp.last_attempt_date
        FROM word_progress wp
        JOIN vocabulary v ON v.id = wp.word_id
        WHERE wp.attempt_count >= 3
          AND CAST(wp.correct_count AS FLOAT) / wp.attempt_count < 0.6
        ORDER BY CAST(wp.correct_count AS FLOAT) / wp.attempt_count ASC
        LIMIT 30
    """)
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows


@app.get("/api/progress/trends")
def get_trends(period: str = "weekly"):
    conn = get_db()
    cur = conn.cursor()
    if period == "monthly":
        group_expr = "to_char(date::date, 'YYYY-MM')" if IS_POSTGRES else "strftime('%Y-%m', date)"
        limit = 6
    else:
        group_expr = "to_char(date::date, 'IYYY-IW')" if IS_POSTGRES else "strftime('%Y-W%W', date)"
        limit = 12
    cur.execute(f"""
        SELECT
            {group_expr} AS period,
            MIN(da.date) AS period_start,
            SUM(da.words_studied)      AS words,
            SUM(da.sessions_completed) AS sessions,
            SUM(da.xp_earned)          AS xp,
            CASE WHEN COALESCE(SUM(s.correct_count), 0) + COALESCE(SUM(s.incorrect_count), 0) > 0
                 THEN ROUND(CAST(SUM(s.correct_count) AS FLOAT) / (SUM(s.correct_count) + SUM(s.incorrect_count)) * 100)
                 ELSE NULL END AS accuracy_pct
        FROM daily_activity da
        LEFT JOIN sessions s ON {group_expr if not IS_POSTGRES else "to_char(s.started_at::date, 'IYYY-IW')" if period != "monthly" else "to_char(s.started_at::date, 'YYYY-MM')"} = {group_expr}
        GROUP BY {group_expr}
        ORDER BY period DESC
        LIMIT {limit}
    """)
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return list(reversed(rows))


@app.get("/api/stats/freq-difficulty")
def get_stats_freq_difficulty():
    conn = get_db()
    cur  = conn.cursor()
    cur.execute("SELECT LOWER(engWord) AS eng, difficulty FROM vocabulary")

    DIFFS   = ["NEW_WORD", "EASY", "MEDIUM", "HARD"]
    matrix  = {lvl: {d: 0 for d in DIFFS} for lvl in range(1, 6)}

    for row in cur.fetchall():
        lvl  = WORD_FREQ.get(row["eng"], {}).get("frequency_level", 5)
        diff = row["difficulty"]
        if lvl in matrix and diff in matrix[lvl]:
            matrix[lvl][diff] += 1

    conn.close()
    return [
        {
            "freq_level": lvl,
            "label":      FREQ_LABELS[lvl],
            "NEW_WORD":   matrix[lvl]["NEW_WORD"],
            "EASY":       matrix[lvl]["EASY"],
            "MEDIUM":     matrix[lvl]["MEDIUM"],
            "HARD":       matrix[lvl]["HARD"],
            "total":      sum(matrix[lvl].values()),
        }
        for lvl in range(1, 6)
    ]


@app.get("/api/stats/performance")
def get_stats_performance():
    conn = get_db()
    cur = conn.cursor()

    cur.execute("""
        SELECT
            v.difficulty,
            COUNT(v.id) AS total_words,
            COUNT(CASE WHEN wp.attempt_count > 0 THEN 1 END) AS attempted_words,
            COALESCE(SUM(wp.correct_count), 0) AS total_correct,
            COALESCE(SUM(wp.attempt_count), 0) AS total_attempts
        FROM vocabulary v
        LEFT JOIN word_progress wp ON wp.word_id = v.id
        GROUP BY v.difficulty
    """)
    by_difficulty = [dict(r) for r in cur.fetchall()]

    cur.execute("""
        SELECT
            session_type,
            COUNT(*) AS session_count,
            SUM(correct_count) AS total_correct,
            SUM(correct_count + incorrect_count) AS total_attempts,
            ROUND(AVG(CASE WHEN duration_seconds > 0 THEN duration_seconds END)) AS avg_duration
        FROM sessions
        GROUP BY session_type
        ORDER BY session_count DESC
    """)
    by_session_type = [dict(r) for r in cur.fetchall()]

    cur.execute("""
        SELECT v.engWord, v.hebWord, v.difficulty,
               wp.correct_count, wp.attempt_count,
               ROUND(100.0 * wp.correct_count / wp.attempt_count, 1) AS accuracy
        FROM vocabulary v
        JOIN word_progress wp ON wp.word_id = v.id
        WHERE wp.attempt_count >= 5
        ORDER BY accuracy DESC, wp.attempt_count DESC
        LIMIT 5
    """)
    best_words = [dict(r) for r in cur.fetchall()]

    cur.execute("""
        SELECT v.engWord, v.hebWord, v.difficulty,
               wp.correct_count, wp.attempt_count,
               ROUND(100.0 * wp.correct_count / wp.attempt_count, 1) AS accuracy
        FROM vocabulary v
        JOIN word_progress wp ON wp.word_id = v.id
        WHERE wp.attempt_count >= 5
        ORDER BY accuracy ASC, wp.attempt_count DESC
        LIMIT 5
    """)
    worst_words = [dict(r) for r in cur.fetchall()]

    cur.execute("SELECT COUNT(*) AS cnt FROM vocabulary WHERE examples IS NOT NULL AND examples != ''")
    words_with_examples = cur.fetchone()["cnt"]

    cur.execute("SELECT COUNT(*) AS cnt FROM vocabulary WHERE image_url IS NOT NULL AND image_url != ''")
    words_with_images = cur.fetchone()["cnt"]

    cur.execute("""
        SELECT COUNT(*) AS cnt FROM vocabulary v
        LEFT JOIN word_progress wp ON wp.word_id = v.id
        WHERE wp.attempt_count IS NULL OR wp.attempt_count = 0
    """)
    words_never_attempted = cur.fetchone()["cnt"]

    conn.close()
    return {
        "by_difficulty":         by_difficulty,
        "by_session_type":       by_session_type,
        "best_words":            best_words,
        "worst_words":           worst_words,
        "words_with_examples":   words_with_examples,
        "words_with_images":     words_with_images,
        "words_never_attempted": words_never_attempted,
    }


@app.get("/api/stats/difficulty-timeline")
def get_difficulty_timeline():
    conn = get_db()
    cur = conn.cursor()

    cur.execute("SELECT id FROM vocabulary")
    all_ids = [r["id"] for r in cur.fetchall()]

    cur.execute(
        "SELECT date, word_id, difficulty FROM difficulty_history ORDER BY date ASC, id ASC"
    )
    history = [dict(r) for r in cur.fetchall()]

    cur.execute("SELECT id, difficulty FROM vocabulary")
    vocab_diff = {r["id"]: r["difficulty"] for r in cur.fetchall()}
    conn.close()

    if not history:
        return []

    history_word_ids = {h["word_id"] for h in history}

    current = {
        wid: ("NEW_WORD" if wid in history_word_ids else vocab_diff.get(wid, "NEW_WORD"))
        for wid in all_ids
    }

    result = []
    i = 0
    while i < len(history):
        date_str = history[i]["date"]
        while i < len(history) and history[i]["date"] == date_str:
            current[history[i]["word_id"]] = history[i]["difficulty"]
            i += 1
        counts = {"NEW_WORD": 0, "EASY": 0, "MEDIUM": 0, "HARD": 0}
        for diff in current.values():
            if diff in counts:
                counts[diff] += 1
        result.append({"date": date_str, **counts})

    return result


@app.get("/api/stats/velocity")
def get_stats_velocity():
    today = date.today()
    bins = []
    for i in range(11, -1, -1):
        week_end   = today - timedelta(weeks=i)
        week_start = week_end - timedelta(days=6)
        bins.append({
            "label":   week_start.strftime("%b %d"),
            "start":   week_start.isoformat(),
            "end":     week_end.isoformat(),
            "learned": 0,
        })

    conn = get_db()
    cur  = conn.cursor()
    cutoff = bins[0]["start"]
    cur.execute("""
        SELECT learned_at FROM word_progress
        WHERE learned = 1 AND learned_at IS NOT NULL AND learned_at >= ?
    """, (cutoff,))
    for row in cur.fetchall():
        la = row["learned_at"][:10]
        for b in bins:
            if b["start"] <= la <= b["end"]:
                b["learned"] += 1
                break
    conn.close()
    return [{"label": b["label"], "learned": b["learned"]} for b in bins]


@app.get("/api/stats/habits")
def get_stats_habits():
    conn = get_db()
    cur  = conn.cursor()

    _dow_col = "EXTRACT(DOW FROM started_at::timestamp)::integer" if IS_POSTGRES else "CAST(strftime('%w', started_at) AS INTEGER)"

    cur.execute(f"""
        SELECT
            {_dow_col} AS dow,
            COUNT(*) AS session_count,
            COALESCE(SUM(correct_count + incorrect_count), 0) AS total_answers
        FROM sessions
        WHERE started_at IS NOT NULL
        GROUP BY {_dow_col}
    """)
    dow_map = {r["dow"]: dict(r) for r in cur.fetchall()}
    DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    by_dow = [
        {
            "dow":      i,
            "label":    DOW_LABELS[i],
            "sessions": dow_map.get(i, {}).get("session_count", 0),
            "answers":  dow_map.get(i, {}).get("total_answers", 0) or 0,
        }
        for i in range(7)
    ]

    cur.execute("""
        SELECT COALESCE(SUM(duration_seconds), 0) AS total_secs FROM sessions
        WHERE duration_seconds IS NOT NULL
    """)
    total_seconds = cur.fetchone()["total_secs"] or 0

    cur.execute("SELECT COUNT(*) AS cnt FROM sessions")
    total_sessions = cur.fetchone()["cnt"]

    cur.execute("""
        SELECT COUNT(DISTINCT date) AS cnt FROM daily_activity WHERE words_studied > 0
    """)
    days_active = cur.fetchone()["cnt"]

    conn.close()
    return {
        "by_dow":        by_dow,
        "total_seconds": total_seconds,
        "total_sessions": total_sessions,
        "days_active":   days_active,
    }


# ── Roadmap / Progression System ─────────────────────────────────────────────

def init_roadmap_db():
    conn = get_db()
    cur = conn.cursor()

    cur.execute("""CREATE TABLE IF NOT EXISTS roadmap_groups (
        id INTEGER PRIMARY KEY,
        group_name TEXT UNIQUE NOT NULL,
        word_count INTEGER DEFAULT 0
    )""")
    cur.execute("""CREATE TABLE IF NOT EXISTS user_group_progress (
        group_id INTEGER PRIMARY KEY,
        is_completed INTEGER DEFAULT 0,
        best_score REAL DEFAULT 0.0,
        last_attempt_score REAL,
        completed_at TEXT
    )""")
    cur.execute(f"""CREATE TABLE IF NOT EXISTS roadmap_missions (
        id {_AI_PK},
        mission_type TEXT NOT NULL,
        related_group_ids TEXT NOT NULL,
        word_pool_ids TEXT NOT NULL,
        required_score REAL NOT NULL,
        is_completed INTEGER DEFAULT 0,
        attempts_count INTEGER DEFAULT 0,
        best_score REAL DEFAULT 0.0,
        created_at TEXT,
        completed_at TEXT
    )""")

    cur.execute("SELECT COUNT(*) AS cnt FROM roadmap_groups")
    existing = cur.fetchone()["cnt"]

    if existing == 0:
        cur.execute(
            "SELECT group_name, COUNT(*) as wc FROM vocabulary GROUP BY group_name"
        )
        groups_raw = cur.fetchall()
        sorted_groups = sorted(groups_raw, key=lambda r: natural_sort_key(r["group_name"]))
        for i, row in enumerate(sorted_groups, 1):
            cur.execute(
                "INSERT INTO roadmap_groups (id, group_name, word_count) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
                (i, row["group_name"], row["wc"]),
            )
            cur.execute(
                "INSERT INTO user_group_progress (group_id) VALUES (?) ON CONFLICT DO NOTHING", (i,)
            )
    conn.commit()
    conn.close()


def _roadmap_row(row) -> dict:
    d = dict(row)
    d["related_group_ids"] = _json.loads(d["related_group_ids"])
    d["word_pool_ids"] = _json.loads(d["word_pool_ids"])
    return d


def _build_word_pool(conn, group_ids: list) -> list:
    ids = []
    for gid in group_ids:
        row = conn.execute("SELECT group_name FROM roadmap_groups WHERE id = ?", (gid,)).fetchone()
        if row:
            ids.extend(
                r["id"] for r in conn.execute(
                    "SELECT id FROM vocabulary WHERE group_name = ? ORDER BY id", (row["group_name"],)
                ).fetchall()
            )
    return ids


def _create_mission(conn, mission_type: str, group_ids: list) -> dict:
    word_ids = _build_word_pool(conn, group_ids)
    required = 0.95 if mission_type == "group" else 0.90
    now = datetime.now(timezone.utc).isoformat()

    insert_sql = """INSERT INTO roadmap_missions
           (mission_type, related_group_ids, word_pool_ids, required_score, created_at)
           VALUES (?, ?, ?, ?, ?)"""
    insert_params = (mission_type, _json.dumps(sorted(group_ids)), _json.dumps(word_ids), required, now)

    if IS_POSTGRES:
        cur = conn.execute(insert_sql + " RETURNING id", insert_params)
        new_id = cur.fetchone()["id"]
    else:
        cur = conn.execute(insert_sql, insert_params)
        new_id = cur._c.lastrowid

    conn.commit()
    return _roadmap_row(
        conn.execute("SELECT * FROM roadmap_missions WHERE id = ?", (new_id,)).fetchone()
    )


def _resolve_current_mission(conn) -> Optional[dict]:
    row = conn.execute(
        "SELECT * FROM roadmap_missions WHERE is_completed = 0 ORDER BY id LIMIT 1"
    ).fetchone()
    if row:
        return _roadmap_row(row)

    total = conn.execute("SELECT COUNT(*) AS cnt FROM roadmap_groups").fetchone()["cnt"]
    if total == 0:
        return None

    done_ids = [
        r["group_id"]
        for r in conn.execute(
            "SELECT group_id FROM user_group_progress WHERE is_completed = 1 ORDER BY group_id"
        ).fetchall()
    ]
    n = len(done_ids)

    if n > 0 and n % 3 == 0:
        last3 = done_ids[-3:]
        mini_done = conn.execute(
            "SELECT id FROM roadmap_missions WHERE mission_type = 'checkpoint_3' AND is_completed = 1 AND related_group_ids = ?",
            (_json.dumps(sorted(last3)),),
        ).fetchone()
        if not mini_done:
            return _create_mission(conn, "checkpoint_3", last3)

        if n % 9 == 0:
            major_done = conn.execute(
                "SELECT id FROM roadmap_missions WHERE mission_type = 'checkpoint_9' AND is_completed = 1 AND related_group_ids = ?",
                (_json.dumps(sorted(done_ids)),),
            ).fetchone()
            if not major_done:
                return _create_mission(conn, "checkpoint_9", done_ids)

    next_id = n + 1
    if next_id > total:
        return None
    return _create_mission(conn, "group", [next_id])


init_roadmap_db()


class MissionAttemptBody(BaseModel):
    score: float
    correct_count: int
    total_count: int


@app.get("/api/roadmap/state")
def get_roadmap_state():
    conn = get_db()
    groups = [
        dict(r)
        for r in conn.execute("""
            SELECT rg.id, rg.group_name, rg.word_count,
                   COALESCE(ugp.is_completed, 0)  AS is_completed,
                   COALESCE(ugp.best_score, 0.0)  AS best_score,
                   ugp.last_attempt_score, ugp.completed_at
            FROM roadmap_groups rg
            LEFT JOIN user_group_progress ugp ON ugp.group_id = rg.id
            ORDER BY rg.id
        """).fetchall()
    ]
    missions = [
        _roadmap_row(r)
        for r in conn.execute("SELECT * FROM roadmap_missions ORDER BY id").fetchall()
    ]
    active = conn.execute(
        "SELECT * FROM roadmap_missions WHERE is_completed = 0 ORDER BY id LIMIT 1"
    ).fetchone()
    conn.close()
    return {
        "groups": groups,
        "missions": missions,
        "current_mission": _roadmap_row(active) if active else None,
    }


@app.get("/api/roadmap/current-mission")
def get_current_mission():
    conn = get_db()
    mission = _resolve_current_mission(conn)
    conn.close()
    return mission


@app.get("/api/roadmap/missions/{mission_id}/quiz")
def get_mission_quiz(mission_id: int, direction: str = "eng_to_heb"):
    conn = get_db()
    row = conn.execute("SELECT * FROM roadmap_missions WHERE id = ?", (mission_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Mission not found")

    mission = _roadmap_row(row)
    pool = mission["word_pool_ids"]
    quiz_size = {"group": len(pool), "checkpoint_3": 40, "checkpoint_9": 100}
    count = min(quiz_size.get(mission["mission_type"], 40), len(pool))
    selected = random.sample(pool, count)

    placeholders = ",".join(["?"] * len(selected))
    words = [
        dict(r)
        for r in conn.execute(
            f"SELECT * FROM vocabulary WHERE id IN ({placeholders})", selected
        ).fetchall()
    ]
    distractor_pool = [
        dict(r)
        for r in conn.execute(
            "SELECT hebWord, engWord FROM vocabulary ORDER BY RANDOM() LIMIT 300"
        ).fetchall()
    ]
    conn.close()

    questions = []
    for word in words:
        q_text = word["engWord"] if direction == "eng_to_heb" else word["hebWord"]
        correct = word["hebWord"] if direction == "eng_to_heb" else word["engWord"]
        d_field = "hebWord" if direction == "eng_to_heb" else "engWord"
        distractors = list({p[d_field] for p in distractor_pool if p[d_field] != correct})
        random.shuffle(distractors)
        options = distractors[:3] + [correct]
        random.shuffle(options)
        questions.append({"id": word["id"], "question": q_text, "correct": correct, "options": options, "accepted": _split_translations(correct), "word": word})

    random.shuffle(questions)
    return {"questions": questions, "mission": mission}


@app.post("/api/roadmap/missions/{mission_id}/attempt")
def submit_mission_attempt(mission_id: int, body: MissionAttemptBody):
    conn = get_db()
    row = conn.execute("SELECT * FROM roadmap_missions WHERE id = ?", (mission_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Mission not found")

    mission = _roadmap_row(row)
    if mission["is_completed"]:
        conn.close()
        return {"passed": True, "score": mission["best_score"], "next_mission": None}

    score = body.score
    passed = score >= mission["required_score"]
    now = datetime.now(timezone.utc).isoformat()
    new_attempts = mission["attempts_count"] + 1
    new_best = max(mission["best_score"], score)

    if passed:
        conn.execute(
            "UPDATE roadmap_missions SET is_completed=1, attempts_count=?, best_score=?, completed_at=? WHERE id=?",
            (new_attempts, new_best, now, mission_id),
        )
        if mission["mission_type"] == "group":
            gid = mission["related_group_ids"][0]
            conn.execute(
                "UPDATE user_group_progress SET is_completed=1, best_score=?, last_attempt_score=?, completed_at=? WHERE group_id=?",
                (score, score, now, gid),
            )
        conn.commit()
        next_m = _resolve_current_mission(conn)
        conn.close()
        return {"passed": True, "score": score, "next_mission": next_m}
    else:
        conn.execute(
            "UPDATE roadmap_missions SET attempts_count=?, best_score=? WHERE id=?",
            (new_attempts, new_best, mission_id),
        )
        if mission["mission_type"] == "group":
            gid = mission["related_group_ids"][0]
            conn.execute(
                "UPDATE user_group_progress SET last_attempt_score=? WHERE group_id=?",
                (score, gid),
            )
        conn.commit()
        conn.close()
        return {"passed": False, "score": score, "next_mission": None}


@app.post("/api/roadmap/restart")
def restart_roadmap():
    conn = get_db()
    conn.execute("DELETE FROM roadmap_missions")
    conn.execute("DELETE FROM user_group_progress")
    conn.execute("DELETE FROM roadmap_groups")

    groups_raw = conn.execute(
        "SELECT group_name, COUNT(*) as wc FROM vocabulary GROUP BY group_name"
    ).fetchall()
    sorted_groups = sorted(groups_raw, key=lambda r: natural_sort_key(r["group_name"]))
    for i, row in enumerate(sorted_groups, 1):
        conn.execute(
            "INSERT INTO roadmap_groups (id, group_name, word_count) VALUES (?, ?, ?)",
            (i, row["group_name"], row["wc"]),
        )
        conn.execute(
            "INSERT INTO user_group_progress (group_id) VALUES (?)", (i,)
        )

    conn.commit()
    first_mission = _resolve_current_mission(conn)
    total = conn.execute("SELECT COUNT(*) AS cnt FROM roadmap_groups").fetchone()["cnt"]
    conn.close()
    return {"groups_total": total, "first_mission": first_mission}
