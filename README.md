# VocabularyApp

English ↔ Hebrew vocabulary learning app. 3,500+ words sourced from fantasy/thriller novels, with flashcards, quizzes, and full word management.

## Setup

### Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

API runs at http://localhost:8000  
Swagger docs at http://localhost:8000/docs

### Frontend

```bash
cd frontend
npm install
npm run dev
```

App runs at http://localhost:5173

---

## Features

| Page | Description |
|------|-------------|
| **Dashboard** | Stats overview, difficulty pie chart, words per book bar chart |
| **Browse** | Searchable/filterable word table with inline difficulty editing, add/edit/delete |
| **Flashcards** | Flip-card study mode — filter by book/difficulty, mark words as Easy/Medium/Hard |
| **Quiz** | Multiple-choice quiz (Eng→Heb or Heb→Eng) with score tracking and answer review |
| **Books** | Browse vocabulary organized by source book and chapter |

### Keyboard shortcuts (Flashcards)
- `Space` — flip card
- `←` / `→` — navigate cards
- `1` / `2` / `3` — mark Easy / Medium / Hard
