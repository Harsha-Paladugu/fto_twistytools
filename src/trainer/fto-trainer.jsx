import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { createCore } from "./fto-core.mjs";

// ============================================================
// FTO trainer (M4) — case drill over the authored algorithm sheet
//   Drill: setup scrambles (inverted case alg + random AUF) onto sheet
//   cases, timed; Recap: one pass over every enabled case.
// Further modes (full-solve timer/analysis, recognition, one-look) are
// scoped with the user and arrive after M5's step solver (they need
// pruning-table search, which the FTO state space denies the M-era BFS).
// ============================================================

// ---------- shared site layers (loaded by trainer.html before this bundle) ----------
const E = window.OOEngine;
const R = window.OORender;
const core = createCore(E);

const STORE_KEY = "fto-trainer-v1";
const DATA_URL = "data/fto_algs.json";

// subset chip colors (arbitrary UI palette, assigned in authored order)
const SUBSET_COLORS = ["#3577cc", "#27975a", "#cf4d44", "#9355bd", "#cd7c20", "#74882b"];

// ---------- helpers ----------
const fmt = (ms) => (ms / 1000).toFixed(2);
const shuffled = (a) => {
  const arr = a.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

// rotation-ish tokens tinted (algs-page convention): {X,Y} brackets, o-suffix
// rotations, T tips
const isRotTok = (t) => /^\{/.test(t) || /o'?2?$/.test(t) || /^T2?'?$/.test(t);

// diagram through the shared renderer (front/back diamond views)
function Net({ state, w }) {
  const html = R && state ? R.netSVG(state, w || 240, { thumb: true }) : "";
  return <div className="skewbnet" dangerouslySetInnerHTML={{ __html: html }} />;
}

// alg text as evenly-spaced tokens, rotations tinted
function AlgText({ text }) {
  return (
    <span className="mono alg">
      {String(text).split(/\s+/).filter(Boolean).map((t, i) => (
        <span key={i} className={isRotTok(t) ? "tok rot" : "tok"}>{t}</span>
      ))}
    </span>
  );
}

export default function FtoTrainer() {
  const modelRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [boot, setBoot] = useState({ stage: "load", msg: "" });

  // ---------- selection (defaults resolve lazily against the model) ----------
  const [subsetSel, setSubsetSel] = useState(null);   // null = default (first subset)
  const [groupSel, setGroupSel] = useState({});       // subset -> enabled group values (missing = all)
  const [caseOff, setCaseOff] = useState(() => new Set());   // DISABLED case uids
  const [caseKnown, setCaseKnown] = useState(() => new Set()); // KNOWN case uids
  const [scope, setScope] = useState("all");
  const [mode, setMode] = useState("drill");
  const [setupOpen, setSetupOpen] = useState(true);

  const model = () => modelRef.current;
  const subsetOn = useCallback((key) => {
    if (subsetSel === null) { const m = model(); return !!m && m.subsets.length > 0 && m.subsets[0].key === key; }
    return subsetSel.includes(key);
  }, [subsetSel]);
  const groupsOf = useCallback((sub) => {
    const sel = groupSel[sub.key];
    return sel === undefined ? sub.groups.map((g) => g.value) : sel;
  }, [groupSel]);

  // ---------- run state ----------
  const [current, setCurrent] = useState(null);
  const [phase, setPhase] = useState("ready");
  const [elapsed, setElapsed] = useState(0);
  const [last, setLast] = useState(null);             // { ms, drill }
  const [caseStats, setCaseStats] = useState({});     // uid -> {subset, name, n, best, sum}
  const [session, setSession] = useState([]);
  const [recap, setRecap] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [expandedSubset, setExpandedSubset] = useState(null);
  const [caseBrowser, setCaseBrowser] = useState(null); // subset key whose browser is open

  const t0 = useRef(0);
  const raf = useRef(0);
  const stoppedAt = useRef(-Infinity); // NOT 0: a warm-cache boot beats the 350ms tap guard
  const loadedStore = useRef(false);

  // ---------- boot: stored state + alg data (no tables — see fto-core.mjs) ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await window.storage.get(STORE_KEY);
        if (res && res.value && !cancelled) {
          const d = JSON.parse(res.value);
          // strict shape validation — unknown/legacy blobs are simply ignored
          if (d && typeof d === "object") {
            if (Array.isArray(d.subsetSel)) setSubsetSel(d.subsetSel.filter((k) => typeof k === "string"));
            if (d.groupSel && typeof d.groupSel === "object") setGroupSel(d.groupSel);
            if (Array.isArray(d.caseOff)) setCaseOff(new Set(d.caseOff.filter((x) => typeof x === "string")));
            if (Array.isArray(d.caseKnown)) setCaseKnown(new Set(d.caseKnown.filter((x) => typeof x === "string")));
            if (["all", "learning", "known"].includes(d.scope)) setScope(d.scope);
            if (["drill", "recap"].includes(d.mode)) setMode(d.mode);
            if (typeof d.setupOpen === "boolean") setSetupOpen(d.setupOpen);
            if (d.caseStats && typeof d.caseStats === "object") {
              const cs = {};
              for (const [k, st] of Object.entries(d.caseStats)) {
                if (st && typeof st.n === "number" && typeof st.sum === "number") cs[k] = st;
              }
              setCaseStats(cs);
            }
          }
        }
      } catch (e) { /* first run / foreign blob */ }
      loadedStore.current = true;
      try {
        const json = await fetch(DATA_URL).then((r) => {
          if (!r.ok) throw new Error("HTTP " + r.status + " loading alg data");
          return r.json();
        });
        if (cancelled) return;
        modelRef.current = core.buildModel(json);
        setReady(true);
      } catch (e) {
        if (!cancelled) setBoot({ stage: "error", msg: String((e && e.message) || e) });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ---------- persistence ----------
  const saveTimer = useRef(0);
  const persist = useCallback((over) => {
    try {
      window.storage.set(STORE_KEY, JSON.stringify({
        subsetSel, groupSel, caseOff: [...caseOff], caseKnown: [...caseKnown],
        scope, mode, setupOpen, caseStats, ...over,
      })).catch(() => {});
    } catch (e) {}
  }, [subsetSel, groupSel, caseOff, caseKnown, scope, mode, setupOpen, caseStats]);
  useEffect(() => {
    if (!loadedStore.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(persist, 400);
  }, [persist]);

  // ---------- the practice pool ----------
  const entries = useMemo(() => {
    if (!ready) return [];
    const out = [];
    for (const sub of model().subsets) {
      if (!subsetOn(sub.key)) continue;
      const on = new Set(groupsOf(sub));
      for (const g of sub.groups) {
        if (!on.has(g.value)) continue;
        for (const c of g.cases) {
          if (caseOff.has(c.uid)) continue;
          const kn = caseKnown.has(c.uid);
          if (scope === "learning" && kn) continue;
          if (scope === "known" && !kn) continue;
          out.push(c);
        }
      }
    }
    return out;
  }, [ready, subsetOn, groupsOf, caseOff, caseKnown, scope]);

  // ---------- problem generation ----------
  const nextDrill = useCallback(() => {
    if (!entries.length) { setCurrent(null); return; }
    for (let i = 0; i < 10; i++) {
      const cur = core.makeDrill(entries[Math.floor(Math.random() * entries.length)]);
      if (cur) { setCurrent(cur); return; }
    }
    setCurrent(null);
  }, [entries]);

  const startRecap = useCallback(() => {
    const queue = shuffled(entries);
    setRecap({ queue, idx: 0 });
    setCurrent(queue.length ? core.makeDrill(queue[0]) : null);
  }, [entries]);

  const advance = useCallback(() => {
    if (mode === "drill") { nextDrill(); return; }
    setRecap((r) => {
      if (!r) return r;
      const idx = r.idx + 1;
      if (idx >= r.queue.length) { setCurrent(null); return { ...r, idx }; }
      setCurrent(core.makeDrill(r.queue[idx]));
      return { ...r, idx };
    });
  }, [mode, nextDrill]);

  // Regenerate on boot/mode switch (stage reset) and on pool edits. A pool
  // edit only swaps the PENDING problem — it must not clear a stop-screen
  // reveal (e.g. marking the just-solved case known), so phase/last are reset
  // only on mode switches or mid-run edits.
  const genMode = useRef(null);
  useEffect(() => {
    if (!ready) return;
    const modeSwitch = genMode.current !== mode;
    genMode.current = mode;
    if (modeSwitch || phase === "running") { setPhase("ready"); setLast(null); }
    if (mode === "drill") nextDrill();
    else startRecap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, mode, entries]);

  // ---------- timer ----------
  const tick = useCallback(() => {
    setElapsed(performance.now() - t0.current);
    raf.current = requestAnimationFrame(tick);
  }, []);
  const startTimer = useCallback(() => {
    if (!current || !current.scramble) return;
    cancelAnimationFrame(raf.current);
    t0.current = performance.now();
    setElapsed(0);
    setPhase("running");
    raf.current = requestAnimationFrame(tick);
  }, [current, tick]);
  const stopTimer = useCallback(() => {
    cancelAnimationFrame(raf.current);
    const ms = performance.now() - t0.current;
    stoppedAt.current = performance.now();
    setElapsed(ms);
    setPhase("stopped");
    if (current) {
      setLast({ ms, drill: current });
      setSession((s) => [...s.slice(-49), { ms, subset: current.subset }]);
      setCaseStats((cs) => {
        const prev = cs[current.uid] || { n: 0, best: Infinity, sum: 0 };
        return { ...cs, [current.uid]: { subset: current.subset, name: current.c.name, n: prev.n + 1, best: Math.min(prev.best, ms), sum: prev.sum + ms } };
      });
    }
    advance();
  }, [current, advance]);
  const trigger = useCallback(() => {
    if (!ready) return;
    if (phase === "running") { stopTimer(); return; }
    if (performance.now() - stoppedAt.current < 350) return;
    startTimer();
  }, [ready, phase, startTimer, stopTimer]);

  // ---------- keyboard ----------
  useEffect(() => {
    const down = (e) => {
      if (e.repeat) return;
      const tag = e.target && e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (caseBrowser) { if (e.code === "Escape") setCaseBrowser(null); return; }
      if (phase === "stopped" && e.code === "KeyK" && last) {
        e.preventDefault();
        const k = last.drill.uid;
        setCaseKnown((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
        return;
      }
      if (phase === "running") { e.preventDefault(); stopTimer(); return; }
      if (e.code === "Space") { e.preventDefault(); trigger(); }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [phase, trigger, stopTimer, last, caseBrowser]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  useEffect(() => { if (phase !== "running") cancelAnimationFrame(raf.current); }, [phase]);

  // ---------- selection toggles ----------
  const toggleSubset = (key) => {
    const m = model();
    const cur = subsetSel === null ? (m.subsets.length ? [m.subsets[0].key] : []) : subsetSel;
    setSubsetSel(cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]);
  };
  const toggleGroup = (sub, value) => {
    const cur = groupsOf(sub);
    setGroupSel((s) => ({ ...s, [sub.key]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] }));
  };
  const toggleCase = (uid) =>
    setCaseOff((s) => { const n = new Set(s); if (n.has(uid)) n.delete(uid); else n.add(uid); return n; });
  const toggleKnown = (uid) =>
    setCaseKnown((s) => { const n = new Set(s); if (n.has(uid)) n.delete(uid); else n.add(uid); return n; });

  const subColor = (key) => {
    const m = model();
    const i = m ? m.subsets.findIndex((s) => s.key === key) : -1;
    return SUBSET_COLORS[(i + SUBSET_COLORS.length) % SUBSET_COLORS.length];
  };
  const enabledCount = (sub) => {
    const on = new Set(groupsOf(sub));
    let total = 0, off = 0;
    for (const g of sub.groups) if (on.has(g.value)) for (const c of g.cases) { total++; if (caseOff.has(c.uid)) off++; }
    return { on: total - off, total };
  };
  const knownCount = (sub) => sub.cases.filter((c) => caseKnown.has(c.uid)).length;

  // ---------- stats aggregation ----------
  const uidIndex = useMemo(() => {
    if (!ready) return new Map();
    const m = new Map();
    for (const sub of model().subsets) for (const c of sub.cases) m.set(c.uid, c);
    return m;
  }, [ready]);
  const subsetAgg = useMemo(() => {
    const agg = {};
    for (const [k, st] of Object.entries(caseStats)) {
      const a = agg[st.subset] || { subset: st.subset, n: 0, best: Infinity, sum: 0, cases: 0, keys: [] };
      a.n += st.n; a.best = Math.min(a.best, st.best); a.sum += st.sum; a.cases += 1; a.keys.push(k);
      agg[st.subset] = a;
    }
    return agg;
  }, [caseStats]);

  const resetStats = () => {
    setCaseStats({});
    setSession([]);
    setLast(null);
    persist({ caseStats: {} });
  };

  // ---------- alg list for a finished drill ----------
  function AlgList({ drill }) {
    const spec = core.caseSpec(drill.c);
    const rows = spec.rows.filter((r) => r.state);
    if (!rows.length) return <div className="empty">No algorithms for this case yet.</div>;
    return (
      <div className="alglist">
        {rows.map((row, i) => {
          const tok = core.rowAufToken(row, drill);
          const p = E.parseAlg(row.a.alg);
          return (
            <div key={i} className="algrow">
              <span className={"ychip mono" + (tok ? "" : " blank")}>{tok || ""}</span>
              <AlgText text={row.a.alg} />
              <span className="ratetag">{E.countMoves(p || []) + " moves"}</span>
              {tok === null ? <span className="warntag" title={row.a.note || "authored against a different exact state of this case (orientation, working slots or triangle choice differs)"}>variant</span> : null}
            </div>
          );
        })}
        {drill.c.moves_note ? <div className="hint" style={{ textAlign: "left", marginTop: 4 }}>({drill.c.moves_note})</div> : null}
      </div>
    );
  }

  // ---------- case browser modal ----------
  function CaseBrowser({ subKey }) {
    const sub = model().subsets.find((s) => s.key === subKey);
    const [grp, setGrp] = useState(sub && sub.groups[0] ? sub.groups[0].value : "");
    if (!sub) return null;
    const g = sub.groups.find((x) => x.value === grp) || sub.groups[0];
    const list = g.cases;
    return (
      <div className="overlay" onPointerDown={(e) => { if (e.target === e.currentTarget) setCaseBrowser(null); }}>
        <div className="modal">
          <div className="modalhead">
            <div>
              <div className="modaltitle">{sub.name} cases</div>
              <span className="tag" style={{ "--cdot": subColor(sub.key) }}>
                <span className="dot" />{enabledCount(sub).on}/{enabledCount(sub).total} on · {knownCount(sub)} known
              </span>
            </div>
            <button className="closebtn" onClick={() => setCaseBrowser(null)}>{"×"}</button>
          </div>
          <div className="chips" style={{ marginBottom: 8 }}>
            {sub.groups.map((x) => (
              <button key={x.value} className={"mode" + (x.value === g.value ? " on" : "")}
                onClick={() => setGrp(x.value)}>{x.label}</button>
            ))}
          </div>
          <div className="presets" style={{ margin: "0 0 10px" }}>
            <button className="preset" onClick={() => setCaseOff((s) => { const n = new Set(s); for (const c of list) n.delete(c.uid); return n; })}>enable shown</button>
            <button className="preset" onClick={() => setCaseOff((s) => { const n = new Set(s); for (const c of list) n.add(c.uid); return n; })}>disable shown</button>
            <button className="preset" onClick={() => setCaseKnown((s) => { const n = new Set(s); for (const c of list) n.add(c.uid); return n; })}>mark shown known</button>
            <button className="preset" onClick={() => setCaseKnown((s) => { const n = new Set(s); for (const c of list) n.delete(c.uid); return n; })}>mark shown unknown</button>
          </div>
          <div className="chips">
            {list.map((c) => {
              const kn = caseKnown.has(c.uid);
              return (
                <span key={c.uid} className="markwrap">
                  <button className={"chip" + (caseOff.has(c.uid) ? "" : " on")}
                    style={{ "--cdot": subColor(sub.key) }} onClick={() => toggleCase(c.uid)}>
                    <span className="dot" />{c.name}{kn ? " ✓" : ""}
                  </button>
                  <button className={"markbtn ok" + (kn ? " sel" : "")} title="mark known"
                    onClick={() => toggleKnown(c.uid)}>K</button>
                </span>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ---------- render ----------
  const recapDone = mode === "recap" && recap && recap.idx >= recap.queue.length;
  const m = model();

  return (
    <div className="app">
      <div className="frame">
        <header>
          <div className="brandrow">
            <div className="brand">FTO <span>Trainer</span></div>
          </div>
          <div className="spacer" />
          <button className="gear" onClick={() => setSettingsOpen((o) => !o)}>Settings</button>
        </header>

        {settingsOpen && (
          <div className="settings">
            <span>Stats persist between sessions{window.OOAccount && window.OOAccount.user ? " (synced to your account)" : ""}.</span>
            <button className="danger" onClick={resetStats}>Reset all stats</button>
          </div>
        )}

        <div className="chips" style={{ alignItems: "center" }}>
          <div className="modes">
            {[["drill", "Drill"], ["recap", "Recap"]].map(([v, l]) => (
              <button key={v} className={"mode" + (mode === v ? " on" : "")} onClick={() => setMode(v)}>{l}</button>
            ))}
          </div>
          <span className="grouplabel">practice</span>
          <div className="modes">
            {[["all", "All"], ["learning", "Learning"], ["known", "Known"]].map(([v, l]) => (
              <button key={v} className={"mode" + (scope === v ? " on" : "")} onClick={() => setScope(v)}>{l}</button>
            ))}
          </div>
        </div>

        <div className="card setupcard">
          <button className="setuphead" onClick={() => setSetupOpen((o) => !o)}>
            <strong>Setup</strong>
            <span className="setupsum">
              {ready ? `${entries.length} case${entries.length === 1 ? "" : "s"} in the pool` : "loading…"}
            </span>
            <span className="chev">{setupOpen ? "▾" : "▸"}</span>
          </button>
          {setupOpen && ready && (
            <div className="setupbody">
              {m.subsets.map((sub) => (
                <details key={sub.key} className="setgrp" open={subsetOn(sub.key)}>
                  <summary>
                    <button className={"chip" + (subsetOn(sub.key) ? " on" : "")}
                      style={{ "--cdot": subColor(sub.key) }}
                      onClick={(e) => { e.preventDefault(); toggleSubset(sub.key); }}>
                      <span className="dot" />{sub.name}
                      <span className="ct">{sub.cases.length}</span>
                    </button>
                    <span className="ct">{enabledCount(sub).on} on · {knownCount(sub)} known</span>
                  </summary>
                  <div className="chips" style={{ marginTop: 8 }}>
                    <span className="grouplabel">groups</span>
                    {sub.groups.map((g) => (
                      <button key={g.value} className={"chip" + (groupsOf(sub).includes(g.value) ? " on" : "")}
                        style={{ "--cdot": subColor(sub.key) }} onClick={() => toggleGroup(sub, g.value)}>
                        <span className="dot" />{g.label}<span className="ct">{g.cases.length}</span>
                      </button>
                    ))}
                  </div>
                  <div className="chips">
                    <button className="preset" onClick={() => setCaseBrowser(sub.key)}>cases…</button>
                  </div>
                </details>
              ))}
            </div>
          )}
        </div>

        {mode === "recap" && recap && recap.queue.length > 0 && (
          <div className="recapbar">
            <span className="mono">{Math.min(recap.idx, recap.queue.length)}/{recap.queue.length}</span>
            <div className="rtrack"><div className="rfill" style={{ width: `${(Math.min(recap.idx, recap.queue.length) / recap.queue.length) * 100}%` }} /></div>
            <button className="preset" onClick={startRecap}>restart</button>
          </div>
        )}

        {/* ---------- stage ---------- */}
        {!ready ? (
          <div className="stage" style={{ cursor: "default" }}>
            <div className="loading">
              {boot.stage === "error" ? "Couldn’t start the trainer: " + boot.msg : "Loading…"}
            </div>
          </div>
        ) : recapDone ? (
          <div className="stage" style={{ cursor: "default", textAlign: "center" }}>
            <div className="scramble" style={{ textAlign: "center" }}>Recap complete</div>
            <div className="hint" style={{ marginTop: 10 }}>{recap.queue.length} cases covered</div>
            <button className="restart" onClick={startRecap}>Run it again</button>
          </div>
        ) : !current ? (
          <div className="stage" style={{ cursor: "default" }}>
            <div className="empty" style={{ padding: "40px 0", textAlign: "center" }}>
              {entries.length === 0
                ? (scope === "learning" ? "Nothing left to learn in this selection — every enabled case is marked known."
                  : scope === "known" ? "No cases marked known yet in this selection."
                  : "Pick at least one subset and group in Setup to start.")
                : "Couldn’t generate a scramble — try other cases."}
            </div>
          </div>
        ) : (
          <div className="stage" onPointerDown={(e) => { e.preventDefault(); trigger(); }}>
            <div className="stagegrid">
              <div className="scramble">{current.scramble}</div>
              <Net state={current.state} w={240} />
            </div>
            <div className={"timer" + (phase === "running" ? " running" : "")}>{fmt(elapsed)}</div>
            {phase === "stopped" && last ? (
              <div className="reveal" onPointerDown={(e) => e.stopPropagation()}>
                <span className="tag" style={{ "--cdot": subColor(last.drill.subset) }}>
                  <span className="dot" />{last.drill.subset}
                </span>
                <span className="casename">{last.drill.c.name}</span>
                {last.drill.c.group ? <span className="bartag">{last.drill.c.group}</span> : null}
                {(() => {
                  const k = last.drill.uid;
                  const isK = caseKnown.has(k);
                  return (
                    <button className={"markbtn ok" + (isK ? " sel" : "")} title="mark known (K)"
                      onClick={() => setCaseKnown((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; })}>
                      {isK ? "Known ✓" : "Mark known"}
                    </button>
                  );
                })()}
              </div>
            ) : (
              <div className="hint">{phase === "running" ? "tap or any key to stop" : "tap or space to start"}</div>
            )}
            {phase === "stopped" && last ? (
              <div className="analysis" onPointerDown={(e) => e.stopPropagation()}>
                {last.drill.c.recognition ? <div className="hint" style={{ textAlign: "left", marginBottom: 4 }}>{last.drill.c.recognition}</div> : null}
                <AlgList drill={last.drill} />
              </div>
            ) : null}
          </div>
        )}

        {/* ---------- stats + session ---------- */}
        <div className="panelrow">
          <div className="card">
            <h3>Drill stats</h3>
            {Object.keys(subsetAgg).length === 0 ? (
              <div className="empty">No solves yet. Times land here, grouped by subset.</div>
            ) : (
              <table>
                <thead><tr><th>Subset</th><th>Solves</th><th>Cases seen</th><th>Best</th><th>Mean</th></tr></thead>
                <tbody>
                  {Object.keys(subsetAgg).sort().map((sk) => {
                    const a = subsetAgg[sk];
                    return (
                      <tr key={sk} className="setrow" onClick={() => setExpandedSubset(expandedSubset === sk ? null : sk)}>
                        <td className="name">
                          <span className="dot" style={{ background: subColor(a.subset) }} />
                          {a.subset}
                          <span className="chev">{expandedSubset === sk ? "▾" : "▸"}</span>
                        </td>
                        <td className="mono">{a.n}</td>
                        <td className="mono">{a.cases}</td>
                        <td className="mono">{fmt(a.best)}</td>
                        <td className="mono">{fmt(a.sum / a.n)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {expandedSubset && subsetAgg[expandedSubset] && (
              <div className="casegrid">
                {subsetAgg[expandedSubset].keys
                  .map((k) => [k, caseStats[k]])
                  .sort((a, b) => b[1].sum / b[1].n - a[1].sum / a[1].n)
                  .map(([k, st]) => {
                    const c = uidIndex.get(k);
                    const spec = c ? core.caseSpec(c) : null;
                    return (
                      <div key={k} className="casecard">
                        {spec && spec.ok ? <Net state={spec.anchor.state} w={120} /> : null}
                        <div className="casenums">
                          <span className="mono">{fmt(st.sum / st.n)}</span>
                          <span className="casesub">{st.name}</span>
                          <span className="casesub">best {fmt(st.best)} · {st.n}×</span>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
          <div className="card">
            <h3>Session</h3>
            {session.length === 0 ? (
              <div className="empty">Recent times show up here.</div>
            ) : (
              <div className="times">
                {session.slice(-24).map((t, i) => (
                  <span key={i} className="timepill" style={{ "--cdot": subColor(t.subset) }}>{fmt(t.ms)}</span>
                ))}
              </div>
            )}
          </div>
        </div>

        {caseBrowser && <CaseBrowser subKey={caseBrowser} />}
      </div>
    </div>
  );
}
