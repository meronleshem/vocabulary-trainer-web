import os
import re
import math
import random
import sqlite3
from datetime import date, datetime, timedelta, timezone
from typing import List, Optional
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import requests
from bs4 import BeautifulSoup

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "Database", "vocabulary.db")
IMAGES_DIR = os.path.join(os.path.dirname(__file__), "..", "Images")
WORD_FREQ_PATH = os.path.join(os.path.dirname(__file__), "..", "Database", "word_frequency.json")

# ---------------------------------------------------------------------------
# Word-frequency data — loaded once at startup.
# Format: { "word": { "rank": int, "frequency_level": int, "frequency_label": str } }
# ---------------------------------------------------------------------------
import json as _json

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
    cur.executescript("""
        CREATE TABLE IF NOT EXISTS user_progress (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            total_xp INTEGER NOT NULL DEFAULT 0,
            daily_goal INTEGER NOT NULL DEFAULT 10,
            current_streak INTEGER NOT NULL DEFAULT 0,
            longest_streak INTEGER NOT NULL DEFAULT 0,
            last_activity_date TEXT DEFAULT NULL
        );
        INSERT OR IGNORE INTO user_progress (id) VALUES (1);

        CREATE TABLE IF NOT EXISTS word_progress (
            word_id INTEGER PRIMARY KEY,
            correct_count INTEGER NOT NULL DEFAULT 0,
            attempt_count INTEGER NOT NULL DEFAULT 0,
            learned INTEGER NOT NULL DEFAULT 0,
            learned_at TEXT DEFAULT NULL,
            last_attempt_date TEXT DEFAULT NULL
        );

        CREATE TABLE IF NOT EXISTS daily_activity (
            date TEXT PRIMARY KEY,
            words_studied INTEGER NOT NULL DEFAULT 0,
            sessions_completed INTEGER NOT NULL DEFAULT 0,
            xp_earned INTEGER NOT NULL DEFAULT 0,
            correct_answers INTEGER NOT NULL DEFAULT 0,
            total_answers INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS achievements (
            id TEXT PRIMARY KEY,
            unlocked_at TEXT NOT NULL,
            xp_awarded INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS daily_words (
            date TEXT NOT NULL,
            word_id INTEGER NOT NULL,
            PRIMARY KEY (date, word_id)
        );

        CREATE TABLE IF NOT EXISTS difficulty_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            word_id INTEGER NOT NULL,
            difficulty TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_type TEXT NOT NULL,
            started_at TEXT NOT NULL,
            ended_at TEXT,
            word_count INTEGER NOT NULL DEFAULT 0,
            correct_count INTEGER NOT NULL DEFAULT 0,
            incorrect_count INTEGER NOT NULL DEFAULT 0,
            duration_seconds INTEGER DEFAULT NULL
        );
    """)
    # Migrate existing databases — add columns that may not exist yet.
    # SQLite does not support ADD COLUMN IF NOT EXISTS, so we try each and ignore errors.
    migrations = [
        "ALTER TABLE word_progress ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE word_progress ADD COLUMN last_attempt_date TEXT DEFAULT NULL",
        "ALTER TABLE daily_activity ADD COLUMN correct_answers INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE daily_activity ADD COLUMN total_answers INTEGER NOT NULL DEFAULT 0",
        # SRS columns
        "ALTER TABLE word_progress ADD COLUMN srs_interval INTEGER NOT NULL DEFAULT 1",
        "ALTER TABLE word_progress ADD COLUMN srs_easiness REAL NOT NULL DEFAULT 2.5",
        "ALTER TABLE word_progress ADD COLUMN srs_repetitions INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE word_progress ADD COLUMN srs_next_review TEXT DEFAULT NULL",
        # Weak-word tracking
        "ALTER TABLE word_progress ADD COLUMN weak_count INTEGER NOT NULL DEFAULT 0",
    ]
    for sql in migrations:
        try:
            cur.execute(sql)
        except Exception:
            pass  # Column already exists
    conn.commit()
    conn.close()


app = FastAPI(title="VocabularyApp API", version="1.0.0")

app.mount("/api/images", StaticFiles(directory=IMAGES_DIR), name="images")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5174", "http://127.0.0.1:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


# Initialise progress tables on startup (idempotent).
# Deferred to after get_db() is defined.
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
    vocab_words = [
        r["eng"]
        for r in conn_tmp.execute("SELECT LOWER(engWord) as eng FROM vocabulary").fetchall()
    ]
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

    # Each part-of-speech block lives in a Translation_content_enTohe div.
    # Inside it: Translation_divTop_enTohe (contains the POS label)
    #            translation_bottom_container > Translation_divMiddle_enTohe > normal_translation_div
    heb_parts = []
    content_blocks = soup.find_all("div", class_="Translation_content_enTohe")
    for block in content_blocks:
        # Extract POS label (e.g. "verb", "noun")
        top = block.find("div", class_="Translation_divTop_enTohe")
        pos = ""
        if top:
            # The POS text is mixed with other text; grab only the first word after the eng word
            top_text = top.get_text(separator=" ", strip=True)
            # Format: "wane verb Save Add to…" — take the token right after the eng word
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

    # Examples — take from the first block that has them
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


class SRSReviewBody(BaseModel):
    word_id: int
    quality: int  # 0=Again, 1=Hard (wrong), 3=Good, 5=Easy  (SM-2 scale 0-5)


# ── SM-2 algorithm ───────────────────────────────────────────────────────────

def _sm2(interval: int, easiness: float, repetitions: int, quality: int):
    """
    One SM-2 review step.
    quality: 0=blackout/Again, 1=wrong, 2=wrong-but-familiar,
             3=correct-hard, 4=correct, 5=perfect/Easy
    Returns (new_repetitions, new_interval, new_easiness, next_review_date_str)
    """
    if quality < 3:
        new_repetitions = 0
        new_interval = 1
    else:
        new_repetitions = repetitions + 1
        if repetitions == 0:
            new_interval = 1
        elif repetitions == 1:
            new_interval = 6
        else:
            new_interval = max(1, round(interval * easiness))

    ef = easiness + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
    new_easiness = max(1.3, ef)

    next_date = (date.today() + timedelta(days=new_interval)).isoformat()
    return new_repetitions, new_interval, new_easiness, next_date


# Difficulty → SM-2 quality mapping (used when flashcard is rated)
DIFF_TO_QUALITY = {"EASY": 5, "MEDIUM": 3, "HARD": 1, "DONT_KNOW": 0}


# ── Words ────────────────────────────────────────────────────────────────────

@app.get("/api/word-frequency")
def get_word_frequency(
    frequency_level: List[int] = Query(default=[]),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
):
    """
    Return words from the frequency dictionary, optionally filtered by
    one or more frequency levels (1–5).  Sorted by rank ascending.
    """
    if not WORD_FREQ:
        raise HTTPException(503, "Word frequency data not available")

    valid_levels = {1, 2, 3, 4, 5}
    for lvl in frequency_level:
        if lvl not in valid_levels:
            raise HTTPException(400, f"Invalid frequency_level: {lvl}. Must be 1–5.")

    # Build the filtered list, sorted by rank
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

    # Frequency filter — classify each vocabulary word and keep only matches.
    # Words absent from the frequency file are Rare (level 5).
    if frequency_level:
        selected = set(frequency_level)
        conn_tmp = get_db()
        vocab_words = [
            r["eng"]
            for r in conn_tmp.execute("SELECT LOWER(engWord) as eng FROM vocabulary").fetchall()
        ]
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
    cur.execute(f"SELECT COUNT(*) FROM vocabulary{where}", params)
    total = cur.fetchone()[0]

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

    # Fetch pool for distractors
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

    # Distractor pool: random english words
    cur.execute("SELECT engWord FROM vocabulary ORDER BY RANDOM() LIMIT 200")
    pool = [r["engWord"] for r in cur.fetchall()]
    conn.close()

    questions = []
    for word in words_raw:
        eng = word["engWord"]
        # Pick a random example line that actually contains the word
        lines = [l.strip() for l in word["examples"].split("\n") if l.strip()]
        matching = [l for l in lines if re.search(re.escape(eng), l, re.IGNORECASE)]
        if not matching:
            continue
        example_line = random.choice(matching)

        # Replace the word with ____
        sentence = re.sub(re.escape(eng), "____", example_line, flags=re.IGNORECASE)

        distractors = [w for w in pool if w.lower() != eng.lower()]
        distractors = list(dict.fromkeys(distractors))  # deduplicate, preserve order
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

    cur.execute(
        "INSERT INTO vocabulary (engWord, hebWord, examples, difficulty, group_name, image_url) VALUES (?,?,?,?,?,?)",
        (eng_lower, word.hebWord, word.examples or "", word.difficulty, word.group_name or "", word.image_url or ""),
    )
    conn.commit()
    cur.execute("SELECT * FROM vocabulary WHERE id = ?", (cur.lastrowid,))
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
    valid = {"EASY", "MEDIUM", "HARD", "NEW_WORD", "DONT_KNOW"}
    if body.difficulty not in valid:
        raise HTTPException(400, "Invalid difficulty value")
    conn = get_db()
    cur = conn.cursor()
    cur.execute("UPDATE vocabulary SET difficulty = ? WHERE id = ?", (body.difficulty, word_id))
    if cur.rowcount == 0:
        conn.close()
        raise HTTPException(404, "Word not found")
    today_str = date.today().isoformat()
    # Log every difficulty change to history
    cur.execute(
        "INSERT INTO difficulty_history (date, word_id, difficulty) VALUES (?, ?, ?)",
        (today_str, word_id, body.difficulty),
    )
    # Mark word as learned (seen) when explicitly rated — even DONT_KNOW
    if body.difficulty in {"EASY", "MEDIUM", "HARD", "DONT_KNOW"}:
        # DONT_KNOW gets no correct_count credit; others get LEARN_THRESHOLD
        correct_credit = 0 if body.difficulty == "DONT_KNOW" else LEARN_THRESHOLD
        cur.execute("""
            INSERT INTO word_progress (word_id, correct_count, learned, learned_at)
            VALUES (?, ?, 1, ?)
            ON CONFLICT(word_id) DO UPDATE SET
                learned = 1,
                learned_at = COALESCE(word_progress.learned_at, excluded.learned_at),
                correct_count = MAX(word_progress.correct_count, excluded.correct_count)
        """, (word_id, correct_credit, today_str))

        # Increment weak_count when user explicitly marks HARD or DONT_KNOW
        if body.difficulty in {"HARD", "DONT_KNOW"}:
            cur.execute("""
                UPDATE word_progress
                SET weak_count = COALESCE(weak_count, 0) + 1
                WHERE word_id = ?
            """, (word_id,))

        # Apply SRS update based on difficulty rating
        quality = DIFF_TO_QUALITY[body.difficulty]
        cur.execute("""
            SELECT srs_interval, srs_easiness, srs_repetitions FROM word_progress WHERE word_id = ?
        """, (word_id,))
        srs_row = cur.fetchone()
        if srs_row:
            new_reps, new_int, new_ef, next_review = _sm2(
                srs_row["srs_interval"] or 1,
                srs_row["srs_easiness"] or 2.5,
                srs_row["srs_repetitions"] or 0,
                quality,
            )
            cur.execute("""
                UPDATE word_progress SET
                    srs_interval=?, srs_easiness=?, srs_repetitions=?, srs_next_review=?
                WHERE word_id=?
            """, (new_int, new_ef, new_reps, next_review, word_id))

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

    # Distractor pool — exclude the selected words
    cur.execute(
        f"SELECT id, engWord, hebWord, image_url FROM vocabulary "
        f"WHERE id NOT IN ({placeholders}) ORDER BY RANDOM() LIMIT 200",
        word_ids,
    )
    pool = [dict(r) for r in cur.fetchall()]
    conn.close()

    result = []
    for word in words:
        shuffled = random.sample(pool, len(pool))  # fresh shuffle per word

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

    # group_counts[group_name] = {total, EASY, MEDIUM, HARD, NEW_WORD}
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

    # Sort groups within each book by natural number order
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
    # Check the new name doesn't already exist
    cur.execute("SELECT COUNT(*) FROM vocabulary WHERE group_name = ?", (new_name,))
    if cur.fetchone()[0] > 0:
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

    cur.execute("SELECT COUNT(*) FROM vocabulary")
    total = cur.fetchone()[0]

    cur.execute("SELECT difficulty, COUNT(*) FROM vocabulary GROUP BY difficulty")
    by_difficulty = {r[0]: r[1] for r in cur.fetchall()}

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

    # Frequency breakdown — cross-reference engWords with word_frequency data
    cur.execute("SELECT LOWER(engWord) as eng FROM vocabulary")
    by_frequency: dict = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}
    for row in cur.fetchall():
        meta = WORD_FREQ.get(row["eng"])
        # Words not in the frequency list are rank 20001+, which is Rare (level 5)
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
    """Check all achievement conditions and unlock any that are newly met.
    Returns list of newly unlocked achievement dicts."""
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
    """Record one quiz answer. Awards XP, updates streak, checks achievements."""
    today_str = date.today().isoformat()
    yesterday_str = (date.today() - timedelta(days=1)).isoformat()

    conn = get_db()
    cur = conn.cursor()

    xp_earned = 0
    newly_learned = False

    # Always track the attempt (correct or wrong)
    cur.execute("""
        INSERT INTO word_progress (word_id, correct_count, attempt_count, learned, last_attempt_date)
        VALUES (?, 0, 1, 0, ?)
        ON CONFLICT(word_id) DO UPDATE SET
            attempt_count = attempt_count + 1,
            last_attempt_date = excluded.last_attempt_date
    """, (body.word_id, today_str))

    if body.correct:
        xp_earned += XP_CORRECT_ANSWER

        # Increment correct_count only while not yet learned
        cur.execute("""
            UPDATE word_progress
            SET correct_count = correct_count + 1
            WHERE word_id = ? AND learned = 0
        """, (body.word_id,))

        # Check if newly learned
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

    # Update daily XP + accuracy counters
    correct_int = 1 if body.correct else 0
    cur.execute("""
        INSERT INTO daily_activity (date, xp_earned, correct_answers, total_answers)
        VALUES (?, ?, ?, 1)
        ON CONFLICT(date) DO UPDATE SET
            xp_earned = xp_earned + excluded.xp_earned,
            correct_answers = correct_answers + excluded.correct_answers,
            total_answers = total_answers + 1
    """, (today_str, xp_earned, correct_int))

    # Always add XP
    cur.execute("UPDATE user_progress SET total_xp = total_xp + ? WHERE id = 1", (xp_earned,))

    # Update streak on first activity of a new day
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

    # SRS nudge: update next_review but don't advance srs_repetitions
    # (only the dedicated SRS Review session advances the repetition counter)
    q_srs = 4 if body.correct else 1
    cur.execute("""
        SELECT srs_interval, srs_easiness, srs_repetitions FROM word_progress WHERE word_id = ?
    """, (body.word_id,))
    srs_row = cur.fetchone()
    if srs_row:
        _, new_int, new_ef, next_review = _sm2(
            srs_row["srs_interval"] or 1,
            srs_row["srs_easiness"] or 2.5,
            srs_row["srs_repetitions"] or 0,
            q_srs,
        )
        cur.execute("""
            UPDATE word_progress SET srs_interval=?, srs_easiness=?, srs_next_review=?
            WHERE word_id=?
        """, (new_int, new_ef, next_review, body.word_id))

    # Check achievements
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
    """Record a completed study session. Awards XP and tracks unique words toward daily goal."""
    today_str = date.today().isoformat()
    yesterday_str = (date.today() - timedelta(days=1)).isoformat()
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    now_str = now.isoformat()

    conn = get_db()
    cur = conn.cursor()

    # Insert into sessions table
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

    # Insert unique (date, word_id) pairs — duplicates are silently ignored
    for wid in set(body.word_ids):
        cur.execute(
            "INSERT OR IGNORE INTO daily_words (date, word_id) VALUES (?, ?)",
            (today_str, wid),
        )

    # Count total unique words studied today
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

    # Update streak on first activity of a new day
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
    """Return full progress snapshot."""
    conn = get_db()
    cur = conn.cursor()

    cur.execute("SELECT * FROM user_progress WHERE id = 1")
    up = dict(cur.fetchone())

    # Learned word count
    cur.execute("SELECT COUNT(*) as cnt FROM word_progress WHERE learned = 1")
    total_learned = cur.fetchone()["cnt"]

    # Per-frequency learned breakdown
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

    # Sessions total
    cur.execute("SELECT COALESCE(SUM(sessions_completed), 0) as cnt FROM daily_activity")
    total_sessions = cur.fetchone()["cnt"]

    # Daily activity (last 30 days)
    cur.execute("""
        SELECT date, words_studied, sessions_completed, xp_earned
        FROM daily_activity
        ORDER BY date DESC
        LIMIT 30
    """)
    daily_activity = [dict(r) for r in cur.fetchall()]

    # Today's activity
    today_str = date.today().isoformat()
    cur.execute("SELECT * FROM daily_activity WHERE date = ?", (today_str,))
    today_row = cur.fetchone()
    today_activity = (
        dict(today_row)
        if today_row
        else {"date": today_str, "words_studied": 0, "sessions_completed": 0, "xp_earned": 0}
    )

    # Achievements
    cur.execute("SELECT id FROM achievements")
    unlocked_ids = {r["id"] for r in cur.fetchall()}
    all_achievements = [
        {**ach, "unlocked": ach["id"] in unlocked_ids}
        for ach in ACHIEVEMENTS
    ]

    # Level formula: level = 1 + floor(sqrt(xp / 50))
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
    """Return enriched per-day history: study counts, accuracy, session time, ranked words."""
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
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
            SELECT DATE(started_at) AS date,
                   SUM(COALESCE(duration_seconds, 0)) AS total_duration,
                   COUNT(*) AS session_count,
                   SUM(COALESCE(correct_count, 0)) AS total_correct,
                   SUM(COALESCE(incorrect_count, 0)) AS total_incorrect
            FROM sessions
            GROUP BY DATE(started_at)
        ) s ON s.date = da.date
        ORDER BY da.date DESC
        LIMIT 60
    """)
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows


@app.get("/api/sessions")
def get_sessions(limit: int = Query(50, ge=1, le=1000)):
    """Return past sessions, most recent first."""
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


@app.get("/api/progress/weak-words/count")
def get_weak_words_count():
    """Return the total count of words rated HARD or DONT_KNOW."""
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) as cnt FROM vocabulary WHERE difficulty IN ('HARD', 'DONT_KNOW')")
    count = cur.fetchone()["cnt"]
    conn.close()
    return {"count": count}


@app.get("/api/progress/weak-words")
def get_weak_words(
    kind: str = Query("all"),      # all | hard | dont_know
    sort_by: str = Query("weak_count"),  # weak_count | last_seen | difficulty
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """Return words rated HARD or DONT_KNOW, ordered by struggle frequency."""
    if kind == "hard":
        diff_clause = "v.difficulty = 'HARD'"
    elif kind == "dont_know":
        diff_clause = "v.difficulty = 'DONT_KNOW'"
    else:
        diff_clause = "v.difficulty IN ('HARD', 'DONT_KNOW')"

    if sort_by == "last_seen":
        order_clause = "wp.last_attempt_date DESC NULLS LAST, COALESCE(wp.weak_count, 0) DESC"
    elif sort_by == "difficulty":
        order_clause = "CASE v.difficulty WHEN 'DONT_KNOW' THEN 0 WHEN 'HARD' THEN 1 END, COALESCE(wp.weak_count, 0) DESC"
    else:
        order_clause = "COALESCE(wp.weak_count, 0) DESC, wp.last_attempt_date DESC NULLS LAST"

    conn = get_db()
    cur = conn.cursor()

    cur.execute(f"SELECT COUNT(*) as cnt FROM vocabulary v WHERE {diff_clause}")
    total = cur.fetchone()["cnt"]

    cur.execute(f"""
        SELECT
            v.id, v.engWord, v.hebWord, v.difficulty, v.group_name, v.image_url,
            COALESCE(wp.weak_count, 0)    AS weak_count,
            wp.last_attempt_date,
            COALESCE(wp.attempt_count, 0) AS attempt_count,
            CASE
                WHEN COALESCE(wp.attempt_count, 0) > 0
                THEN ROUND(CAST(COALESCE(wp.correct_count, 0) AS FLOAT) / wp.attempt_count * 100)
                ELSE NULL
            END AS accuracy_pct
        FROM vocabulary v
        LEFT JOIN word_progress wp ON wp.word_id = v.id
        WHERE {diff_clause}
        ORDER BY {order_clause}
        LIMIT ? OFFSET ?
    """, (limit, offset))
    words = [dict(r) for r in cur.fetchall()]
    conn.close()
    return {"count": total, "words": words}


@app.get("/api/progress/trends")
def get_trends(period: str = "weekly"):
    """Return weekly or monthly aggregated activity."""
    conn = get_db()
    cur = conn.cursor()
    if period == "monthly":
        group_expr = "strftime('%Y-%m', date)"
        limit = 6
    else:
        group_expr = "strftime('%Y-W%W', date)"
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
        LEFT JOIN sessions s ON DATE(s.started_at) = da.date
        GROUP BY {group_expr}
        ORDER BY period DESC
        LIMIT {limit}
    """)
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return list(reversed(rows))  # chronological order for charts


# ── SRS ───────────────────────────────────────────────────────────────────────

@app.post("/api/srs/review")
def srs_review(body: SRSReviewBody):
    """Apply one SM-2 review step for a word. Awards XP and updates streak."""
    if body.quality < 0 or body.quality > 5:
        raise HTTPException(400, "quality must be 0–5")

    today_str = date.today().isoformat()
    yesterday_str = (date.today() - timedelta(days=1)).isoformat()

    conn = get_db()
    cur = conn.cursor()

    # Ensure word_progress row exists
    cur.execute("""
        INSERT INTO word_progress (word_id, srs_interval, srs_easiness, srs_repetitions)
        VALUES (?, 1, 2.5, 0)
        ON CONFLICT(word_id) DO NOTHING
    """, (body.word_id,))

    cur.execute("""
        SELECT srs_interval, srs_easiness, srs_repetitions, correct_count, learned
        FROM word_progress WHERE word_id = ?
    """, (body.word_id,))
    row = cur.fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Word not found")

    new_reps, new_int, new_ef, next_review = _sm2(
        row["srs_interval"] or 1,
        row["srs_easiness"] or 2.5,
        row["srs_repetitions"] or 0,
        body.quality,
    )

    is_correct = body.quality >= 3
    correct_int = 1 if is_correct else 0

    cur.execute("""
        UPDATE word_progress SET
            srs_interval      = ?,
            srs_easiness      = ?,
            srs_repetitions   = ?,
            srs_next_review   = ?,
            attempt_count     = attempt_count + 1,
            correct_count     = correct_count + ?,
            last_attempt_date = ?
        WHERE word_id = ?
    """, (new_int, new_ef, new_reps, next_review, correct_int, today_str, body.word_id))

    # Mark newly learned if threshold reached
    newly_learned = False
    xp_earned = XP_CORRECT_ANSWER if is_correct else 0
    if is_correct and not row["learned"]:
        cur.execute("""
            UPDATE word_progress SET learned = 1, learned_at = ?
            WHERE word_id = ? AND correct_count + 1 >= ?
        """, (today_str, body.word_id, LEARN_THRESHOLD))
        if cur.rowcount > 0:
            newly_learned = True
            xp_earned += XP_NEW_WORD_LEARNED

    # Update daily XP
    cur.execute("UPDATE user_progress SET total_xp = total_xp + ? WHERE id = 1", (xp_earned,))
    cur.execute("""
        INSERT INTO daily_activity (date, xp_earned, correct_answers, total_answers)
        VALUES (?, ?, ?, 1)
        ON CONFLICT(date) DO UPDATE SET
            xp_earned       = xp_earned + excluded.xp_earned,
            correct_answers = correct_answers + excluded.correct_answers,
            total_answers   = total_answers + 1
    """, (today_str, xp_earned, correct_int))

    # Update streak on first activity of the day
    cur.execute("SELECT current_streak, longest_streak, last_activity_date FROM user_progress WHERE id = 1")
    up = cur.fetchone()
    current_streak = up["current_streak"]
    if up["last_activity_date"] != today_str:
        current_streak = current_streak + 1 if up["last_activity_date"] == yesterday_str else 1
        longest = max(up["longest_streak"], current_streak)
        cur.execute("""
            UPDATE user_progress SET current_streak=?, longest_streak=?, last_activity_date=? WHERE id=1
        """, (current_streak, longest, today_str))

    # Check achievements
    cur.execute("SELECT COUNT(*) as cnt FROM word_progress WHERE learned = 1")
    learned_count = cur.fetchone()["cnt"]
    cur.execute("SELECT COALESCE(SUM(sessions_completed), 0) as cnt FROM daily_activity")
    sessions_count = cur.fetchone()["cnt"]
    new_achievements = _check_achievements(cur, today_str, learned_count, sessions_count, current_streak)

    conn.commit()
    conn.close()

    return {
        "word_id":          body.word_id,
        "quality":          body.quality,
        "next_review":      next_review,
        "new_interval":     new_int,
        "new_easiness":     round(new_ef, 3),
        "new_reps":         new_reps,
        "newly_learned":    newly_learned,
        "xp_earned":        xp_earned,
        "new_achievements": new_achievements,
    }


@app.get("/api/stats/freq-difficulty")
def get_stats_freq_difficulty():
    """Word counts for every frequency-level × difficulty combination."""
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
    """Accuracy by difficulty & session type, best/worst words, SRS stages, coverage stats."""
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

    cur.execute("""
        SELECT
            CASE
                WHEN wp.srs_repetitions IS NULL OR wp.srs_repetitions = 0 THEN 'new'
                WHEN wp.srs_interval <= 7  THEN 'learning'
                WHEN wp.srs_interval <= 21 THEN 'young'
                ELSE 'mature'
            END AS stage,
            COUNT(*) AS count
        FROM vocabulary v
        LEFT JOIN word_progress wp ON wp.word_id = v.id
        GROUP BY stage
    """)
    srs_raw = {r["stage"]: r["count"] for r in cur.fetchall()}
    srs_stages = {
        "new":      srs_raw.get("new", 0),
        "learning": srs_raw.get("learning", 0),
        "young":    srs_raw.get("young", 0),
        "mature":   srs_raw.get("mature", 0),
    }

    cur.execute("""
        SELECT AVG(srs_easiness) AS avg_ef
        FROM word_progress WHERE srs_repetitions > 0
    """)
    row = cur.fetchone()
    avg_easiness = round(row["avg_ef"], 2) if row and row["avg_ef"] else None

    today_str = date.today().isoformat()
    cur.execute("""
        SELECT COUNT(*) AS cnt FROM word_progress
        WHERE srs_next_review < ? AND srs_repetitions > 0
    """, (today_str,))
    overdue = cur.fetchone()["cnt"]

    cur.execute("SELECT COUNT(*) FROM vocabulary WHERE examples IS NOT NULL AND examples != ''")
    words_with_examples = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM vocabulary WHERE image_url IS NOT NULL AND image_url != ''")
    words_with_images = cur.fetchone()[0]

    cur.execute("""
        SELECT COUNT(*) FROM vocabulary v
        LEFT JOIN word_progress wp ON wp.word_id = v.id
        WHERE wp.attempt_count IS NULL OR wp.attempt_count = 0
    """)
    words_never_attempted = cur.fetchone()[0]

    conn.close()
    return {
        "by_difficulty":         by_difficulty,
        "by_session_type":       by_session_type,
        "best_words":            best_words,
        "worst_words":           worst_words,
        "srs_stages":            srs_stages,
        "avg_easiness":          avg_easiness,
        "overdue":               overdue,
        "words_with_examples":   words_with_examples,
        "words_with_images":     words_with_images,
        "words_never_attempted": words_never_attempted,
    }


@app.get("/api/stats/velocity")
def get_stats_velocity():
    """Words learned per week for the last 12 weeks."""
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
    """Study patterns: day-of-week activity, total study time, session counts."""
    conn = get_db()
    cur  = conn.cursor()

    cur.execute("""
        SELECT
            CAST(strftime('%w', started_at) AS INTEGER) AS dow,
            COUNT(*) AS session_count,
            COALESCE(SUM(correct_count + incorrect_count), 0) AS total_answers
        FROM sessions
        WHERE started_at IS NOT NULL
        GROUP BY dow
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


@app.get("/api/srs/due")
def get_srs_due(
    limit: int = Query(20, ge=1, le=100),
    group_names: List[str] = Query(default=[]),
    new_only: bool = False,
):
    """Return words whose SRS review is due today or overdue (NULL = never reviewed = due immediately)."""
    today_str = date.today().isoformat()

    conditions = ["(wp.srs_next_review IS NULL OR wp.srs_next_review <= ?)"]
    params: list = [today_str]

    if new_only:
        conditions.append("(wp.srs_repetitions = 0 OR wp.srs_repetitions IS NULL)")
    if group_names:
        placeholders = ",".join(["?"] * len(group_names))
        conditions.append(f"v.group_name IN ({placeholders})")
        params.extend(group_names)

    where = " AND ".join(conditions)
    conn = get_db()
    cur = conn.cursor()
    cur.execute(f"""
        SELECT
            v.*,
            COALESCE(wp.srs_interval,    1)   AS srs_interval,
            COALESCE(wp.srs_easiness,    2.5)  AS srs_easiness,
            COALESCE(wp.srs_repetitions, 0)    AS srs_repetitions,
            wp.srs_next_review,
            CASE
                WHEN wp.srs_next_review IS NULL THEN NULL
                ELSE CAST(julianday(?) - julianday(wp.srs_next_review) AS INTEGER)
            END AS days_overdue
        FROM vocabulary v
        LEFT JOIN word_progress wp ON wp.word_id = v.id
        WHERE {where}
        ORDER BY wp.srs_next_review ASC
        LIMIT ?
    """, [today_str] + params + [limit])
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows


@app.get("/api/srs/stats")
def get_srs_stats():
    """Return due count breakdown and upcoming review schedule for the next 7 days."""
    today_str = date.today().isoformat()
    conn = get_db()
    cur = conn.cursor()

    cur.execute("""
        SELECT COUNT(*) as cnt FROM vocabulary v
        LEFT JOIN word_progress wp ON wp.word_id = v.id
        WHERE wp.srs_next_review IS NULL OR wp.srs_next_review <= ?
    """, (today_str,))
    due_now = cur.fetchone()["cnt"]

    cur.execute("""
        SELECT COUNT(*) as cnt FROM vocabulary v
        LEFT JOIN word_progress wp ON wp.word_id = v.id
        WHERE (wp.srs_next_review IS NULL OR wp.srs_next_review <= ?)
          AND (wp.srs_repetitions = 0 OR wp.srs_repetitions IS NULL)
    """, (today_str,))
    new_words = cur.fetchone()["cnt"]

    # Upcoming: words due in next 7 days (excluding today)
    upcoming = []
    for i in range(1, 8):
        day_str = (date.today() + timedelta(days=i)).isoformat()
        cur.execute("""
            SELECT COUNT(*) as cnt FROM word_progress
            WHERE srs_next_review = ?
        """, (day_str,))
        upcoming.append({"date": day_str, "count": cur.fetchone()["cnt"]})

    conn.close()
    return {
        "due_now":   due_now,
        "new_words": new_words,
        "in_review": due_now - new_words,
        "upcoming":  upcoming,
    }


@app.get("/api/srs/daily-review")
def get_srs_daily_review():
    """Return today's SRS queue capped at the remaining daily goal, with goal metadata."""
    today_str = date.today().isoformat()
    conn = get_db()
    cur = conn.cursor()

    cur.execute("SELECT daily_goal FROM user_progress WHERE id = 1")
    row = cur.fetchone()
    daily_goal = row["daily_goal"] if row else 10

    cur.execute(
        "SELECT COALESCE(words_studied, 0) as cnt FROM daily_activity WHERE date = ?",
        (today_str,),
    )
    row = cur.fetchone()
    words_done_today = row["cnt"] if row else 0

    cur.execute("""
        SELECT COUNT(*) as cnt FROM vocabulary v
        LEFT JOIN word_progress wp ON wp.word_id = v.id
        WHERE wp.srs_next_review IS NULL OR wp.srs_next_review <= ?
    """, (today_str,))
    total_due = cur.fetchone()["cnt"]

    remaining = max(0, daily_goal - words_done_today)
    limit = min(total_due, remaining)

    words = []
    if limit > 0:
        cur.execute("""
            SELECT
                v.*,
                COALESCE(wp.srs_interval,    1)   AS srs_interval,
                COALESCE(wp.srs_easiness,    2.5) AS srs_easiness,
                COALESCE(wp.srs_repetitions, 0)   AS srs_repetitions,
                wp.srs_next_review,
                CASE
                    WHEN wp.srs_next_review IS NULL THEN NULL
                    ELSE CAST(julianday(?) - julianday(wp.srs_next_review) AS INTEGER)
                END AS days_overdue
            FROM vocabulary v
            LEFT JOIN word_progress wp ON wp.word_id = v.id
            WHERE (wp.srs_next_review IS NULL OR wp.srs_next_review <= ?)
            ORDER BY wp.srs_next_review ASC
            LIMIT ?
        """, [today_str, today_str, limit])
        words = [dict(r) for r in cur.fetchall()]

    conn.close()
    return {
        "words":           words,
        "daily_goal":      daily_goal,
        "words_done_today": words_done_today,
        "remaining":       remaining,
        "total_due":       total_due,
    }
