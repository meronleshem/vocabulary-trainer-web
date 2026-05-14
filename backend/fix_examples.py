"""
Re-scrapes examples from morfix for every word in the database and updates them.
Run once: python fix_examples.py
"""
import os
import re
import time
import sqlite3
from typing import Optional
import requests
from bs4 import BeautifulSoup

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "Database", "vocabulary.db")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Referer": "https://www.google.com/",
}


def scrape_examples(eng_word: str) -> Optional[str]:
    url = f"https://www.morfix.co.il/{eng_word}"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=10)
        resp.raise_for_status()
    except Exception as e:
        print(f"  [network error] {e}")
        return None

    soup = BeautifulSoup(resp.text, "html.parser")
    for ul in soup.find_all("ul", class_="Translation_ulFooter_enTohe"):
        items = ul.find_all("li")[:3]
        if items:
            return "\n".join(
                re.sub(r'\s+', ' ', li.get_text(separator=' ')).strip()
                for li in items
            )
    return ""


def main():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    cur.execute("SELECT id, engWord, examples FROM vocabulary ORDER BY id")
    words = cur.fetchall()

    updated = 0
    skipped = 0
    errors = 0

    print(f"Checking {len(words)} words...\n")

    for word in words:
        wid = word["id"]
        eng = word["engWord"]
        old_examples = word["examples"] or ""

        new_examples = scrape_examples(eng)

        if new_examples is None:
            print(f"  [{wid}] {eng} — ERROR (network)")
            errors += 1
            time.sleep(2)
            continue

        if new_examples == old_examples:
            skipped += 1
        else:
            cur.execute("UPDATE vocabulary SET examples = ? WHERE id = ?", (new_examples, wid))
            conn.commit()
            updated += 1
            print(f"  [{wid}] {eng} — updated")

        time.sleep(0.4)

    conn.close()
    print(f"\nDone. Updated: {updated} | Unchanged: {skipped} | Errors: {errors}")


if __name__ == "__main__":
    main()
