import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

// ── CONSTANTS ────────────────────────────────────────────────
const PRELOADED = [
  { id:"fri", date:"Friday, May 9", shortDate:"Fri", club:"7–9 iron", overall:6.5, swingCount:1, ballFlight:"Highly inconsistent — random misses in all directions", faults:["Inside takeaway","Overswing past parallel","Left arm breakdown"], improvements:["Best setup posture of all sessions","Strong finish position"], ratings:{setup:7,backswing:5,impact:6,finish:8}, priorityFix:"Inside takeaway — root cause of all downstream issues", drill:"Headcover drill: place headcover just inside the ball. Takeaway must avoid clipping it.", notes:"Most variables in the swing — results entirely timing-dependent." },
  { id:"sat", date:"Saturday, May 10", shortDate:"Sat", club:"7–9 iron, PW", overall:6.5, swingCount:1, ballFlight:"Binary — either straight/high or completely off", faults:["Inside takeaway","Steep arm lift at top","Early extension / hip thrust"], improvements:["Less overswing than Friday","Contact improving"], ratings:{setup:6,backswing:6,impact:6,finish:7}, priorityFix:"Inside takeaway causing steep path and early extension chain reaction", drill:"Alignment stick drill: rod outside ball on ground, club tracks away from it.", notes:"Most arm-dominated swing — body rotation missing through impact." },
  { id:"tue", date:"Tuesday, May 13", shortDate:"Tue", club:"7, 8, 9, PW", overall:7.0, swingCount:1, ballFlight:"Consistently high arc, always deviating right", faults:["Inside takeaway","Early extension / hip thrust","Open face at impact"], improvements:["Most consistent swing shape","Good divots and contact","Strong weight transfer","Best finish across all sessions"], ratings:{setup:7,backswing:6,impact:6,finish:8}, priorityFix:"Fix inside takeaway — will straighten path, close face, reduce early extension", drill:"Logo to target: keep glove logo visible to target throughout takeaway. Feels too outside = correct.", notes:"Consistent miss = most fixable swing. Clear progression in repeatability." }
];

// Drill templates — fault string must match AI fault output for dynamic matching
const DRILL_TEMPLATES = [
  { id:1, fault:"Inside takeaway", name:"Headcover Drill", description:"Place a headcover 6 inches inside the ball. Takeaway must avoid clipping it.", steps:["Set headcover just inside ball line","Begin slow takeaway","Club tracks away from headcover","Build speed once grooved"] },
  { id:2, fault:"Inside takeaway", name:"Logo to Target", description:"Keep glove logo facing target during takeaway. When club goes inside, logo rotates down too early.", steps:["Address ball normally","Keep logo facing target to hip height","Feel like club goes 'too outside'","That feeling IS correct — trust it"] },
  { id:3, fault:"Early extension / hip thrust", name:"Chair Drill", description:"Alignment stick touching hips at address. Rotate around it on downswing — don't bump into it.", steps:["Position stick touching hip","Backswing normally","Rotate hips — clear the stick","Belt buckle faces target at finish"] },
  { id:4, fault:"Left arm breakdown", name:"Armpit Glove Drill", description:"Tuck glove under left armpit. When arm disconnects, glove falls — that's your overswing signal.", steps:["Tuck glove under left armpit","Slow backswing","Stop when glove feels loose","Repeat until natural"] },
  { id:5, fault:"Overswing past parallel", name:"Parallel Check", description:"Swing to the top and hold. Shaft should point at target line — not past it.", steps:["Slow backswing to top","Hold position for 2 seconds","Check shaft angle in mirror or phone","Groove the feeling of stopping at parallel"] },
  { id:6, fault:"Open face at impact", name:"Gate Drill", description:"Place two tees either side of the ball 1cm apart. Square contact passes through — open face misses right tee.", steps:["Set tees either side of ball","Normal swing","Ball should pass cleanly between tees","If right tee hit, face was open at impact"] },
];

const RATING_KEYS = ["setup","backswing","impact","finish"];
const PRELOADED_IDS = new Set(PRELOADED.map(s=>s.id));

// ── THEME ────────────────────────────────────────────────────
const C = {
  bg:"#060d08", surface:"#0d1f12", card:"#0f2415", border:"#1a3320",
  accent:"#4ade80", accentDim:"#22c55e", text:"#d4edda", muted:"#4a7a55", dim:"#2d5a38",
  good:"#86efac", goodBg:"#0a1a0e", goodBorder:"#1a5a20",
  bad:"#fca5a5", badBg:"#1a0d0d", badBorder:"#5a2020",
  warn:"#fbbf24", info:"#93c5fd", infoBg:"#0a0f1a"
};

// ── PURE HELPERS ─────────────────────────────────────────────
const SC = s => s >= 7 ? C.accent : s >= 5 ? "#a3e635" : "#f87171";
const avgNum = arr => arr.reduce((a,b)=>a+b,0) / arr.length;

function aggregateSwings(swings) {
  if (!swings?.length) return {};
  const overall = +avgNum(swings.map(s=>s.overall||5)).toFixed(1);
  const ratings = Object.fromEntries(
    RATING_KEYS.map(k => [k, Math.round(avgNum(swings.map(s=>s.ratings?.[k]||5)))])
  );
  const ff = {};
  swings.flatMap(s=>s.faults||[]).forEach(f => { ff[f]=(ff[f]||0)+1; });
  const faults = Object.entries(ff).sort(([,a],[,b])=>b-a).map(([f])=>f);
  const improvements = [...new Set(swings.flatMap(s=>s.improvements||[]))];
  const last = swings[swings.length-1];
  return { overall, ratings, faults, improvements,
    priorityFix: last?.priority_fix || "",
    drill:       last?.drill || "",
    comparison:  last?.comparison || "" };
}

function buildFaultFreq(sessions) {
  const ff = {};
  sessions.flatMap(s=>s.faults||[]).forEach(f => { ff[f]=(ff[f]||0)+1; });
  return ff;
}

function persist(key, value) {
  window.storage.set(key, JSON.stringify(value)).catch(()=>{});
}

// ── SHARED SUB-COMPONENTS (defined outside root to prevent remount) ──
function RatingBoxes({ ratings }) {
  return (
    <div style={{display:"flex",gap:6}}>
      {RATING_KEYS.map(k => {
        const v = ratings?.[k] ?? 5;
        return (
          <div key={k} style={{flex:1,background:v>=7?"#0d3020":v>=5?"#1a2010":"#2d1010",border:`1px solid ${v>=7?"#22c55e":v>=5?"#4a5a20":"#5a2020"}`,borderRadius:6,padding:"8px 4px",textAlign:"center"}}>
            <div style={{fontSize:23,fontFamily:"'Syne',sans-serif",fontWeight:700,color:SC(v),lineHeight:1}}>{v}</div>
            <div style={{fontSize:11,color:C.muted,marginTop:3,textTransform:"uppercase",letterSpacing:"0.06em"}}>{k}</div>
          </div>
        );
      })}
    </div>
  );
}

function Tag({ children, variant="bad" }) {
  const styles = {
    bad:  { bg:C.badBg,  border:C.badBorder,  color:C.bad  },
    good: { bg:C.goodBg, border:C.goodBorder, color:C.good },
  };
  const s = styles[variant];
  return (
    <span style={{display:"inline-block",padding:"3px 9px",background:s.bg,border:`1px solid ${s.border}`,borderRadius:20,fontSize:16,color:s.color,marginRight:5,marginBottom:5}}>
      {children}
    </span>
  );
}

function InfoBox({ label, children, bg=C.bg, accent=C.muted }) {
  return (
    <div style={{padding:"10px 12px",background:bg,borderRadius:6,marginTop:8}}>
      <div style={{fontSize:15,color:accent,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:4}}>{label}</div>
      <div style={{fontSize:17,lineHeight:1.6,color:C.text}}>{children}</div>
    </div>
  );
}

const Icons = {
  grid: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>,
  list: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>,
  add:  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>,
  pen:  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>,
  cam:  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>,
};

const NAV = [
  {id:"dashboard", label:"Home",     icon:Icons.grid},
  {id:"sessions",  label:"Sessions", icon:Icons.list},
  {id:"analyze",   label:"Analyze",  icon:Icons.add},
  {id:"drills",    label:"Drills",   icon:Icons.pen},
];

// ── ROOT COMPONENT ───────────────────────────────────────────
export default function SwingLab() {
  const [sessions,      setSessions]      = useState(PRELOADED);
  const [tab,           setTab]           = useState("dashboard");
  const [expanded,      setExpanded]      = useState(null);
  const [club,          setClub]          = useState("9i");
  const [customClubs,   setCustomClubs]   = useState([]);
  const [newClub,       setNewClub]       = useState("");
  const [showAddClub,   setShowAddClub]   = useState(false);
  const [flight,        setFlight]        = useState("");
  const [dragOver,      setDragOver]      = useState(false);
  const [importMsg,     setImportMsg]     = useState("");
  const [pendingSwings, setPendingSwings] = useState([]);
  const [analyzing,     setAnalyzing]     = useState(false);
  const [progress,      setProgress]      = useState("");
  const [cameraActive,  setCameraActive]  = useState(false);
  const [isRecording,   setIsRecording]   = useState(false);
  const [camError,      setCamError]      = useState("");
  const [compareMode,   setCompareMode]   = useState(false);
  const [compareIds,    setCompareIds]    = useState([]);

  const mediaRecorderRef = useRef(null);
  const streamRef        = useRef(null);
  const chunksRef        = useRef([]);
  const previewRef       = useRef(null);
  const fileRef          = useRef(null);
  const importRef        = useRef(null);

  // ── STORAGE LOAD ─────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const [se, cc] = await Promise.all([
          window.storage.get("swing-extra"),
          window.storage.get("custom-clubs"),
        ]);
        if (se) setSessions([...PRELOADED, ...JSON.parse(se.value)]);
        if (cc) setCustomClubs(JSON.parse(cc.value));
      } catch {}
    })();
  }, []);

  // ── CAMERA CLEANUP ON TAB CHANGE ─────────────────────────
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (previewRef.current) previewRef.current.srcObject = null;
    setCameraActive(false);
    setIsRecording(false);
  }, []);

  useEffect(() => {
    if (tab !== "analyze") stopCamera();
  }, [tab, stopCamera]);

  // ── CAMERA ───────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    setCamError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:"environment" }, audio:false });
      streamRef.current = stream;
      if (previewRef.current) { previewRef.current.srcObject = stream; previewRef.current.play(); }
      setCameraActive(true);
    } catch {
      setCamError("Camera access denied. Use Upload instead.");
    }
  }, []);

  const startRecording = useCallback(() => {
    if (!streamRef.current) return;
    chunksRef.current = [];
    const mime = MediaRecorder.isTypeSupported("video/webm") ? "video/webm" : "video/mp4";
    const mr = new MediaRecorder(streamRef.current, { mimeType: mime });
    mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    mr.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mime });
      // Stop camera first, then process — processVideo ref is stable via useRef trick below
      stopCamera();
      processVideoRef.current(blob);
    };
    mr.start();
    mediaRecorderRef.current = mr;
    setIsRecording(true);
  }, [stopCamera]);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
  }, []);

  // ── FRAME EXTRACTION ─────────────────────────────────────
  const extractFrames = useCallback((file) => new Promise((resolve, reject) => {
    const vid = document.createElement("video");
    vid.muted = true;
    vid.playsInline = true;
    const url = URL.createObjectURL(file);
    vid.src = url;
    vid.addEventListener("loadedmetadata", async () => {
      const dur = vid.duration;
      if (!dur || isNaN(dur)) { URL.revokeObjectURL(url); reject(new Error("Invalid video")); return; }
      const n = Math.min(8, Math.max(4, Math.ceil(dur * 2)));
      const cvs = document.createElement("canvas");
      cvs.width = 480; cvs.height = 640;
      const ctx = cvs.getContext("2d");
      const frames = [];
      for (let i = 0; i < n; i++) {
        const t = i === 0 ? 0.01 : i === n-1 ? dur-0.05 : (dur/(n-1))*i;
        await new Promise(r => {
          vid.currentTime = Math.min(t, dur - 0.01);
          vid.addEventListener("seeked", r, { once:true });
        });
        ctx.drawImage(vid, 0, 0, 480, 640);
        frames.push(cvs.toDataURL("image/jpeg", 0.7).split(",")[1]);
        setProgress(`Extracting frames… ${i+1}/${n}`);
      }
      URL.revokeObjectURL(url);
      resolve(frames);
    });
    vid.addEventListener("error", () => { URL.revokeObjectURL(url); reject(new Error("Video load failed")); });
    vid.load();
  }), []);

  // ── AI CALL ──────────────────────────────────────────────
  const runAI = useCallback(async (frames, swingNum, currentSessions, currentClub, currentFlight) => {
    const ff = buildFaultFreq(currentSessions);
    const persistent = Object.entries(ff).filter(([,c])=>c>=2).map(([f])=>f);
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-opus-4-5",
        max_tokens: 1000,
        system: `You are an expert golf coach. Persistent faults: ${persistent.join(", ") || "none yet"}. Club: ${currentClub}. ${currentFlight ? `Ball flight: ${currentFlight}.` : ""} This is swing #${swingNum} in this session. Respond ONLY with valid JSON — no markdown, no backticks.`,
        messages: [{ role:"user", content: [
          ...frames.map(f => ({ type:"image", source:{ type:"base64", media_type:"image/jpeg", data:f } })),
          { type:"text", text:`Analyze this golf swing. Return ONLY this JSON:
{"ratings":{"setup":7,"backswing":6,"impact":6,"finish":8},"overall":6.5,"faults":["fault1"],"improvements":["improvement1"],"priority_fix":"string","drill":"string","comparison":"1 sentence vs history"}` }
        ]}]
      })
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    const d = await res.json();
    const raw = d.content?.find(c => c.type === "text")?.text || "{}";
    return JSON.parse(raw.replace(/```json|```/g, "").trim());
  }, []);

  // ── PROCESS VIDEO ────────────────────────────────────────
  const processVideo = useCallback(async (file) => {
    if (!file) return;
    setAnalyzing(true);
    setProgress("Loading video…");
    let errorOccurred = false;
    try {
      const frames = await extractFrames(file);
      setProgress("AI analyzing swing…");
      // Pass current values directly — avoids stale closure on sessions/club/flight
      const swingNum = pendingSwings.length + 1;
      const ai = await runAI(frames, swingNum, sessions, club, flight);
      setPendingSwings(prev => [...prev, {
        swingId:     Date.now(),
        ratings:     ai.ratings     || { setup:5, backswing:5, impact:5, finish:5 },
        overall:     ai.overall     || 5,
        faults:      ai.faults      || [],
        improvements:ai.improvements|| [],
        priority_fix:ai.priority_fix|| "",
        drill:       ai.drill       || "",
        comparison:  ai.comparison  || "",
      }]);
    } catch(e) {
      errorOccurred = true;
      setProgress("Error: " + e.message);
      setTimeout(() => setProgress(""), 3000);
    } finally {
      setAnalyzing(false);
      // FIX: only clear progress on success — error message handled above
      if (!errorOccurred) setProgress("");
    }
  }, [extractFrames, runAI, pendingSwings, sessions, club, flight]);

  // Stable ref so startRecording.onstop can always call the latest processVideo
  const processVideoRef = useRef(processVideo);
  useEffect(() => { processVideoRef.current = processVideo; }, [processVideo]);

  const handleFileInput = useCallback(file => {
    if (file?.type.startsWith("video/")) processVideo(file);
  }, [processVideo]);

  // ── SAVE SESSION ─────────────────────────────────────────
  const saveSession = useCallback(() => {
    if (!pendingSwings.length) return;
    const agg = aggregateSwings(pendingSwings);
    const s = {
      id:         `s-${Date.now()}`,
      date:       new Date().toLocaleDateString("en-US", { weekday:"long", month:"long", day:"numeric" }),
      shortDate:  new Date().toLocaleDateString("en-US", { month:"short", day:"numeric" }),
      club,                                   // FIX: was `${club} iron` — broke for Driver/Woods/custom
      ballFlight: flight || "Not specified",
      swingCount: pendingSwings.length,
      swings:     pendingSwings,
      isNew:      true,
      ...agg,
    };
    setSessions(prev => {
      const next = [...prev, s];
      persist("swing-extra", next.filter(x => !PRELOADED_IDS.has(x.id)));
      return next;
    });
    setPendingSwings([]);
    setFlight("");
    setExpanded(s.id);
    setTab("sessions");
  }, [pendingSwings, club, flight]);

  // ── CLUBS ────────────────────────────────────────────────
  const addClub = useCallback(() => {
    const name = newClub.trim();
    if (!name) return;
    setCustomClubs(prev => {
      if (prev.includes(name)) return prev;           // FIX: prevent duplicates
      const next = [...prev, name];
      persist("custom-clubs", next);
      return next;
    });
    setClub(name);
    setNewClub("");
    setShowAddClub(false);
  }, [newClub]);

  const removeClub = useCallback((name) => {
    setCustomClubs(prev => {
      const next = prev.filter(c => c !== name);
      persist("custom-clubs", next);
      return next;
    });
    if (club === name) setClub("9i");
  }, [club]);

  // ── EXPORT / IMPORT ──────────────────────────────────────
  const handleExport = useCallback(() => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ version:2, exportedAt:new Date().toISOString(), sessions }, null, 2)],
        { type:"application/json" })
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `swinglab-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); // FIX: revoke after download
  }, [sessions]);

  const handleImport = useCallback(file => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target.result);
        const imported = data.sessions || data;
        if (!Array.isArray(imported)) throw new Error("Not an array");
        setSessions(prev => {
          const ids = new Set(prev.map(s => s.id));
          const fresh = imported.filter(s => !ids.has(s.id));
          const merged = [...prev, ...fresh];
          persist("swing-extra", merged.filter(x => !PRELOADED_IDS.has(x.id)));
          setImportMsg(`✓ ${fresh.length} session${fresh.length !== 1 ? "s" : ""} imported`);
          setTimeout(() => setImportMsg(""), 3000);
          return merged;
        });
      } catch {
        setImportMsg("✗ Invalid file");
        setTimeout(() => setImportMsg(""), 3000);
      }
    };
    reader.readAsText(file);
  }, []);

  // ── COMPARE ──────────────────────────────────────────────
  const toggleCompare = useCallback(id => {
    setCompareIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id)
      : prev.length >= 2 ? [prev[1], id]
      : [...prev, id]
    );
  }, []);

  // ── MEMOIZED DERIVED DATA ────────────────────────────────
  const chartData = useMemo(() =>
    sessions.map(s => ({ name:s.shortDate, Overall:s.overall, Setup:s.ratings.setup, Impact:s.ratings.impact })),
    [sessions]
  );

  const faultFreq = useMemo(() => {
    const ff = buildFaultFreq(sessions);
    return Object.entries(ff).sort(([,a],[,b]) => b-a).slice(0, 4);
  }, [sessions]);

  const overallAvg = useMemo(() =>
    (sessions.reduce((a,s) => a+s.overall, 0) / sessions.length).toFixed(1),
    [sessions]
  );

  const totalSwings = useMemo(() =>
    sessions.reduce((a,s) => a + (s.swingCount||1), 0),
    [sessions]
  );

  // FIX: Dynamic drills computed from actual fault frequency across all sessions
  const dynamicDrills = useMemo(() => {
    const ff = buildFaultFreq(sessions);
    return DRILL_TEMPLATES
      .map(d => {
        const faultKey = Object.keys(ff).find(f => f.toLowerCase().includes(d.fault.toLowerCase()));
        const count = faultKey ? ff[faultKey] : 0;
        const pct = count / sessions.length;
        return { ...d, sessionCount:count, priority: pct >= 1 ? "HIGH" : pct >= 0.5 ? "MEDIUM" : "LOW" };
      })
      .filter(d => d.sessionCount > 0)
      .sort((a,b) => b.sessionCount - a.sessionCount);
  }, [sessions]);

  const pendingAgg = useMemo(() =>
    pendingSwings.length ? aggregateSwings(pendingSwings) : null,
    [pendingSwings]
  );

  // ══════════════════════════════════════════════════════════
  // ── DASHBOARD ────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════
  const Dashboard = () => (
    <div>
      <div style={{display:"flex",gap:10,padding:"16px 16px 0"}}>
        {[["AVG",overallAvg,C.accent],["SESSIONS",sessions.length,C.text],["SWINGS",totalSwings,"#86efac"]].map(([label,val,color])=>(
          <div key={label} style={{flex:1,background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"12px 10px",textAlign:"center"}}>
            <div style={{fontSize:28,fontFamily:"'Syne',sans-serif",fontWeight:800,color,lineHeight:1}}>{val}</div>
            <div style={{fontSize:11,color:C.muted,letterSpacing:"0.12em",textTransform:"uppercase",marginTop:4}}>{label}</div>
          </div>
        ))}
      </div>

      <div style={{fontSize:16,color:C.muted,letterSpacing:"0.15em",textTransform:"uppercase",padding:"18px 20px 8px"}}>Progression</div>
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,margin:"0 16px",padding:"16px 4px 8px"}}>
        <ResponsiveContainer width="100%" height={150}>
          <LineChart data={chartData} margin={{top:0,right:16,left:-20,bottom:0}}>
            <XAxis dataKey="name" stroke={C.dim} tick={{fontSize:16,fill:C.muted}}/>
            <YAxis domain={[0,10]} stroke={C.dim} tick={{fontSize:16,fill:C.muted}}/>
            <Tooltip contentStyle={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,fontSize:17,fontFamily:"JetBrains Mono"}}/>
            <Line type="monotone" dataKey="Overall" stroke={C.accent} strokeWidth={2.5} dot={{fill:C.accent,r:4}}/>
            <Line type="monotone" dataKey="Setup"   stroke="#86efac" strokeWidth={1.5} strokeDasharray="4 3" dot={{fill:"#86efac",r:2}}/>
            <Line type="monotone" dataKey="Impact"  stroke="#a3e635" strokeWidth={1.5} strokeDasharray="4 3" dot={{fill:"#a3e635",r:2}}/>
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div style={{fontSize:16,color:C.muted,letterSpacing:"0.15em",textTransform:"uppercase",padding:"18px 20px 8px"}}>Persistent Faults</div>
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,margin:"0 16px",padding:"14px"}}>
        {faultFreq.map(([fault,count]) => (
          <div key={fault} style={{marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
              <span style={{fontSize:17}}>{fault}</span>
              <span style={{fontSize:16,color:count>=sessions.length?"#f87171":count>=2?"#fbbf24":C.muted}}>{count}/{sessions.length}</span>
            </div>
            <div style={{height:4,background:C.border,borderRadius:2,overflow:"hidden"}}>
              <div style={{height:"100%",width:`${(count/sessions.length)*100}%`,background:count>=sessions.length?"#f87171":count>=2?"#fbbf24":C.accent,borderRadius:2}}/>
            </div>
          </div>
        ))}
      </div>

      {dynamicDrills[0] && (
        <div style={{background:"#0d2a10",border:"1px solid #1a5a20",borderRadius:8,margin:"16px",padding:"14px"}}>
          <div style={{fontSize:15,color:C.accent,letterSpacing:"0.12em",marginBottom:6}}>⚡ TOP PRIORITY — {dynamicDrills[0].sessionCount}/{sessions.length} SESSIONS</div>
          <div style={{fontSize:17,fontFamily:"'Syne',sans-serif",fontWeight:700,marginBottom:4}}>{dynamicDrills[0].name}</div>
          <div style={{fontSize:17,color:C.good,lineHeight:1.6}}>{dynamicDrills[0].description}</div>
        </div>
      )}
    </div>
  );

  // ══════════════════════════════════════════════════════════
  // ── COMPARE VIEW ─────────────────────────────────────────
  // ══════════════════════════════════════════════════════════
  const CompareView = () => {
    const [a, b] = compareIds.map(id => sessions.find(s => s.id === id));
    if (!a || !b) return null;
    const shared = a.faults.filter(f => b.faults.includes(f));
    const delta  = (b.overall - a.overall).toFixed(1);
    return (
      <div style={{margin:"0 16px 12px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,padding:"14px"}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
          {[a,b].map((s,i) => (
            <div key={s.id} style={{background:C.card,border:`1px solid ${i===0?"#3b82f6":"#a855f7"}`,borderRadius:8,padding:"10px"}}>
              <div style={{fontSize:15,color:i===0?"#93c5fd":"#d8b4fe",letterSpacing:"0.08em",marginBottom:3}}>{i===0?"SESSION A":"SESSION B"}</div>
              <div style={{fontSize:15,fontWeight:600,marginBottom:1}}>{s.shortDate}</div>
              <div style={{fontSize:16,color:C.muted,marginBottom:6}}>{s.club}</div>
              <div style={{fontSize:26,fontFamily:"'Syne',sans-serif",fontWeight:800,color:SC(s.overall),lineHeight:1}}>{s.overall}</div>
            </div>
          ))}
        </div>

        {RATING_KEYS.map(k => {
          const av = a.ratings[k], bv = b.ratings[k];
          return (
            <div key={k} style={{marginBottom:8}}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:16,marginBottom:3}}>
                <span style={{color:"#93c5fd",fontWeight:600}}>{av}</span>
                <span style={{color:C.muted,textTransform:"uppercase",letterSpacing:"0.08em"}}>{k}</span>
                <span style={{color:"#d8b4fe",fontWeight:600}}>{bv}</span>
              </div>
              <div style={{position:"relative",height:6,background:C.border,borderRadius:3}}>
                <div style={{position:"absolute",left:0,height:"100%",width:`${(av/10)*100}%`,background:"#3b82f6",borderRadius:3,opacity:0.8}}/>
                <div style={{position:"absolute",right:0,height:"100%",width:`${(bv/10)*100}%`,background:"#a855f7",borderRadius:3,opacity:0.8}}/>
              </div>
            </div>
          );
        })}

        {shared.length > 0 && (
          <div style={{background:C.badBg,border:`1px solid ${C.badBorder}`,borderRadius:6,padding:"10px",margin:"10px 0"}}>
            <div style={{fontSize:15,color:"#f87171",letterSpacing:"0.1em",marginBottom:5}}>SHARED FAULTS — PERSISTING</div>
            {shared.map(f => <Tag key={f}>{f}</Tag>)}
          </div>
        )}

        <div style={{display:"flex",alignItems:"center",gap:12,background:C.card,borderRadius:6,padding:"10px 12px",marginTop:10}}>
          <div style={{fontSize:15,color:C.muted,textTransform:"uppercase",letterSpacing:"0.1em"}}>Δ OVERALL</div>
          <div style={{fontSize:24,fontFamily:"'Syne',sans-serif",fontWeight:800,color:parseFloat(delta)>=0?C.accent:"#f87171"}}>{parseFloat(delta)>=0?"+":""}{delta}</div>
          <div style={{fontSize:16,color:C.muted}}>{parseFloat(delta)>0?"Improved A→B":parseFloat(delta)<0?"Regressed A→B":"No change"}</div>
        </div>
      </div>
    );
  };

  // ══════════════════════════════════════════════════════════
  // ── SESSIONS ─────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════
  const Sessions = () => (
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"18px 16px 8px"}}>
        <div style={{fontSize:16,color:C.muted,letterSpacing:"0.15em",textTransform:"uppercase"}}>Sessions ({sessions.length})</div>
        <div style={{display:"flex",gap:6}}>
          <button onClick={()=>{setCompareMode(m=>!m);setCompareIds([]);}}
            style={{fontSize:15,padding:"5px 10px",background:compareMode?"#0d2a15":C.surface,border:`1px solid ${compareMode?C.accentDim:C.border}`,borderRadius:4,color:compareMode?C.accent:C.muted,cursor:"pointer",fontFamily:"'JetBrains Mono',monospace",letterSpacing:"0.08em"}}>COMPARE</button>
          <input ref={importRef} type="file" accept=".json" style={{display:"none"}} onChange={e=>{handleImport(e.target.files?.[0]);e.target.value="";}}/>
          <button onClick={()=>importRef.current?.click()} style={{fontSize:15,padding:"5px 10px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:4,color:C.muted,cursor:"pointer",fontFamily:"'JetBrains Mono',monospace"}}>IMPORT</button>
          <button onClick={handleExport} style={{fontSize:15,padding:"5px 10px",background:"#0d2a15",border:`1px solid ${C.accentDim}`,borderRadius:4,color:C.accent,cursor:"pointer",fontFamily:"'JetBrains Mono',monospace"}}>EXPORT</button>
        </div>
      </div>

      {importMsg && (
        <div style={{margin:"0 16px 8px",padding:"8px 12px",background:importMsg.startsWith("✓")?C.goodBg:C.badBg,border:`1px solid ${importMsg.startsWith("✓")?C.goodBorder:C.badBorder}`,borderRadius:6,fontSize:17,color:importMsg.startsWith("✓")?C.accent:C.bad}}>
          {importMsg}
        </div>
      )}

      {compareMode && (
        <div style={{margin:"0 16px 8px",padding:"8px 12px",background:C.infoBg,border:"1px solid #1e3a5f",borderRadius:6,fontSize:16,color:C.info}}>
          {compareIds.length===0?"Tap 2 sessions to compare":compareIds.length===1?"Select 1 more session":"↑ Comparison shown above"}
        </div>
      )}

      {compareMode && compareIds.length === 2 && <CompareView/>}

      {[...sessions].reverse().map(s => {
        const isSel = compareIds.includes(s.id);
        const ci    = compareIds.indexOf(s.id);
        return (
          <div key={s.id}
            style={{background:expanded===s.id?"#0d2a15":C.card,border:`1px solid ${isSel?(ci===0?"#3b82f6":"#a855f7"):expanded===s.id?C.accentDim:C.border}`,borderRadius:8,padding:"14px",margin:"0 16px 10px",cursor:"pointer",transition:"all 0.15s"}}
            onClick={()=>compareMode?toggleCompare(s.id):setExpanded(expanded===s.id?null:s.id)}>

            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div style={{flex:1,minWidth:0,paddingRight:12}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  {compareMode && <div style={{width:14,height:14,borderRadius:3,border:`2px solid ${isSel?(ci===0?"#3b82f6":"#a855f7"):C.dim}`,background:isSel?(ci===0?"#1e3a5f":"#2d1060"):"transparent",flexShrink:0}}/>}
                  <div style={{fontSize:16,fontWeight:600,color:s.isNew?C.accent:C.text}}>{s.date}{s.isNew?" ✦":""}</div>
                </div>
                <div style={{fontSize:16,color:C.muted,marginTop:3}}>{s.club} · {(s.swingCount||1)>1?`${s.swingCount} swings`:"1 swing"}</div>
                <div style={{fontSize:16,color:C.dim,marginTop:1}}>{s.ballFlight?.slice(0,44)}{s.ballFlight?.length>44?"…":""}</div>
              </div>
              <div style={{textAlign:"right",flexShrink:0}}>
                <div style={{fontSize:26,fontFamily:"'Syne',sans-serif",fontWeight:800,color:SC(s.overall),lineHeight:1}}>{s.overall}</div>
                <div style={{fontSize:15,color:C.muted}}>/10</div>
              </div>
            </div>

            {!compareMode && expanded === s.id && (
              <div style={{marginTop:14,borderTop:`1px solid ${C.border}`,paddingTop:14}}>
                <RatingBoxes ratings={s.ratings}/>
                <div style={{marginTop:12}}>
                  <div style={{fontSize:15,color:C.muted,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:6}}>Faults</div>
                  {s.faults.map(f=><Tag key={f}>{f}</Tag>)}
                </div>
                <div style={{marginTop:4}}>
                  <div style={{fontSize:15,color:C.muted,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:6}}>Improvements</div>
                  {s.improvements.map(i=><Tag key={i} variant="good">{i}</Tag>)}
                </div>
                {s.priorityFix && <InfoBox label="Priority Fix">{s.priorityFix}</InfoBox>}
                {s.drill && <InfoBox label="Drill" bg={C.goodBg} accent={C.accent}><span style={{color:C.good}}>{s.drill}</span></InfoBox>}
                {s.swings?.length > 1 && (
                  <div style={{marginTop:10}}>
                    <div style={{fontSize:15,color:C.muted,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:6}}>Individual Swings</div>
                    {s.swings.map((sw,i) => (
                      <div key={sw.swingId} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,padding:"8px 10px",marginBottom:5,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                        <span style={{fontSize:17,color:C.muted}}>Swing {i+1}</span>
                        <div style={{display:"flex",gap:8,alignItems:"center"}}>
                          {RATING_KEYS.map(k=><span key={k} style={{fontSize:16,color:SC(sw.ratings[k])}}>{sw.ratings[k]}</span>)}
                          <span style={{fontSize:16,fontWeight:700,color:SC(sw.overall),minWidth:24,textAlign:"right"}}>{sw.overall}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {s.notes && <InfoBox label="Notes" bg={C.surface}><span style={{color:C.muted}}>{s.notes}</span></InfoBox>}
              </div>
            )}
          </div>
        );
      })}

      <div style={{margin:"4px 16px 16px",padding:"9px 12px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,fontSize:15,color:C.dim,lineHeight:1.6}}>
        ⚠ Export sessions regularly. Preloaded sessions (Fri/Sat/Tue) are always safe.
      </div>
    </div>
  );

  // ══════════════════════════════════════════════════════════
  // ── ANALYZE ──────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════
  const Analyze = () => (
    <div>
      {/* Session config */}
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,margin:"16px 16px 12px",padding:"14px"}}>
        <div style={{display:"flex",gap:10}}>
          {/* Club selector */}
          <div style={{flex:1}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
              <div style={{fontSize:15,color:C.muted,letterSpacing:"0.12em",textTransform:"uppercase"}}>Club</div>
              <button onClick={()=>setShowAddClub(s=>!s)} style={{fontSize:15,color:showAddClub?C.accent:C.muted,background:"none",border:"none",cursor:"pointer",fontFamily:"'JetBrains Mono',monospace",padding:0,letterSpacing:"0.08em"}}>{showAddClub?"cancel":"+ add"}</button>
            </div>
            {showAddClub ? (
              <div style={{display:"flex",gap:6}}>
                <input value={newClub} onChange={e=>setNewClub(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addClub()} placeholder="e.g. 4i, 3H, 60°…" autoFocus
                  style={{flex:1,background:C.bg,border:`1px solid ${C.accentDim}`,borderRadius:6,color:C.text,padding:"9px 10px",fontSize:15,fontFamily:"'JetBrains Mono',monospace",outline:"none"}}/>
                <button onClick={addClub} style={{padding:"9px 12px",background:C.accent,border:"none",borderRadius:6,color:"#060d08",fontWeight:700,fontSize:17,cursor:"pointer",fontFamily:"'Syne',sans-serif"}}>Add</button>
              </div>
            ) : (
              <select value={club} onChange={e=>setClub(e.target.value)} style={{width:"100%",background:C.bg,border:`1px solid ${C.border}`,borderRadius:6,color:C.text,padding:"9px 10px",fontSize:15,fontFamily:"'JetBrains Mono',monospace",cursor:"pointer",outline:"none"}}>
                <optgroup label="— Driver / Woods">
                  <option value="Driver">Driver</option>
                  <option value="5W">5 Wood</option>
                </optgroup>
                <optgroup label="— Irons">
                  {["5i","6i","7i","8i","9i"].map(c=><option key={c} value={c}>{c.replace("i"," Iron")}</option>)}
                </optgroup>
                <optgroup label="— Wedges">
                  <option value="PW">PW</option>
                  <option value="SW">SW</option>
                </optgroup>
                {customClubs.length > 0 && (
                  <optgroup label="— My Clubs">
                    {customClubs.map(c=><option key={c} value={c}>{c}</option>)}
                  </optgroup>
                )}
              </select>
            )}
            {customClubs.length > 0 && !showAddClub && (
              <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:6}}>
                {customClubs.map(c => (
                  <div key={c} style={{display:"flex",alignItems:"center",gap:3,padding:"2px 8px 2px 10px",background:club===c?"#0d2a15":C.surface,border:`1px solid ${club===c?C.accentDim:C.border}`,borderRadius:20,cursor:"pointer"}} onClick={()=>setClub(c)}>
                    <span style={{fontSize:16,color:club===c?C.accent:C.muted}}>{c}</span>
                    <span onClick={e=>{e.stopPropagation();removeClub(c);}} style={{fontSize:16,color:C.dim,lineHeight:1,cursor:"pointer",paddingLeft:2}}>×</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Ball flight */}
          <div style={{flex:2}}>
            <div style={{fontSize:15,color:C.muted,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:6}}>Ball Flight</div>
            <input value={flight} onChange={e=>setFlight(e.target.value)} placeholder="e.g. high, going right…"
              style={{width:"100%",background:C.bg,border:`1px solid ${C.border}`,borderRadius:6,color:C.text,padding:"9px 10px",fontSize:15,fontFamily:"'JetBrains Mono',monospace",outline:"none",boxSizing:"border-box"}}/>
          </div>
        </div>
      </div>

      {/* Pending swings */}
      {pendingSwings.length > 0 && pendingAgg && (
        <div style={{background:"#0d2a15",border:`1px solid ${C.accentDim}`,borderRadius:8,margin:"0 16px 12px",padding:"14px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <div style={{fontSize:16,color:C.accent,letterSpacing:"0.12em",textTransform:"uppercase"}}>{pendingSwings.length} Swing{pendingSwings.length>1?"s":""} · This Session</div>
            <div style={{fontSize:28,fontFamily:"'Syne',sans-serif",fontWeight:800,color:SC(pendingAgg.overall)}}>{pendingAgg.overall}</div>
          </div>
          <RatingBoxes ratings={pendingAgg.ratings}/>
          <div style={{marginTop:10}}>
            {pendingSwings.map((sw,i) => (
              <div key={sw.swingId} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:i<pendingSwings.length-1?`1px solid ${C.border}`:"none"}}>
                <span style={{fontSize:17,color:C.muted}}>Swing {i+1}</span>
                <div style={{display:"flex",gap:10,alignItems:"center"}}>
                  {RATING_KEYS.map(k=><span key={k} style={{fontSize:16,color:SC(sw.ratings[k])}}>{sw.ratings[k]}</span>)}
                  <span style={{fontSize:16,fontWeight:700,color:SC(sw.overall),minWidth:24,textAlign:"right"}}>{sw.overall}</span>
                </div>
              </div>
            ))}
          </div>
          <div style={{display:"flex",gap:8,marginTop:12}}>
            <button onClick={saveSession} style={{flex:2,padding:"11px",background:C.accent,borderRadius:6,border:"none",color:"#060d08",fontWeight:700,fontSize:15,fontFamily:"'Syne',sans-serif",cursor:"pointer"}}>Save Session</button>
            <button onClick={()=>setPendingSwings([])} style={{flex:1,padding:"11px",background:C.surface,borderRadius:6,border:`1px solid ${C.border}`,color:C.muted,fontSize:17,fontFamily:"'JetBrains Mono',monospace",cursor:"pointer"}}>Discard</button>
          </div>
        </div>
      )}

      {/* Upload / Record / Analyzing */}
      {analyzing ? (
        <div style={{margin:"0 16px 12px",border:`2px dashed ${C.accentDim}`,borderRadius:10,padding:"36px 20px",textAlign:"center"}}>
          <div style={{fontSize:32,marginBottom:10}}>⚙</div>
          <div style={{fontSize:16,color:C.accent,marginBottom:6}}>{progress}</div>
          <div style={{fontSize:16,color:C.muted}}>Comparing against {sessions.length} session history…</div>
        </div>
      ) : cameraActive ? (
        <div style={{margin:"0 16px 12px"}}>
          <video ref={previewRef} muted playsInline style={{width:"100%",borderRadius:10,border:`2px solid ${isRecording?"#f87171":C.border}`,background:"#000",display:"block",maxHeight:300,objectFit:"cover"}}/>
          <div style={{display:"flex",gap:8,marginTop:8}}>
            {!isRecording ? (
              <>
                <button onClick={startRecording} style={{flex:2,padding:"12px",background:"#dc2626",borderRadius:6,border:"none",color:"#fff",fontWeight:700,fontSize:16,fontFamily:"'Syne',sans-serif",cursor:"pointer"}}>● Record</button>
                <button onClick={stopCamera} style={{flex:1,padding:"12px",background:C.surface,borderRadius:6,border:`1px solid ${C.border}`,color:C.muted,fontSize:17,fontFamily:"'JetBrains Mono',monospace",cursor:"pointer"}}>Cancel</button>
              </>
            ) : (
              <button onClick={stopRecording} style={{width:"100%",padding:"14px",background:"#7f1d1d",borderRadius:6,border:"2px solid #dc2626",color:"#fca5a5",fontWeight:700,fontSize:16,fontFamily:"'Syne',sans-serif",cursor:"pointer"}}>■ Stop & Analyze</button>
            )}
          </div>
          {isRecording && <div style={{textAlign:"center",marginTop:8,fontSize:16,color:"#f87171",letterSpacing:"0.1em"}}>● RECORDING</div>}
        </div>
      ) : (
        <div style={{margin:"0 16px 12px",display:"flex",gap:8}}>
          <input ref={fileRef} type="file" accept="video/*" multiple style={{display:"none"}} onChange={async e=>{
  const files = Array.from(e.target.files||[]);
  for(const file of files) await handleFileInput(file);
}}/>
          <div onClick={()=>fileRef.current?.click()}
            onDragOver={e=>{e.preventDefault();setDragOver(true);}}
            onDragLeave={()=>setDragOver(false)}
            onDrop={e=>{e.preventDefault();setDragOver(false);handleFileInput(e.dataTransfer.files[0]);}}
            style={{flex:2,border:`2px dashed ${dragOver?C.accent:C.border}`,borderRadius:10,padding:"28px 16px",background:dragOver?"#0d2a15":C.bg,textAlign:"center",cursor:"pointer",transition:"all 0.2s"}}>
            <div style={{fontSize:28,marginBottom:8}}>⛳</div>
            <div style={{fontSize:16,fontFamily:"'Syne',sans-serif",fontWeight:700,color:C.accent,marginBottom:4}}>{pendingSwings.length>0?"Add Swing":"Upload Video"}</div>
            <div style={{fontSize:16,color:C.muted}}>Tap or drop video file</div>
          </div>
          <div onClick={startCamera} style={{flex:1,border:`2px solid ${C.border}`,borderRadius:10,padding:"28px 10px",background:C.card,textAlign:"center",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:8}}>
            <div style={{color:C.accent}}>{Icons.cam}</div>
            <div style={{fontSize:16,color:C.muted,fontFamily:"'JetBrains Mono',monospace"}}>Record</div>
          </div>
        </div>
      )}

      {camError && <div style={{margin:"0 16px 12px",padding:"10px 12px",background:C.badBg,border:`1px solid ${C.badBorder}`,borderRadius:6,fontSize:17,color:C.bad}}>{camError}</div>}
      {progress && !analyzing && <div style={{margin:"0 16px 12px",padding:"10px 12px",background:C.badBg,border:`1px solid ${C.badBorder}`,borderRadius:6,fontSize:17,color:C.bad}}>{progress}</div>}

      {!pendingSwings.length && !cameraActive && !analyzing && (
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,margin:"0 16px 16px",padding:"14px"}}>
          {[["01","Upload or Record","Multiple swings per session supported"],
            ["02","Auto frame extraction","6–8 key frames per swing"],
            ["03","AI analysis","Compared against your full fault history"],
            ["04","Aggregate scoring","Session score = average across all swings"]
          ].map(([n,t,d]) => (
            <div key={n} style={{display:"flex",gap:12,marginBottom:10,alignItems:"flex-start"}}>
              <div style={{fontSize:16,color:C.accent,fontWeight:700,minWidth:20}}>{n}</div>
              <div><div style={{fontSize:15,fontWeight:600}}>{t}</div><div style={{fontSize:16,color:C.muted,marginTop:1}}>{d}</div></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // ══════════════════════════════════════════════════════════
  // ── DRILLS ───────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════
  const Drills = () => (
    <div>
      <div style={{fontSize:16,color:C.muted,letterSpacing:"0.15em",textTransform:"uppercase",padding:"18px 20px 8px"}}>
        Drill Plan — {dynamicDrills.length} active drill{dynamicDrills.length!==1?"s":""}
      </div>
      {dynamicDrills.length === 0 && (
        <div style={{margin:"0 16px",padding:"20px",background:C.card,border:`1px solid ${C.border}`,borderRadius:8,textAlign:"center",fontSize:17,color:C.muted}}>
          No faults recorded yet. Upload a swing to generate your drill plan.
        </div>
      )}
      {dynamicDrills.map(d => {
        const bc  = d.priority==="HIGH"?"#dc2626":d.priority==="MEDIUM"?"#d97706":C.border;
        const tc  = d.priority==="HIGH"?"#fca5a5":d.priority==="MEDIUM"?"#fcd34d":C.good;
        const tbg = d.priority==="HIGH"?"#450a0a":d.priority==="MEDIUM"?"#451a03":C.surface;
        return (
          <div key={d.id} style={{background:C.card,border:`1px solid ${bc}`,borderRadius:8,padding:"14px",margin:"0 16px 10px"}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
              <span style={{fontSize:15,padding:"2px 7px",background:tbg,color:tc,borderRadius:3,letterSpacing:"0.1em"}}>{d.priority}</span>
              <span style={{fontSize:15,color:C.muted}}>{d.sessionCount}/{sessions.length} sessions</span>
            </div>
            <div style={{fontSize:17,fontFamily:"'Syne',sans-serif",fontWeight:700,marginBottom:2}}>{d.name}</div>
            <div style={{fontSize:16,color:C.accent,marginBottom:8}}>{d.fault}</div>
            <div style={{fontSize:17,color:C.text,lineHeight:1.6,marginBottom:10}}>{d.description}</div>
            <div style={{borderTop:`1px solid ${C.border}`,paddingTop:10}}>
              {d.steps.map((step,i) => (
                <div key={i} style={{display:"flex",gap:10,marginBottom:6}}>
                  <div style={{fontSize:16,color:C.accent,fontWeight:700,minWidth:16}}>{i+1}.</div>
                  <div style={{fontSize:17,color:"#a7d5b4",lineHeight:1.5}}>{step}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );

  // ══════════════════════════════════════════════════════════
  // ── SHELL ────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=JetBrains+Mono:wght@400;600&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        body{background:#060d08;-webkit-font-smoothing:antialiased;}
        ::-webkit-scrollbar{width:3px;}
        ::-webkit-scrollbar-thumb{background:#1a3320;border-radius:2px;}
        select option{background:#0d1f12;}
        input::placeholder{color:#2d5a38;}
        optgroup{color:#4a7a55;font-style:normal;}
      `}</style>
      <div style={{background:C.bg,minHeight:"100vh",fontFamily:"'JetBrains Mono',monospace",color:C.text,display:"flex",flexDirection:"column",maxWidth:480,margin:"0 auto"}}>
        <div style={{padding:"14px 20px 12px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
          <div style={{fontSize:23,fontFamily:"'Syne',sans-serif",fontWeight:800,letterSpacing:"0.06em",color:C.accent}}>SWING LAB</div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            {pendingSwings.length > 0 && <div style={{fontSize:15,color:C.warn,border:`1px solid ${C.warn}`,padding:"3px 8px",borderRadius:4,letterSpacing:"0.1em"}}>{pendingSwings.length} PENDING</div>}
            <div style={{fontSize:15,color:C.muted,border:`1px solid ${C.border}`,padding:"3px 8px",borderRadius:4,letterSpacing:"0.1em"}}>{sessions.length} SESSIONS</div>
          </div>
        </div>

        <div style={{flex:1,overflowY:"auto",paddingBottom:72}}>
          {tab==="dashboard" && <Dashboard/>}
          {tab==="sessions"  && <Sessions/>}
          {tab==="analyze"   && <Analyze/>}
          {tab==="drills"    && <Drills/>}
        </div>

        <div style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:480,background:C.bg,borderTop:`1px solid ${C.border}`,display:"flex",zIndex:100}}>
          {NAV.map(({id,label,icon}) => (
            <button key={id} onClick={()=>setTab(id)}
              style={{flex:1,padding:"11px 4px 9px",background:"none",border:"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3,color:tab===id?C.accent:C.dim,transition:"color 0.2s",position:"relative"}}>
              {icon}
              <span style={{fontSize:11,letterSpacing:"0.1em",textTransform:"uppercase"}}>{label}</span>
              {id==="analyze" && pendingSwings.length>0 && <div style={{position:"absolute",top:8,right:"50%",transform:"translateX(8px)",width:8,height:8,background:C.warn,borderRadius:"50%"}}/>}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}