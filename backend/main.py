import os
import re
import random
import sqlite3
from typing import Optional
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

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


class WordUpdate(BaseModel):
    engWord: Optional[str] = None
    hebWord: Optional[str] = None
    examples: Optional[str] = None
    difficulty: Optional[str] = None
    group_name: Optional[str] = None


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
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO vocabulary (engWord, hebWord, examples, difficulty, group_name) VALUES (?,?,?,?,?)",
        (word.engWord, word.hebWord, word.examples or "", word.difficulty, word.group_name or ""),
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
        "SELECT group_name, COUNT(*) as count FROM vocabulary GROUP BY group_name ORDER BY group_name"
    )
    groups_raw = cur.fetchall()
    conn.close()

    books: dict = {}
    for row in groups_raw:
        gname = row["group_name"]
        book = extract_book(gname)
        if book not in books:
            books[book] = {"book": book, "total": 0, "groups": []}
        books[book]["total"] += row["count"]
        books[book]["groups"].append({"group_name": gname, "count": row["count"]})

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

    cur.execute("SELECT group_name, COUNT(*) FROM vocabulary GROUP BY group_name")
    by_book: dict = {}
    for gname, cnt in cur.fetchall():
        book = extract_book(gname)
        by_book[book] = by_book.get(book, 0) + cnt

    cur.execute("SELECT * FROM vocabulary ORDER BY id DESC LIMIT 6")
    recent = [dict(r) for r in cur.fetchall()]

    conn.close()
    return {
        "total": total,
        "by_difficulty": by_difficulty,
        "by_book": by_book,
        "recent": recent,
    }
