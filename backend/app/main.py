import os
from datetime import datetime, timedelta
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker

engine = create_engine("sqlite:///./firefly.db", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine)

class Base(DeclarativeBase): pass

class Meeting(Base):
    __tablename__ = "meetings"
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(180))
    held_at: Mapped[datetime] = mapped_column(DateTime)
    duration: Mapped[int] = mapped_column(Integer, default=0)
    participants: Mapped[str] = mapped_column(Text, default="")
    summary: Mapped[str] = mapped_column(Text, default="")
    topics: Mapped[str] = mapped_column(Text, default="")
    segments: Mapped[list["Segment"]] = relationship(cascade="all, delete-orphan")
    actions: Mapped[list["Action"]] = relationship(cascade="all, delete-orphan")

class Segment(Base):
    __tablename__ = "transcript_segments"
    id: Mapped[int] = mapped_column(primary_key=True)
    meeting_id: Mapped[int] = mapped_column(ForeignKey("meetings.id"))
    speaker: Mapped[str] = mapped_column(String(80))
    start_seconds: Mapped[int] = mapped_column(Integer)
    end_seconds: Mapped[int] = mapped_column(Integer)
    body: Mapped[str] = mapped_column(Text)

class Action(Base):
    __tablename__ = "action_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    meeting_id: Mapped[int] = mapped_column(ForeignKey("meetings.id"))
    body: Mapped[str] = mapped_column(Text)
    assignee: Mapped[str] = mapped_column(String(80), default="")
    completed: Mapped[bool] = mapped_column(Boolean, default=False)

class MeetingIn(BaseModel):
    title: str
    participants: str = ""
    summary: str = ""
    topics: str = ""
    transcript: str = ""
class ActionIn(BaseModel):
    body: str
    assignee: str = ""
    completed: bool = False

def db():
    with SessionLocal() as session: yield session
def view(m: Meeting):
    return {"id":m.id,"title":m.title,"held_at":m.held_at,"duration":m.duration,"participants":m.participants.split(",") if m.participants else [],"summary":m.summary,"topics":m.topics.split(",") if m.topics else [],"segments":[{"id":s.id,"speaker":s.speaker,"start_seconds":s.start_seconds,"end_seconds":s.end_seconds,"body":s.body} for s in sorted(m.segments,key=lambda x:x.start_seconds)],"actions":[{"id":a.id,"body":a.body,"assignee":a.assignee,"completed":a.completed} for a in m.actions]}

app = FastAPI(title="Firefly Notes API")
allowed_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(CORSMiddleware, allow_origins=allowed_origins, allow_methods=["*"], allow_headers=["*"])

@app.get("/meetings")
def meetings(q: str = "", session: Session = Depends(db)):
    result = session.scalars(select(Meeting).order_by(Meeting.held_at.desc())).all()
    q = q.lower()
    return [view(m) for m in result if not q or q in (m.title + m.participants).lower()]
@app.get("/meetings/{meeting_id}")
def meeting(meeting_id: int, session: Session = Depends(db)):
    m = session.get(Meeting, meeting_id)
    if not m: raise HTTPException(404, "Meeting not found")
    return view(m)
@app.post("/meetings", status_code=201)
def create(payload: MeetingIn, session: Session = Depends(db)):
    values = payload.model_dump()
    transcript = values.pop("transcript", "")
    m = Meeting(**values, held_at=datetime.now(), duration=0)
    lines = [line.strip() for line in transcript.splitlines() if line.strip()]
    for index, line in enumerate(lines):
        speaker, body = (line.split(":", 1) if ":" in line else ("You", line))
        m.segments.append(Segment(
            speaker=speaker.strip() or "You",
            body=body.strip(),
            start_seconds=index * 18,
            end_seconds=(index + 1) * 18,
        ))
    if lines:
        m.duration = len(lines) * 18
    session.add(m); session.commit(); session.refresh(m); return view(m)
@app.patch("/meetings/{meeting_id}")
def update(meeting_id: int, payload: MeetingIn, session: Session = Depends(db)):
    m = session.get(Meeting, meeting_id)
    if not m: raise HTTPException(404, "Meeting not found")
    values = payload.model_dump()
    values.pop("transcript", None)
    for k,v in values.items(): setattr(m,k,v)
    session.commit(); return view(m)
@app.delete("/meetings/{meeting_id}", status_code=204)
def delete(meeting_id: int, session: Session = Depends(db)):
    m = session.get(Meeting, meeting_id)
    if not m: raise HTTPException(404, "Meeting not found")
    session.delete(m); session.commit()
@app.post("/meetings/{meeting_id}/actions", status_code=201)
def add_action(meeting_id: int, payload: ActionIn, session: Session = Depends(db)):
    if not session.get(Meeting, meeting_id): raise HTTPException(404, "Meeting not found")
    a = Action(meeting_id=meeting_id, **payload.model_dump()); session.add(a); session.commit(); session.refresh(a); return {"id":a.id,"body":a.body,"assignee":a.assignee,"completed":a.completed}
@app.patch("/actions/{action_id}")
def update_action(action_id: int, payload: ActionIn, session: Session = Depends(db)):
    a=session.get(Action,action_id)
    if not a: raise HTTPException(404,"Action not found")
    for k,v in payload.model_dump().items(): setattr(a,k,v)
    session.commit(); return {"id":a.id,"body":a.body,"assignee":a.assignee,"completed":a.completed}

def seed():
    with SessionLocal() as s:
        existing = s.scalars(select(Meeting)).all()
        if existing:
            for m in existing:
                if m.title == "Weekly Engineering Stand-up" and not m.segments:
                    m.segments = [
                        Segment(speaker="Alex Kim", start_seconds=0, end_seconds=18, body="The release candidate is stable. We only have the mobile navigation fix left before the end of the sprint."),
                        Segment(speaker="Sam Taylor", start_seconds=21, end_seconds=42, body="I will pair with design on that today and make sure the acceptance criteria are documented."),
                        Segment(speaker="Alex Kim", start_seconds=45, end_seconds=64, body="Let's flag the API dependency as a release risk until the staging checks are complete."),
                    ]
                    m.actions = [Action(body="Complete mobile navigation fix", assignee="Sam Taylor"), Action(body="Verify API staging checks", assignee="Alex Kim")]
                if m.title == "Customer Discovery: Atlas" and not m.segments:
                    m.segments = [
                        Segment(speaker="Maya Chen", start_seconds=0, end_seconds=20, body="Tell us about the part of reporting that currently takes the most time for your team."),
                        Segment(speaker="Elena Rossi", start_seconds=23, end_seconds=49, body="We export data every Monday and combine it manually. A clear executive dashboard would save us several hours."),
                        Segment(speaker="Maya Chen", start_seconds=52, end_seconds=76, body="That is helpful. We will prototype a reporting view and share an early version for feedback."),
                    ]
                    m.actions = [Action(body="Prototype Atlas reporting dashboard", assignee="Maya Chen"), Action(body="Send feedback session invitation", assignee="Elena Rossi")]
            s.commit()
            return
        m=Meeting(title="Q3 Product Strategy",held_at=datetime.now()-timedelta(days=1),duration=2865,participants="Maya Chen,Jordan Lee,Priya Shah",summary="The team aligned on a focused Q3 launch plan, prioritising onboarding improvements and the analytics dashboard. We will validate the revised activation flow with customers before the next planning review.",topics="Product strategy,Onboarding,Analytics")
        m.segments=[Segment(speaker="Maya Chen",start_seconds=0,end_seconds=18,body="Thanks for joining. Today we need to make the Q3 priorities concrete and leave with clear owners."),Segment(speaker="Jordan Lee",start_seconds=21,end_seconds=45,body="The activation funnel is still our biggest opportunity. The first-session experience needs less friction."),Segment(speaker="Priya Shah",start_seconds=48,end_seconds=79,body="Customer interviews point to the same issue. I can share the top findings and a proposed onboarding experiment."),Segment(speaker="Maya Chen",start_seconds=84,end_seconds=112,body="Great. Let's ship the experiment to our design partners first, then review the results next Friday."),Segment(speaker="Jordan Lee",start_seconds=118,end_seconds=142,body="For analytics, I recommend a small dashboard release with only the three metrics customers ask for most.")]
        m.actions=[Action(body="Share customer interview findings",assignee="Priya Shah"),Action(body="Draft onboarding experiment brief",assignee="Jordan Lee"),Action(body="Schedule design-partner review",assignee="Maya Chen")]
        s.add(m)
        s.add(Meeting(title="Weekly Engineering Stand-up",held_at=datetime.now()-timedelta(days=3),duration=1560,participants="Alex Kim,Sam Taylor",summary="Engineering reviewed sprint progress and identified two release risks.",topics="Engineering,Sprint"))
        s.add(Meeting(title="Customer Discovery: Atlas",held_at=datetime.now()-timedelta(days=7),duration=2210,participants="Maya Chen,Elena Rossi",summary="Atlas needs clearer reporting and easier member invitations.",topics="Customer research,Reporting"))
        s.commit()
Base.metadata.create_all(engine)
seed()
