from typing import List, Dict, Any, Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

import app.ui.backend as backend
from app.rag.library import get_document, pdf_path

app = FastAPI(title="AI Tutor API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatRequest(BaseModel):
    question: str
    chat_history: List[Dict[str, Any]]
    document_id: Optional[str] = None

class FlashcardRequest(BaseModel):
    topic: str
    count: int = 5

class FlashcardSubmitRequest(BaseModel):
    quality: int
    previous_interval: int = 0
    previous_repetitions: int = 0
    previous_ease_factor: float = 2.5

class QuizRequest(BaseModel):
    topic: str
    difficulty: str
    count: int

class StudyPlanRequest(BaseModel):
    goal: str
    current_level: str
    topics: List[str]
    daily_hours: float
    duration_days: int
    plan_type: str = "learning"
    exam_date: Optional[str] = None

class StudySessionRequest(BaseModel):
    plan: Dict[str, Any]
    session_number: int

class MindmapRequest(BaseModel):
    topic: str
    document_id: Optional[str] = None

class MemoryGameRequest(BaseModel):
    document_id: str
    pair_count: int = 6

class QuestRequest(BaseModel):
    document_id: str

class ZoneRequest(BaseModel):
    document_id: str
    # "full": 一次生成全部区域；"first": 星球简介 + 区域规划 + 第 1 区；"rest": 按规划补齐其余区域
    stage: str = "full"
    outline: List[Dict[str, Any]] = []
    start: int = 1

class FeynmanRequest(BaseModel):
    title: str = ""
    guardian_name: str = ""
    challenge_prompt: str
    key_points: List[str]
    reference_explanation: str = ""
    answer: str


@app.post("/api/upload")
async def upload_document(file: UploadFile = File(...)):
    # The backend expects a file object with .name and .getvalue() methods,
    # so we wrap the FastAPI UploadFile in a simple adapter.
    class MockUploadedFile:
        def __init__(self, name, content):
            self.name = name
            self._content = content
        def getvalue(self):
            return self._content

    content = await file.read()
    mock_file = MockUploadedFile(file.filename, content)
    result = backend.ingest_document(mock_file)
    if result.get("status") == "error":
        raise HTTPException(status_code=400, detail=result.get("message"))
    return result

@app.get("/api/documents")
async def list_documents():
    from app.rag.library import list_documents as load_documents

    return {"documents": load_documents()}

@app.get("/api/documents/{document_id}/file")
async def document_file(document_id: str):
    record = get_document(document_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Document not found")
    try:
        path = pdf_path(document_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Document not found")
    if not path.exists():
        raise HTTPException(status_code=404, detail="PDF file is missing")
    return FileResponse(
        path,
        media_type="application/pdf",
        filename=record.get("name") or f"{document_id}.pdf",
        content_disposition_type="inline",
    )

@app.delete("/api/documents/{document_id}")
async def delete_uploaded_document(document_id: str):
    if not backend.forget_document(document_id):
        raise HTTPException(status_code=404, detail="Document not found")
    return {"status": "ok"}

@app.post("/api/chat")
async def chat(request: ChatRequest):
    result = backend.ask_tutor(
        question=request.question,
        chat_history=request.chat_history,
        document=request.document_id,
    )
    return result

@app.post("/api/quiz")
async def generate_quiz(request: QuizRequest):
    result = backend.generate_quiz(
        topic=request.topic,
        difficulty=request.difficulty,
        count=request.count,
    )
    return {"quiz": result}

@app.post("/api/flashcards")
async def generate_flashcards(request: FlashcardRequest):
    result = backend.get_flashcards(
        topic=request.topic,
        count=request.count,
    )
    return {"flashcards": result}

@app.post("/api/flashcards/submit")
async def submit_flashcard(request: FlashcardSubmitRequest):
    result = backend.submit_flashcard_answer(
        quality=request.quality,
        previous_interval=request.previous_interval,
        previous_repetitions=request.previous_repetitions,
        previous_ease_factor=request.previous_ease_factor,
    )
    return result

@app.post("/api/study-plan")
async def create_study_plan(request: StudyPlanRequest):
    result = backend.create_study_plan(
        goal=request.goal,
        current_level=request.current_level,
        topics=request.topics,
        daily_hours=request.daily_hours,
        duration_days=request.duration_days,
        plan_type=request.plan_type,
        exam_date=request.exam_date,
    )
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result

@app.post("/api/study-plan/session/start")
async def start_study_session(request: StudySessionRequest):
    result = backend.begin_study_session(request.plan, request.session_number)
    return result

@app.post("/api/study-plan/session/complete")
async def complete_study_session(request: StudySessionRequest):
    result = backend.finish_study_session(request.plan, request.session_number)
    return result

@app.post("/api/study-plan/progress")
async def get_study_plan_progress(request: StudySessionRequest):
    # Actually get_study_plan_status takes just the plan
    result = backend.get_study_plan_status(request.plan)
    return result

@app.post("/api/mindmap")
async def create_mindmap(request: MindmapRequest):
    result = backend.generate_mindmap(
        topic=request.topic,
        document_id=request.document_id,
    )
    return {"code": result}

@app.post("/api/games/memory")
async def create_memory_game(request: MemoryGameRequest):
    try:
        pairs = backend.generate_memory_pairs(
            document_id=request.document_id,
            pair_count=request.pair_count,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"pairs": pairs}

@app.post("/api/quests")
async def create_quest(request: QuestRequest):
    try:
        quest = backend.generate_quest(request.document_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"quest": quest}

@app.post("/api/zones")
def create_zones(request: ZoneRequest):
    # 同步 def：模型调用在线程池里跑，后台补全区域时不会卡住同时进行的 /api/chat
    outline = None
    try:
        if request.stage == "first":
            first = backend.generate_first_zone(request.document_id)
            zones, outline = first["zones"], first["outline"]
        elif request.stage == "rest":
            zones = backend.generate_rest_zones(request.document_id, request.outline, max(0, request.start))
        else:
            zones = backend.generate_zones(request.document_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    record = get_document(request.document_id) or {}
    return {
        "zones": zones,
        "outline": outline,
        "planetMeta": {
            "planetName": record.get("planetName"),
            "themeCategory": record.get("themeCategory"),
            "themeSummary": record.get("themeSummary"),
        },
    }

@app.post("/api/zones/feynman")
async def judge_feynman(request: FeynmanRequest):
    try:
        result = backend.evaluate_feynman(
            title=request.title,
            guardian=request.guardian_name,
            challenge=request.challenge_prompt,
            key_points=request.key_points,
            reference=request.reference_explanation,
            answer=request.answer,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return result
