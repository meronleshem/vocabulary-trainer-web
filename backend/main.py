import os
import re
import random
import sqlite3
from typing import Optional
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import requests
from bs4 import BeautifulSoup

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "Database", "vocabulary.db")

app = FastAPI(title="VocabularyApp API", version="1.0.0")

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


# ── Words ────────────────────────────────────────────────────────────────────

@app.get("/api/words")
def list_words(
    search: Optional[str] = None,
    difficulty: Optional[str] = None,
    group_name: Optional[str] = None,
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

    where = (" WHERE " + " AND ".join(conditions)) if conditions else ""

    conn = get_db()
    cur = conn.cursor()
    cur.execute(f"SELECT COUNT(*) FROM vocabulary{where}", params)
    total = cur.fetchone()[0]

    offset = (page - 1) * limit
    cur.execute(
        f"SELECT * FROM vocabulary{where} ORDER BY {sort_by} {sort_dir} LIMIT ? OFFSET ?",
        params + [limit, offset],
    )
    words = [dict(r) for r in cur.fetchall()]
    conn.close()
    return {"total": total, "page": page, "limit": limit, "words": words}


@app.get("/api/words/study")
def get_study_words(
    difficulty: Optional[str] = None,
    group_name: Optional[str] = None,
    limit: int = Query(20, ge=1, le=100),
):
    conditions, params = [], []
    if difficulty:
        conditions.append("difficulty = ?")
        params.append(difficulty)
    if group_name:
        conditions.append("group_name = ?")
        params.append(group_name)

    where = (" WHERE " + " AND ".join(conditions)) if conditions else ""
    conn = get_db()
    cur = conn.cursor()
    cur.execute(f"SELECT * FROM vocabulary{where} ORDER BY RANDOM() LIMIT ?", params + [limit])
    words = [dict(r) for r in cur.fetchall()]
    conn.close()
    return words


@app.get("/api/words/quiz")
def get_quiz(
    difficulty: Optional[str] = None,
    group_name: Optional[str] = None,
    count: int = Query(10, ge=1, le=50),
    direction: str = "eng_to_heb",
):
    conditions, params = [], []
    if difficulty:
        conditions.append("difficulty = ?")
        params.append(difficulty)
    if group_name:
        conditions.append("group_name = ?")
        params.append(group_name)

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
    difficulty: Optional[str] = None,
    group_name: Optional[str] = None,
    count: int = Query(10, ge=1, le=50),
):
    conditions = ["(examples IS NOT NULL AND examples != '')"]
    params = []
    if difficulty:
        conditions.append("difficulty = ?")
        params.append(difficulty)
    if group_name:
        conditions.append("group_name = ?")
        params.append(group_name)

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
    valid = {"EASY", "MEDIUM", "HARD", "NEW_WORD"}
    if body.difficulty not in valid:
        raise HTTPException(400, "Invalid difficulty value")
    conn = get_db()
    cur = conn.cursor()
    cur.execute("UPDATE vocabulary SET difficulty = ? WHERE id = ?", (body.difficulty, word_id))
    if cur.rowcount == 0:
        conn.close()
        raise HTTPException(404, "Word not found")
    conn.commit()
    conn.close()
    return {"id": word_id, "difficulty": body.difficulty}


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

    conn.close()
    return {
        "total": total,
        "by_difficulty": by_difficulty,
        "by_book": by_book,
        "recent": recent,
    }
