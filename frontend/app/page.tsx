"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type Segment = { id: number; speaker: string; start_seconds: number; end_seconds: number; body: string };
type Action = { id: number; body: string; assignee: string; completed: boolean };
type Meeting = { id: number; title: string; held_at: string; duration: number; participants: string[]; summary: string; topics: string[]; segments: Segment[]; actions: Action[] };
type View = "meetings" | "soundbites" | "analytics" | "search" | "settings";
type Modal = "create" | "edit" | "action" | null;

const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const fmt = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
const dateText = (date: string) => new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export default function App() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [chosen, setChosen] = useState<Meeting | null>(null);
  const [view, setView] = useState<View>("meetings");
  const [tab, setTab] = useState<"notes" | "transcript">("notes");
  const [query, setQuery] = useState("");
  const [transcriptQuery, setTranscriptQuery] = useState("");
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [toast, setToast] = useState("");
  const [dateFilter, setDateFilter] = useState("all");
  const [personFilter, setPersonFilter] = useState("all");
  const [sort, setSort] = useState<"new" | "old">("new");
  const [form, setForm] = useState({ title: "", participants: "", summary: "", topics: "", transcript: "" });
  const [actionForm, setActionForm] = useState({ body: "", assignee: "" });
  const interval = useRef<ReturnType<typeof setInterval> | null>(null);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  };
  const load = async () => {
    const response = await fetch(`${api}/meetings`);
    const items: Meeting[] = await response.json();
    setMeetings(items);
    if (!chosen && items[0]) setChosen(items[0]);
  };
  useEffect(() => { load(); }, []);
  useEffect(() => () => {
    if (interval.current) clearInterval(interval.current);
    window.speechSynthesis?.cancel();
  }, []);

  const select = async (id: number, seek = 0, initialTab: "notes" | "transcript" = "notes") => {
    const response = await fetch(`${api}/meetings/${id}`);
    const item: Meeting = await response.json();
    setChosen(item);
    setTime(seek);
    setView("meetings");
    setTab(initialTab);
    setTranscriptQuery("");
  };
  const stopPlayback = () => {
    if (interval.current) clearInterval(interval.current);
    interval.current = null;
    window.speechSynthesis?.cancel();
    setPlaying(false);
  };
  const speakAt = (position: number) => {
    if (!chosen || !window.speechSynthesis) return;
    const segment = chosen.segments.find((item) => position >= item.start_seconds && position <= item.end_seconds) ?? chosen.segments.find((item) => item.start_seconds >= position);
    if (!segment) return;
    window.speechSynthesis.cancel();
    const narration = new SpeechSynthesisUtterance(`${segment.speaker}. ${segment.body}`);
    narration.rate = 1.13;
    narration.pitch = 1;
    window.speechSynthesis.speak(narration);
  };
  const togglePlayback = () => {
    if (!chosen || chosen.duration === 0) { notify("Add transcript lines to enable the audio preview"); return; }
    if (playing) { stopPlayback(); return; }
    const start = time >= chosen.duration ? 0 : time;
    setTime(start);
    setPlaying(true);
    speakAt(start);
    interval.current = setInterval(() => {
      setTime((current) => {
        const next = current + 3;
        if (!chosen || next >= chosen.duration) { stopPlayback(); return 0; }
        return next;
      });
    }, 500);
  };
  const seek = (seconds: number) => {
    const next = Math.max(0, Math.min(seconds, chosen?.duration || 0));
    setTime(next);
    if (playing) speakAt(next);
  };

  const createOrUpdate = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.title.trim()) return;
    const isEditing = modal === "edit" && chosen;
    const endpoint = isEditing ? `${api}/meetings/${chosen.id}` : `${api}/meetings`;
    const response = await fetch(endpoint, { method: isEditing ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
    const saved: Meeting = await response.json();
    setModal(null);
    setForm({ title: "", participants: "", summary: "", topics: "", transcript: "" });
    await load();
    await select(saved.id);
    notify(isEditing ? "Meeting updated" : "Meeting created");
  };
  const openCreate = () => { setForm({ title: "", participants: "", summary: "", topics: "", transcript: "" }); setModal("create"); };
  const openEdit = () => {
    if (!chosen) return;
    setForm({ title: chosen.title, participants: chosen.participants.join(", "), summary: chosen.summary, topics: chosen.topics.join(", "), transcript: "" });
    setModal("edit");
  };
  const importTranscript = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setForm((current) => ({ ...current, transcript: String(reader.result || "") }));
    reader.readAsText(file);
  };
  const deleteMeeting = async () => {
    if (!chosen || !window.confirm(`Delete “${chosen.title}”?`)) return;
    stopPlayback();
    await fetch(`${api}/meetings/${chosen.id}`, { method: "DELETE" });
    setChosen(null);
    await load();
    notify("Meeting deleted");
  };
  const saveAction = async (event: FormEvent) => {
    event.preventDefault();
    if (!chosen || !actionForm.body.trim()) return;
    await fetch(`${api}/meetings/${chosen.id}/actions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...actionForm, completed: false }) });
    setActionForm({ body: "", assignee: "" }); setModal(null); await select(chosen.id); notify("Action item added");
  };
  const updateAction = async (action: Action, completed = action.completed, body = action.body, assignee = action.assignee) => {
    await fetch(`${api}/actions/${action.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ body, assignee, completed }) });
    if (chosen) await select(chosen.id, time);
  };
  const exportText = (kind: "transcript" | "summary") => {
    if (!chosen) return;
    const content = kind === "transcript"
      ? `${chosen.title}\n\n${chosen.segments.map((segment) => `[${fmt(segment.start_seconds)}] ${segment.speaker}: ${segment.body}`).join("\n")}`
      : `# ${chosen.title}\n\n## Summary\n${chosen.summary}\n\n## Key topics\n${chosen.topics.map((topic) => `- ${topic}`).join("\n")}\n\n## Action items\n${chosen.actions.map((action) => `- [${action.completed ? "x" : " "}] ${action.body} — ${action.assignee || "Unassigned"}`).join("\n")}`;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
    link.download = `${chosen.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${kind}.${kind === "summary" ? "md" : "txt"}`;
    link.click(); URL.revokeObjectURL(link.href); notify(`${kind === "summary" ? "Summary" : "Transcript"} exported`);
  };

  const participants = useMemo(() => Array.from(new Set(meetings.flatMap((meeting) => meeting.participants))).filter(Boolean).sort(), [meetings]);
  const listedMeetings = useMemo(() => meetings.filter((meeting) => {
    const haystack = `${meeting.title} ${meeting.participants.join(" ")} ${meeting.summary} ${meeting.topics.join(" ")}`.toLowerCase();
    const today = new Date(); const age = Math.floor((today.getTime() - new Date(meeting.held_at).getTime()) / 86400000);
    return (!query || haystack.includes(query.toLowerCase())) && (personFilter === "all" || meeting.participants.includes(personFilter)) && (dateFilter === "all" || (dateFilter === "week" && age <= 7) || (dateFilter === "month" && age <= 31));
  }).sort((a, b) => sort === "new" ? +new Date(b.held_at) - +new Date(a.held_at) : +new Date(a.held_at) - +new Date(b.held_at)), [meetings, query, personFilter, dateFilter, sort]);
  const matches = useMemo(() => {
    const keyword = query.toLowerCase();
    if (!keyword) return [];
    return meetings.flatMap((meeting) => {
      const meetingMatch = `${meeting.title} ${meeting.summary} ${meeting.topics.join(" ")} ${meeting.participants.join(" ")} ${meeting.actions.map((action) => `${action.body} ${action.assignee}`).join(" ")}`.toLowerCase().includes(keyword);
      const segmentMatches = meeting.segments.filter((segment) => `${segment.speaker} ${segment.body}`.toLowerCase().includes(keyword));
      return meetingMatch || segmentMatches.length ? [{ meeting, segmentMatches }] : [];
    });
  }, [meetings, query]);
  const soundbites = useMemo(() => meetings.flatMap((meeting) => meeting.segments.slice(0, 2).map((segment) => ({ meeting, segment }))), [meetings]);
  const totalActions = meetings.reduce((sum, meeting) => sum + meeting.actions.length, 0);
  const completedActions = meetings.reduce((sum, meeting) => sum + meeting.actions.filter((action) => action.completed).length, 0);

  return <main>
    <Sidebar active={view} onNavigate={(next) => { stopPlayback(); setView(next); setQuery(""); }} onCreate={openCreate} />
    {view === "meetings" && <Library meetings={listedMeetings} chosenId={chosen?.id} query={query} onQuery={setQuery} dateFilter={dateFilter} onDate={setDateFilter} personFilter={personFilter} onPerson={setPersonFilter} people={participants} sort={sort} onSort={setSort} onSelect={select} />}
    <section className={`workspace ${view !== "meetings" ? "full" : ""}`}>
      {view === "meetings" && <MeetingDetail meeting={chosen} tab={tab} setTab={setTab} transcriptQuery={transcriptQuery} setTranscriptQuery={setTranscriptQuery} time={time} playing={playing} onToggle={togglePlayback} onSeek={seek} onEdit={openEdit} onDelete={deleteMeeting} onAddAction={() => setModal("action")} onAction={updateAction} onExport={exportText} onShare={() => notify("Share link copied to clipboard")} />}
      {view === "soundbites" && <Soundbites items={soundbites} onOpen={(id, start) => { stopPlayback(); select(id, start, "transcript"); }} />}
      {view === "analytics" && <Analytics meetings={meetings} totalActions={totalActions} completedActions={completedActions} />}
      {view === "search" && <GlobalSearch query={query} setQuery={setQuery} results={matches} onOpen={(id, start) => { stopPlayback(); select(id, start, "transcript"); }} />}
      {view === "settings" && <Settings onToast={notify} />}
    </section>
    {modal && <ModalShell title={modal === "create" ? "Create a meeting" : modal === "edit" ? "Edit meeting" : "Add action item"} onClose={() => setModal(null)}>
      {modal === "action" ? <form className="form-stack" onSubmit={saveAction}><label>Action item<input autoFocus value={actionForm.body} onChange={(event) => setActionForm({ ...actionForm, body: event.target.value })} placeholder="What needs to happen?" required /></label><label>Assignee<input value={actionForm.assignee} onChange={(event) => setActionForm({ ...actionForm, assignee: event.target.value })} placeholder="Optional" /></label><button className="primary">Add action item</button></form> : <form className="form-stack" onSubmit={createOrUpdate}><label>Meeting title<input autoFocus value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="e.g. Product planning" required /></label><label>Participants <small>Separate names with commas</small><input value={form.participants} onChange={(event) => setForm({ ...form, participants: event.target.value })} placeholder="Maya Chen, Jordan Lee" /></label><label>AI summary<textarea value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} placeholder="Optional summary or meeting notes" /></label><label>Topics <small>Separate topics with commas</small><input value={form.topics} onChange={(event) => setForm({ ...form, topics: event.target.value })} placeholder="Planning, Product" /></label>{modal === "create" && <><label>Transcript <small>One entry per line: Speaker: what they said</small><textarea value={form.transcript} onChange={(event) => setForm({ ...form, transcript: event.target.value })} placeholder={"Maya: Welcome everyone\nJordan: Let's review the plan"} /></label><label className="file-input">Upload .txt transcript<input type="file" accept=".txt,.vtt" onChange={(event) => importTranscript(event.target.files?.[0])} /></label></>}<button className="primary">{modal === "edit" ? "Save changes" : "Create meeting"}</button></form>}
    </ModalShell>}
    {toast && <div className="toast" role="status">✓ {toast}</div>}
  </main>;
}

function Sidebar({ active, onNavigate, onCreate }: { active: View; onNavigate: (view: View) => void; onCreate: () => void }) {
  const items: [View, string, string][] = [["meetings", "▦", "Meetings"], ["soundbites", "◉", "Soundbites"], ["analytics", "◇", "Analytics"], ["search", "⌕", "Global search"]];
  return <aside><div className="brand"><b>✦</b> fireflies</div><button className="new" onClick={onCreate}>＋ New meeting</button><nav>{items.map(([id, icon, label]) => <button key={id} className={active === id ? "active" : ""} onClick={() => onNavigate(id)}><span>{icon}</span>{label}</button>)}</nav><div className="aside-bottom"><button className={active === "settings" ? "active" : ""} onClick={() => onNavigate("settings")}>⚙ <span>Settings</span></button><div className="avatar"><i>MC</i><span><b>Maya Chen</b><small>Workspace owner</small></span></div></div></aside>;
}

function Library(props: { meetings: Meeting[]; chosenId?: number; query: string; onQuery: (q: string) => void; dateFilter: string; onDate: (x: string) => void; personFilter: string; onPerson: (x: string) => void; people: string[]; sort: "new" | "old"; onSort: (x: "new" | "old") => void; onSelect: (id: number) => void }) {
  return <section className="library"><header><div><h1>My meetings</h1><p className="subtitle">Your recorded conversations</p></div><button className="round" title="More options">•••</button></header><div className="search"><span>⌕</span><input value={props.query} onChange={(event) => props.onQuery(event.target.value)} placeholder="Search meetings, people, or topics" /></div><div className="filters"><select value={props.dateFilter} onChange={(event) => props.onDate(event.target.value)}><option value="all">All dates</option><option value="week">Past 7 days</option><option value="month">Past 30 days</option></select><select value={props.personFilter} onChange={(event) => props.onPerson(event.target.value)}><option value="all">All people</option>{props.people.map((person) => <option key={person}>{person}</option>)}</select><select value={props.sort} onChange={(event) => props.onSort(event.target.value as "new" | "old")}><option value="new">Newest first</option><option value="old">Oldest first</option></select></div><p className="result-count">{props.meetings.length} {props.meetings.length === 1 ? "meeting" : "meetings"}</p><div className="meeting-list">{props.meetings.map((meeting) => <button key={meeting.id} className={`meeting ${meeting.id === props.chosenId ? "selected" : ""}`} onClick={() => props.onSelect(meeting.id)}><div className="meeting-icon">✦</div><div><b>{meeting.title}</b><p>{dateText(meeting.held_at)} · {fmt(meeting.duration)} · {meeting.participants.join(", ") || "No participants"}</p><div className="chips">{meeting.topics.slice(0, 2).map((topic) => <span key={topic}>{topic}</span>)}</div></div></button>)}{props.meetings.length === 0 && <div className="empty-list">No meetings found. Try clearing a filter.</div>}</div></section>;
}

function MeetingDetail({ meeting, tab, setTab, transcriptQuery, setTranscriptQuery, time, playing, onToggle, onSeek, onEdit, onDelete, onAddAction, onAction, onExport, onShare }: { meeting: Meeting | null; tab: "notes" | "transcript"; setTab: (tab: "notes" | "transcript") => void; transcriptQuery: string; setTranscriptQuery: (q: string) => void; time: number; playing: boolean; onToggle: () => void; onSeek: (n: number) => void; onEdit: () => void; onDelete: () => void; onAddAction: () => void; onAction: (action: Action, completed?: boolean, body?: string, assignee?: string) => void; onExport: (kind: "transcript" | "summary") => void; onShare: () => void }) {
  const visibleSegments = meeting?.segments.filter((segment) => !transcriptQuery || `${segment.speaker} ${segment.body}`.toLowerCase().includes(transcriptQuery.toLowerCase())) ?? [];
  if (!meeting) return <div className="empty">Select a meeting to see its notes and transcript.</div>;
  return <><header className="detail-head"><div><div className="crumb">Meetings <span>/</span> {meeting.title}</div><h2>{meeting.title}</h2><p>{new Date(meeting.held_at).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })} <i>·</i> {meeting.participants.join(", ") || "No participants"}</p></div><div className="head-actions"><button className="round" title="Edit meeting" onClick={onEdit}>✎</button><button className="round" title="Delete meeting" onClick={onDelete}>⌫</button><button className="share" onClick={onShare}>Share</button></div></header><div className="player"><button className="play" onClick={onToggle} aria-label={playing ? "Pause audio" : "Play audio"}>{playing ? "Ⅱ" : "▶"}</button><div className="player-body"><button className="track" aria-label="Seek audio" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); onSeek(Math.round(((event.clientX - rect.left) / rect.width) * meeting.duration)); }}><i style={{ width: `${meeting.duration ? (time / meeting.duration) * 100 : 0}%` }} /></button><div className="demo-audio">{playing ? "Playing synthesized transcript preview" : "Demo audio preview — click play"}</div></div><b>{fmt(time)}</b><span>/ {fmt(meeting.duration)}</span></div><div className="tabs"><button className={tab === "notes" ? "on" : ""} onClick={() => setTab("notes")}>AI Notes</button><button className={tab === "transcript" ? "on" : ""} onClick={() => setTab("transcript")}>Transcript <em>{meeting.segments.length}</em></button><div className="export"><button>Export⌄</button><div><button onClick={() => onExport("summary")}>Summary (.md)</button><button onClick={() => onExport("transcript")}>Transcript (.txt)</button></div></div></div>{tab === "notes" ? <div className="notes"><article><label>AI SUMMARY</label><h3>What was discussed</h3><p>{meeting.summary || "No summary yet. Add meeting notes to capture the discussion."}</p><h3>Key topics</h3><div className="topic-row">{meeting.topics.filter(Boolean).length ? meeting.topics.filter(Boolean).map((topic) => <span key={topic}>{topic}</span>) : <span>Uncategorized</span>}</div></article><article><div className="card-title"><div><label>ACTION ITEMS</label><h3>Follow-ups</h3></div><button className="add-button" onClick={onAddAction}>＋ Add</button></div>{meeting.actions.length ? meeting.actions.map((action) => <div className="action" key={action.id}><input type="checkbox" checked={action.completed} onChange={() => onAction(action, !action.completed)} /><div className={action.completed ? "done" : ""}><button className="edit-action" onClick={() => { const body = prompt("Action item", action.body); if (body) onAction(action, action.completed, body, action.assignee); }}>{action.body}</button><small>{action.assignee || "Unassigned"}</small></div></div>) : <p className="muted">No action items yet. Add the next agreed follow-up.</p>}</article></div> : <div className="transcript"><div className="transcript-search"><span>⌕</span><input value={transcriptQuery} onChange={(event) => setTranscriptQuery(event.target.value)} placeholder="Search in transcript" /></div><p className="helper">Click a line to seek the player. The active line follows playback.</p>{visibleSegments.length ? visibleSegments.map((segment) => <button className={`segment ${time >= segment.start_seconds && time <= segment.end_seconds ? "playing" : ""}`} key={segment.id} onClick={() => onSeek(segment.start_seconds)}><time>{fmt(segment.start_seconds)}</time><div><b>{segment.speaker}</b><p>{transcriptQuery ? highlight(segment.body, transcriptQuery) : segment.body}</p></div></button>) : <div className="empty-list">No matching transcript lines.</div>}</div>}</>;
}

function Soundbites({ items, onOpen }: { items: { meeting: Meeting; segment: Segment }[]; onOpen: (id: number, start: number) => void }) {
  return <div className="page-view"><header className="page-header"><div><span className="eyebrow">REPLAY THE MOMENT</span><h1>Soundbites</h1><p>Saved, shareable highlights from your meeting transcripts.</p></div></header><div className="soundbite-grid">{items.length ? items.map(({ meeting, segment }) => <article className="soundbite" key={`${meeting.id}-${segment.id}`}><div className="soundbite-top"><span>✦ Soundbite</span><time>{fmt(segment.start_seconds)}</time></div><h3>{meeting.title}</h3><p>“{segment.body}”</p><footer><span>{segment.speaker}</span><button onClick={() => onOpen(meeting.id, segment.start_seconds)}>▶ Play clip</button></footer></article>) : <div className="empty-card"><h2>No soundbites yet</h2><p>Add a transcript to a meeting and its first spoken moments will appear here.</p></div>}</div></div>;
}

function Analytics({ meetings, totalActions, completedActions }: { meetings: Meeting[]; totalActions: number; completedActions: number }) {
  const duration = meetings.reduce((sum, meeting) => sum + meeting.duration, 0);
  const rate = totalActions ? Math.round((completedActions / totalActions) * 100) : 0;
  const topicCounts = meetings.flatMap((meeting) => meeting.topics).filter(Boolean).reduce<Record<string, number>>((counts, topic) => ({ ...counts, [topic]: (counts[topic] || 0) + 1 }), {});
  return <div className="page-view"><header className="page-header"><div><span className="eyebrow">WORKSPACE OVERVIEW</span><h1>Analytics</h1><p>Patterns from your recorded conversations.</p></div></header><div className="stats"><Stat label="Meetings recorded" value={String(meetings.length)} hint="All time" /><Stat label="Conversation time" value={fmt(duration)} hint="Across your library" /><Stat label="Action completion" value={`${rate}%`} hint={`${completedActions} of ${totalActions} completed`} /></div><div className="analytics-grid"><article><label>MEETINGS OVER TIME</label><h3>Recent activity</h3><div className="bars">{meetings.slice(0, 7).reverse().map((meeting, index) => <div key={meeting.id}><i style={{ height: `${Math.max(18, Math.min(100, meeting.duration / 28))}%` }} /><span>{index + 1}</span></div>)}</div></article><article><label>TOPICS</label><h3>What you discuss most</h3>{Object.entries(topicCounts).length ? Object.entries(topicCounts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([topic, count]) => <div className="topic-stat" key={topic}><span>{topic}</span><b>{count}</b></div>) : <p className="muted">Topics will appear once meetings are tagged.</p>}</article></div></div>;
}

function GlobalSearch({ query, setQuery, results, onOpen }: { query: string; setQuery: (q: string) => void; results: { meeting: Meeting; segmentMatches: Segment[] }[]; onOpen: (id: number, time: number) => void }) {
  return <div className="page-view"><header className="page-header"><div><span className="eyebrow">EVERY CONVERSATION</span><h1>Global search</h1><p>Search titles, people, summaries, action items, and transcript text.</p></div></header><div className="global-search"><span>⌕</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Try “onboarding”, a person, or a project" /></div>{query ? <div className="search-results"><p className="result-count">{results.length} meeting {results.length === 1 ? "match" : "matches"}</p>{results.map(({ meeting, segmentMatches }) => <article key={meeting.id}><button onClick={() => onOpen(meeting.id, segmentMatches[0]?.start_seconds || 0)}><span className="meeting-icon">✦</span><div><b>{meeting.title}</b><p>{dateText(meeting.held_at)} · {meeting.participants.join(", ")}</p>{segmentMatches.slice(0, 2).map((segment) => <div className="search-snippet" key={segment.id}><time>{fmt(segment.start_seconds)}</time> {highlight(segment.body, query)}</div>)}</div><span className="open-arrow">→</span></button></article>)}</div> : <div className="empty-card"><h2>Search every meeting</h2><p>Results include meeting metadata, AI notes, action items, and every transcript segment.</p></div>}</div>;
}

function Settings({ onToast }: { onToast: (message: string) => void }) {
  return <div className="page-view"><header className="page-header"><div><span className="eyebrow">WORKSPACE</span><h1>Settings</h1><p>Manage your profile and meeting preferences.</p></div></header><div className="settings-card"><label>PROFILE</label><h3>Maya Chen</h3><p>Workspace owner · maya@example.com</p><hr /><label>MEETING DEFAULTS</label><div className="setting-row"><div><b>AI meeting notes</b><span>Generate a notes layout for new meetings</span></div><button className="switch on" onClick={() => onToast("AI notes preference saved")} aria-label="AI meeting notes enabled"><i /></button></div><div className="setting-row"><div><b>Meeting notifications</b><span>Notify me after a meeting is processed</span></div><button className="switch" onClick={() => onToast("Notification preference saved")} aria-label="Meeting notifications"><i /></button></div></div></div>;
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) { return <article><span>{label}</span><b>{value}</b><small>{hint}</small></article>; }
function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) { return <div className="modal-bg" role="dialog" aria-modal="true"><div className="modal"><button className="close" onClick={onClose} aria-label="Close">×</button><span className="eyebrow">MEETING MANAGEMENT</span><h2>{title}</h2>{children}</div></div>; }
function highlight(text: string, term: string) { const index = text.toLowerCase().indexOf(term.toLowerCase()); return index < 0 ? text : <>{text.slice(0, index)}<mark>{text.slice(index, index + term.length)}</mark>{text.slice(index + term.length)}</>; }
