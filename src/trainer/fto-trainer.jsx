import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { createCore, SEP } from "./fto-core.mjs";

// ============================================================
// FTO trainer (M4) — case drill over the authored algorithm sheet
//   Drill: setup scrambles (inverted case alg + random AUF) onto sheet
//   cases, timed; Recap: one pass over every enabled case.
//   Bencisco steps (step trainers v4 — one section for every step drill):
//   the user multi-selects a CONSECUTIVE run of Bencisco steps (first
//   center / first triple / second triple / second center / third center —
//   core.spanPlan validates; fc-led runs reach at most the second triple).
//   Single-regime runs route to the original drills: the white-center
//   drill (10-move scramble, masked diagram, counting toggle + exact
//   optimal-length difficulty picker, God's number 6/7 pinned), the
//   triples drills (sealed 16-move scrambles, TRUE turn-metric targets)
//   and the centers drills (appended machine-optimal presolves, the
//   RESTRICTED triple-preserving {R,U,Rw} metric). Multi-regime runs are
//   SPAN drills: the PHASED step-optimal target (each regime segment
//   solved to its true optimum in its own contract, minimized over every
//   optimal-endstate chain — fto-core spanDP), one continuous reveal line
//   per chain with relative {X,Y} junction brackets, every line re-proved
//   end-to-end. The finish steps (step trainers v5) are SHEET-ALGORITHM
//   drills over the fetched alg data (core.buildFinish — no BFS tables):
//   LBT = uniform sheet-solvable before-LBT states, target = fewest turns
//   over the applicable LBT entries; L3T = uniform over the coset states
//   BOTH sheet systems solve, and the reveal shows the 1L3T line AND the
//   1LP → TCP chain (user spec); lbt+l3t spans share the phased target.
//   Center steps cannot span into the finish steps (the retired last-center
//   edges residue sits between — spanPlan reason 'c4gap'). Tables load per
//   selection (buildFirstCenter in-page; loadOrBuildF2T / loadOrBuildC23
//   from IndexedDB; buildFinish in-page ~1s); generation is async behind a
//   searching note. No timer: the shared move-count answer flow,
//   optimal-solve rates per step selection (stepStats), one session list.
// Further steps extend core.SPAN_STEPS and this section; full-solve/
// recognition/one-look modes are scoped with the user.
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

// diagram through the shared renderer (front/back diamond views); mask =
// facelet indices to neutral-fill (step trainers show only their pieces)
function Net({ state, w, mask }) {
  const html = R && state ? R.netSVG(state, w || 240, { thumb: true, mask }) : "";
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

  // ---------- Bencisco step trainer (one section for every step drill) ----------
  const fcRef = useRef(null);                          // OOTables.buildFirstCenter bundle
  const f2tRef = useRef(null);                         // OOTables.loadOrBuildF2T bundle
  const ctRef = useRef(null);                          // OOTables.loadOrBuildC23 bundle
  const finRef = useRef(null);                         // core.buildFinish bundle (LBT/L3T)
  const jsonRef = useRef(null);                        // the raw fetched alg JSON (FIN input)
  const fcSolsCache = useRef(null);                    // { drill, res } — reveal memos
  const f2tSolsCache = useRef(null);
  const c23SolsCache = useRef(null);
  const spanSolsCache = useRef(null);
  const finSolsCache = useRef(null);
  const stepGen = useRef(0);                           // async-generation sequence guard
  const [stepSel, setStepSel] = useState(["fc"]);      // selected step ids (persisted)
  const [stepStatus, setStepStatus] = useState("idle");// idle | building | ready | error
  const [stepBusy, setStepBusy] = useState(false);     // a drill search is in flight
  const [stepStats, setStepStats] = useState({});      // stat key -> { n, opt } (persisted)
  const [stepSession, setStepSession] = useState([]);  // recent [{ count, more, optimal, correct }]
  const [fcMetric, setFcMetric] = useState("token");   // fc counting: slice turns count as 1
  const [fcTarget, setFcTarget] = useState(0);         // fc-only: 0 = any, else exact optimal length

  // step-selection plan (validation + routing live in the core)
  const plan = useMemo(() => core.spanPlan(stepSel), [stepSel]);
  // stats are keyed by the span key, fc-containing selections split by metric
  const statKeyOf = (d) =>
    d.kind === "fc" ? (d.metric === "native" ? "fc@native" : "fc")
    : d.kind === "f2t" ? { first: "t1", second: "t2", both: "t1+t2" }[d.mode]
    : d.kind === "c23" ? { second: "sc", third: "c3", both: "sc+c3" }[d.mode]
    : d.kind === "lbt" || d.kind === "l3t" ? d.kind
    : d.spanKey + (d.metric === "native" ? "@native" : "");
  const STEP_SHORT = { fc: "first center", t1: "first triple", t2: "second triple", sc: "second center", c3: "third center",
                       lbt: "last bottom triple", l3t: "last 3 triples" };
  const SPECIAL_LABELS = { "t1+t2": "both triples", "sc+c3": "second + third centers" };
  const stepLabelOf = (key) => {
    const native = key.endsWith("@native");
    const base = native ? key.slice(0, -7) : key;
    const label = SPECIAL_LABELS[base] || base.split("+").map((s) => STEP_SHORT[s] || s).join(" + ");
    return label + (native ? " (face turns)" : "");
  };

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
            if (["drill", "recap", "steps"].includes(d.mode)) setMode(d.mode);
            if (typeof d.setupOpen === "boolean") setSetupOpen(d.setupOpen);
            if (["token", "native"].includes(d.fcMetric)) setFcMetric(d.fcMetric);
            if (Number.isInteger(d.fcTarget) && d.fcTarget >= 0 && d.fcTarget <= 7) setFcTarget(d.fcTarget);
            // legacy blobs: the pre-merge "fc" chip and the separate Triples
            // ("f2t") / Centers ("c23") chips all land in the steps section
            // with the equivalent step selection.
            if (d.mode === "fc") { setMode("steps"); setStepSel(["fc"]); }
            if (d.mode === "f2t") {
              setMode("steps");
              setStepSel({ first: ["t1"], second: ["t2"], both: ["t1", "t2"] }[d.f2tMode] || ["t1", "t2"]);
            }
            if (d.mode === "c23") {
              setMode("steps");
              setStepSel({ first: ["fc"], second: ["sc"], third: ["c3"], both: ["sc", "c3"] }[d.c23Mode] || ["sc"]);
            }
            // current-format selection wins over any legacy derivation
            if (Array.isArray(d.stepSel) && d.stepSel.length &&
                d.stepSel.every((x) => core.SPAN_STEPS.includes(x)))
              setStepSel(d.stepSel.slice());
            // stats: legacy per-mode objects migrate into the step keys once;
            // a stored stepStats field then overrides key by key.
            {
              const ss = {};
              const take = (obj, map) => {
                if (!obj || typeof obj !== "object") return;
                for (const [k, key] of Object.entries(map)) {
                  const st = obj[k];
                  if (st && typeof st.n === "number" && typeof st.opt === "number" && st.n > 0)
                    ss[key] = { n: st.n, opt: st.opt };
                }
              };
              take(d.fcStats, { token: "fc", native: "fc@native" });
              take(d.f2tStats, { first: "t1", second: "t2", both: "t1+t2" });
              take(d.c23Stats, { second: "sc", third: "c3", both: "sc+c3" });
              if (d.stepStats && typeof d.stepStats === "object") {
                for (const [k, st] of Object.entries(d.stepStats))
                  if (st && typeof st.n === "number" && typeof st.opt === "number") ss[k] = { n: st.n, opt: st.opt };
              }
              if (Object.keys(ss).length) setStepStats(ss);
            }
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
        jsonRef.current = json;
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
        scope, mode, setupOpen, caseStats, fcMetric, fcTarget, stepSel, stepStats, ...over,
      })).catch(() => {});
    } catch (e) {}
  }, [subsetSel, groupSel, caseOff, caseKnown, scope, mode, setupOpen, caseStats, fcMetric, fcTarget, stepSel, stepStats]);
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

  const fcGn = (metric) => {
    const FC = fcRef.current;
    if (FC) return metric === "native" ? FC.gn16 : FC.gn24;
    return metric === "native" ? 7 : 6;   // the pinned values, until the build lands
  };

  // ---------- step tables (built on demand, per selection) ----------
  // The selection decides what loads: pure first-center drills need only the
  // small in-page buildFirstCenter bundle (~a quarter second); anything with
  // triples or centers reads the IndexedDB bundles (F2T always — scrambles,
  // presolves and triple targets; C23 only when a center step is selected),
  // so a drill never waits on tables it does not read. The cleanup must
  // reset the status when it cancels a pending build: otherwise leaving the
  // mode inside the defer window would strand stepStatus at "building" with
  // no timer, bricking the mode until reload.
  useEffect(() => {
    if (mode !== "steps") return;
    if (!plan.ok) { setStepStatus("idle"); return; }
    // every move-search span needs the FC bundle: the span environment
    // (landing anchors, rebase maps, the primary entry holds the reveal
    // junctions target) is derived against it even when the fc step itself
    // is not selected. The finish steps (lbt/l3t and their span) need only
    // the FIN bundle — built in-page from the fetched alg data.
    const finKind = plan.kind === "lbt" || plan.kind === "l3t" ||
      (plan.kind === "span" && plan.start === "lbt");
    const needFIN = finKind;
    // a restored lbt/l3t selection can commit before the alg JSON arrives —
    // stay in "building" until the fetch lands (the `ready` dep re-fires us)
    if (needFIN && !jsonRef.current) { setStepStatus("building"); return; }
    const needFC = !finKind && (stepSel.includes("fc") || plan.kind === "span");
    const needFT = !finKind && plan.kind !== "fc";
    const needCT = !finKind && (plan.kind === "c23" ||
      (plan.kind === "span" && plan.phases.some((p) => p.kind === "ctr")));
    if ((!needFC || fcRef.current) && (!needFT || f2tRef.current) &&
        (!needCT || ctRef.current) && (!needFIN || finRef.current)) {
      setStepStatus("ready");
      return;
    }
    setStepStatus("building");
    let cancelled = false;
    // defer past the paint so the "building" note shows during the build
    const id = setTimeout(async () => {
      try {
        if (needFIN && !finRef.current) {
          finRef.current = core.buildFinish(jsonRef.current);
          if (cancelled) return;
        }
        if (needFC && !fcRef.current) {
          fcRef.current = window.OOTables.buildFirstCenter(E);
          if (cancelled) return;
        }
        if (needFT && !f2tRef.current) {
          const FT = await window.OOTables.loadOrBuildF2T(E);
          if (cancelled) return;
          f2tRef.current = FT;
        }
        if (needCT && !ctRef.current) {
          const CT = await window.OOTables.loadOrBuildC23(E);
          if (cancelled) return;
          ctRef.current = CT;
        }
        setStepStatus("ready");
      } catch (e) {
        if (!cancelled) setStepStatus("error: " + String((e && e.message) || e));
      }
    }, 30);
    return () => {
      cancelled = true;
      clearTimeout(id);
      setStepStatus((s) => (s === "building" ? "idle" : s));
    };
  }, [mode, stepSel, plan, ready]);

  // ---------- problem generation ----------
  const nextDrill = useCallback(() => {
    if (!entries.length) { setCurrent(null); return; }
    for (let i = 0; i < 10; i++) {
      const cur = core.makeDrill(entries[Math.floor(Math.random() * entries.length)]);
      if (cur) { setCurrent(cur); return; }
    }
    setCurrent(null);
  }, [entries]);

  // The pure first-center drill is a cheap coordinate-level rejection sample
  // and runs inline; every other step drill runs an exact search that can
  // take seconds on deep states, so they are deferred past a paint (the
  // stage shows a "searching" note) and guarded against selection changes
  // that land while they run. Span reveals are precomputed right after the
  // drill lands so the answer click never blocks on the retained DP re-run.
  const nextStep = useCallback(() => {
    const seq = ++stepGen.current;              // cancels any in-flight search
    if (!plan.ok) { setStepBusy(false); setCurrent(null); return; }
    const FCb = fcRef.current, FT = f2tRef.current, CTb = ctRef.current;
    if (plan.kind === "fc") {
      setStepBusy(false);
      if (!FCb) { setCurrent(null); return; }
      const d = core.makeFcDrill(FCb, { metric: fcMetric, target: fcTarget });
      if (!d) { setCurrent(null); return; }
      setCurrent({
        ...d, subset: "STEP",
        uid: "STEP" + SEP + statKeyOf(d) + "-" + d.optimal,
        c: { name: "optimal " + d.optimal + (d.metric === "native" ? " (face turns)" : "") },
      });
      return;
    }
    const FINb = finRef.current;
    const finKind = plan.kind === "lbt" || plan.kind === "l3t" ||
      (plan.kind === "span" && plan.start === "lbt");
    if (finKind ? !FINb
        : (!FT || (plan.kind === "c23" && !CTb) ||
           (plan.kind === "span" && (!FCb || (plan.start !== "fc" && !CTb))))) { setCurrent(null); return; }
    setCurrent(null);
    setStepBusy(true);
    setTimeout(() => {
      if (stepGen.current !== seq || genMode.current !== "steps") return;
      let d = null;
      if (plan.kind === "f2t") d = core.makeF2tDrill(FT, { mode: plan.mode });
      else if (plan.kind === "c23") d = core.makeC23Drill(FT, CTb, { mode: plan.mode });
      else if (plan.kind === "lbt") d = core.makeLbtDrill(FINb);
      else if (plan.kind === "l3t") d = core.makeL3tDrill(FINb);
      else d = core.makeSpanDrill(FCb, FT, CTb, plan, { metric: fcMetric }, undefined, FINb);
      if (stepGen.current !== seq || genMode.current !== "steps") return;
      setStepBusy(false);
      if (!d) { setCurrent(null); return; }
      // the precompute must cache the SAME object the reveal later receives
      // (SpanSolutions compares by identity), so spread before caching
      const cur = { ...d, subset: "STEP", uid: "STEP" + SEP + statKeyOf(d) + "-" + d.optimal };
      setCurrent(cur);
      if (cur.kind === "span") {
        setTimeout(() => {
          if (stepGen.current !== seq) return;
          try {
            if (!spanSolsCache.current || spanSolsCache.current.drill !== cur)
              spanSolsCache.current = { drill: cur, res: core.spanSolutions(FCb, FT, CTb, cur, 10, FINb) };
          } catch (e) { /* the reveal click recomputes on a cache miss */ }
        }, 60);
      }
    }, 30);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, fcMetric, fcTarget]);

  const startRecap = useCallback(() => {
    const queue = shuffled(entries);
    setRecap({ queue, idx: 0 });
    setCurrent(queue.length ? core.makeDrill(queue[0]) : null);
  }, [entries]);

  const advance = useCallback(() => {
    if (mode === "steps") { nextStep(); return; }
    if (mode === "drill") { nextDrill(); return; }
    setRecap((r) => {
      if (!r) return r;
      const idx = r.idx + 1;
      if (idx >= r.queue.length) { setCurrent(null); return { ...r, idx }; }
      setCurrent(core.makeDrill(r.queue[idx]));
      return { ...r, idx };
    });
  }, [mode, nextDrill, nextStep]);

  // Regenerate on boot/mode switch (stage reset) and on pool edits. A pool
  // edit only swaps the PENDING problem — it must not clear a stop-screen
  // reveal (e.g. marking the just-solved case known), so phase/last are reset
  // only on mode switches or mid-run edits.
  const genMode = useRef(null);
  useEffect(() => {
    if (!ready) return;
    const modeSwitch = genMode.current !== mode;
    genMode.current = mode;
    // Step trainers have no timer: any regeneration (new options, or the
    // build landing) resets to a fresh scramble awaiting an answer.
    if (mode === "steps") { setPhase("ready"); setLast(null); nextStep(); return; }
    if (modeSwitch || phase === "running") { setPhase("ready"); setLast(null); }
    if (mode === "drill") nextDrill();
    else startRecap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, mode, entries, fcMetric, fcTarget, stepStatus, stepSel]);

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

  // ---------- step-trainer answer flow (no timer: self-reported move count) ----------
  // Shared by the first-center and first-two-triples modes. The buttons
  // offered for a drill whose optimal is `opt`: the optimal itself and a few
  // above, then an "opt+4 or more" bucket. There is no below-optimal button —
  // the optimal is proven, so you cannot legitimately beat it.
  const isStepKind = (d) => !!d && (d.kind === "fc" || d.kind === "f2t" || d.kind === "c23" ||
                                    d.kind === "lbt" || d.kind === "l3t" || d.kind === "span");
  const fcAnswerButtons = (opt) => {
    const out = [];
    for (let k = 0; k <= 3; k++) out.push({ count: opt + k, label: String(opt + k), more: false });
    out.push({ count: opt + 4, label: opt + 4 + "+", more: true });
    return out;
  };
  const answerStep = (count, more) => {
    const d = current;
    if (!isStepKind(d) || phase === "stopped") return;
    const correct = !more && count === d.optimal;
    setLast({ drill: d, answer: count, more: !!more, optimal: d.optimal, correct });
    setPhase("stopped");
    const row = { count, more: !!more, optimal: d.optimal, correct };
    setStepStats((s) => {
      const key = statKeyOf(d);
      const prev = s[key] || { n: 0, opt: 0 };
      return { ...s, [key]: { n: prev.n + 1, opt: prev.opt + (correct ? 1 : 0) } };
    });
    setStepSession((ss) => [...ss.slice(-49), row]);
  };
  const revealStep = () => {                     // "I'm stuck" — show solutions, not an attempt
    if (!isStepKind(current) || phase === "stopped") return;
    setLast({ drill: current, answer: null, more: false, optimal: current.optimal, correct: false });
    setPhase("stopped");
  };
  const advanceStep = () => { setPhase("ready"); setLast(null); advance(); };

  // ---------- keyboard ----------
  useEffect(() => {
    const down = (e) => {
      if (e.repeat) return;
      const tag = e.target && e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (caseBrowser) { if (e.code === "Escape") setCaseBrowser(null); return; }
      if (mode === "steps") {
        if (phase === "stopped") {
          if (e.code === "Space" || e.code === "Enter") { e.preventDefault(); advanceStep(); }
          return;
        }
        const dm = /^(?:Digit|Numpad)([0-9])$/.exec(e.code);
        if (dm && isStepKind(current)) {
          const d = +dm[1], opt = current.optimal;
          if (d >= opt) { e.preventDefault(); answerStep(d >= opt + 4 ? opt + 4 : d, d >= opt + 4); }
        }
        return;   // step trainers never drive the timer
      }
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
  }, [phase, trigger, stopTimer, last, caseBrowser, mode, current]);

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
  const toggleStep = (v) =>
    setStepSel((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v]));
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
    setStepStats({});
    setStepSession([]);
    setLast(null);
    persist({ caseStats: {}, stepStats: {} });
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

  // ---------- optimal solutions for a finished first-center drill ----------
  // Every line is re-proved on the full state before display (fcSolutions
  // drops anything unproved); the chip names the face the white center lands
  // on, read in the hold the solution itself leaves you in. Cached per drill
  // at the parent level: this component is re-declared each render, so a
  // local useMemo would not survive.
  function FcSolutions({ drill }) {
    const FC = fcRef.current;
    if (!FC) return null;
    let res;
    if (fcSolsCache.current && fcSolsCache.current.drill === drill) res = fcSolsCache.current.res;
    else { res = core.fcSolutions(FC, drill, 10); fcSolsCache.current = { drill, res }; }
    return (
      <div className="alglist">
        <div className="hint" style={{ textAlign: "left", marginBottom: 4 }}>
          {res.total} optimal solution{res.total === 1 ? "" : "s"}
          {res.total > res.lines.length ? " · showing " + res.lines.length : ""} · chip = where the white center lands
        </div>
        {res.lines.map((l, i) => (
          <div key={i} className="algrow">
            <span className="ychip mono">{"→ " + l.landing}</span>
            <AlgText text={l.text} />
            {l.sliceCount ? <span className="ratetag">{l.sliceCount} slice{l.sliceCount === 1 ? "" : "s"}</span> : null}
          </div>
        ))}
      </div>
    );
  }

  // ---------- optimal solutions for a finished first-two-triples drill ----------
  // Solver-style lines: one {X,Y} entry bracket into the Bencisco hold, then
  // R / U / Rw tokens with relative {X,Y} re-grips where the grip walk needs
  // them. Every line is re-proved end-to-end before display (f2tSolutions
  // drops anything unproved); brackets are free re-orientations — the target
  // counts turns only. Cached per drill (same reason as FcSolutions).
  function F2tSolutions({ drill }) {
    const FT = f2tRef.current;
    if (!FT) return null;
    let res;
    if (f2tSolsCache.current && f2tSolsCache.current.drill === drill) res = f2tSolsCache.current.res;
    else { res = core.f2tSolutions(FT, drill, 10); f2tSolsCache.current = { drill, res }; }
    return (
      <div className="alglist">
        <div className="hint" style={{ textAlign: "left", marginBottom: 4 }}>
          {res.capped ? res.total + "+" : res.total} optimal solution{res.total === 1 && !res.capped ? "" : "s"}
          {res.total > res.lines.length || res.capped ? " · showing " + res.lines.length : ""}
          {" · {X,Y} brackets are free re-orientations"}
          {drill.goal === "either" ? " · chip = which triple the line solves" : ""}
        </div>
        {res.lines.map((l, i) => (
          <div key={i} className="algrow">
            <span className={"ychip mono" + (l.corner ? "" : " blank")}>{l.corner ? "→ " + l.corner : ""}</span>
            <AlgText text={l.text} />
            {l.brackets ? <span className="ratetag">{l.brackets} rotation{l.brackets === 1 ? "" : "s"}</span> : null}
          </div>
        ))}
      </div>
    );
  }

  // ---------- optimal solutions for a finished centers drill ----------
  // Solver-style lines: the ONE fixed {X,Y} entry bracket into the aligned
  // Bencisco grip, then plain R / U / Rw tokens — no BL, no mid-solve
  // rotations, and the solved triples never leave their place (each line
  // carries a per-prefix machine proof of that; c23Solutions drops anything
  // unproved). The chip names the faces (in the scrambling hold) whose
  // centers the line leaves formed.
  function C23Solutions({ drill }) {
    const FT = f2tRef.current, CT = ctRef.current;
    if (!FT || !CT) return null;
    let res;
    if (c23SolsCache.current && c23SolsCache.current.drill === drill) res = c23SolsCache.current.res;
    else { res = core.c23Solutions(FT, CT, drill, 10); c23SolsCache.current = { drill, res }; }
    return (
      <div className="alglist">
        <div className="hint" style={{ textAlign: "left", marginBottom: 4 }}>
          {res.capped ? res.total + "+" : res.total} optimal solution{res.total === 1 && !res.capped ? "" : "s"}
          {res.total > res.lines.length || res.capped ? " · showing " + res.lines.length : ""}
          {" · the {X,Y} bracket is the fixed entry hold · chip = which centers end formed"}
        </div>
        {res.lines.map((l, i) => (
          <div key={i} className="algrow">
            <span className={"ychip mono" + (l.centers.length ? "" : " blank")}>{l.centers.length ? "→ " + l.centers.join("+") : ""}</span>
            <AlgText text={l.text} />
          </div>
        ))}
      </div>
    );
  }

  // ---------- sheet lines for a finished LBT drill ----------
  // Every applicable LBT entry, best-first: the printed sheet text (the 21
  // setup-undo algs carry their machine-verified closing token appended, our
  // AUF decorations are cancellation-merged), each re-proved from the drill
  // state to land inside the L3T stage before display.
  function LbtSolutions({ drill }) {
    const FIN = finRef.current;
    if (!FIN) return null;
    let res;
    if (finSolsCache.current && finSolsCache.current.drill === drill) res = finSolsCache.current.res;
    else { res = core.lbtSolutions(FIN, drill, 6); finSolsCache.current = { drill, res }; }
    return (
      <div className="alglist">
        <div className="hint" style={{ textAlign: "left", marginBottom: 4 }}>
          {res.total} applicable sheet line{res.total === 1 ? "" : "s"}
          {res.total > res.lines.length ? " · showing " + res.lines.length : ""} · chip = sheet case
        </div>
        {res.lines.map((l, i) => (
          <div key={i} className="algrow">
            <span className="ychip mono">{l.label}</span>
            <AlgText text={l.text} />
            <span className="ratetag">{l.moves + " turn" + (l.moves === 1 ? "" : "s")}</span>
            {l.tokens > l.moves ? <span className="ratetag" title="adjacent same-axis turns merge when executed (e.g. Rw R' as one slice) — the count is the merged execution">merges</span> : null}
            {l.closing ? <span className="warntag" title="the sheet prints this alg one closing wide/slice turn short — the appended token is machine-verified">setup undo</span> : null}
            {l.solvesAll ? <span className="ratetag">solves everything</span> : null}
          </div>
        ))}
      </div>
    );
  }

  // ---------- both sheet routes for a finished L3T drill ----------
  // Two sections (user spec): the exact 1L3T lines, and the 1LP → TCP chains
  // (pair formation + the TCP finish, 2-look where the sheet needs it). Every
  // line is re-proved from the drill state to EXACTLY solved before display.
  function L3tSolutions({ drill }) {
    const FIN = finRef.current;
    if (!FIN) return null;
    let res;
    if (finSolsCache.current && finSolsCache.current.drill === drill) res = finSolsCache.current.res;
    else { res = core.l3tSolutions(FIN, drill, 6); finSolsCache.current = { drill, res }; }
    const section = (title, lines) => (
      <>
        <div className="hint" style={{ textAlign: "left", margin: "6px 0 4px" }}><strong>{title}</strong></div>
        {lines.map((l, i) => (
          <div key={i} className="algrow">
            <span className="ychip mono">{l.label}</span>
            <AlgText text={l.text} />
            <span className="ratetag">{l.moves + " turn" + (l.moves === 1 ? "" : "s")}</span>
            {l.tokens > l.moves ? <span className="ratetag" title="adjacent same-axis turns merge when executed (e.g. Rw R' as one slice) — the count is the merged execution">merges</span> : null}
          </div>
        ))}
      </>
    );
    return (
      <div className="alglist">
        <div className="hint" style={{ textAlign: "left", marginBottom: 4 }}>
          both sheet routes, best first · chip = sheet case · AUF turns count, {"{X,Y}"} re-grips are free
        </div>
        {section("1L3T — one look", res.sys1)}
        {section("1LP → TCP", res.sys2)}
      </div>
    );
  }

  // ---------- step-optimal lines for a finished span drill ----------
  // Each line is ONE continuous engine text — the first phase's tokens, a
  // relative {X,Y} junction bracket into the next phase's hold, that phase's
  // tokens — re-proved end-to-end (segment counts, phase goals through the
  // line's own landing view, per-prefix block intactness for center
  // segments; spanSolutions drops anything unproved). The chip shows the
  // per-phase turn split; generation precomputes the cache so this renders
  // instantly in the common path.
  function SpanSolutions({ drill }) {
    const FCb = fcRef.current, FT = f2tRef.current, CTb = ctRef.current, FINb = finRef.current;
    if (drill.start === "lbt" ? !FINb : !FT) return null;
    let res;
    if (spanSolsCache.current && spanSolsCache.current.drill === drill) res = spanSolsCache.current.res;
    else { res = core.spanSolutions(FCb, FT, CTb, drill, 10, FINb); spanSolsCache.current = { drill, res }; }
    return (
      <div className="alglist">
        <div className="hint" style={{ textAlign: "left", marginBottom: 4 }}>
          {res.capped ? res.total + "+" : res.total} step-optimal line{res.total === 1 && !res.capped ? "" : "s"}
          {res.total > res.lines.length || res.capped ? " · showing " + res.lines.length : ""}
          {" · {X,Y} brackets are free re-orientations · chip = per-step turns"}
          {drill.start === "lbt" ? " · the step boundary is never merged away" : ""}
        </div>
        {res.lines.map((l, i) => (
          <div key={i} className="algrow">
            <span className="ychip mono">{l.split.join("+")}</span>
            <AlgText text={l.text} />
            {l.label ? <span className="ratetag">{l.label}</span> : null}
            {l.landing ? <span className="ratetag">{"→ " + l.landing}</span> : null}
            {l.corner ? <span className="ratetag">{l.corner}</span> : null}
            {l.centers && l.centers.length ? <span className="ratetag">{"→ " + l.centers.join("+")}</span> : null}
          </div>
        ))}
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
            {[["drill", "Drill"], ["recap", "Recap"], ["steps", "Bencisco steps"]].map(([v, l]) => (
              <button key={v} className={"mode" + (mode === v ? " on" : "")} onClick={() => setMode(v)}>{l}</button>
            ))}
          </div>
          {mode !== "steps" && <>
            <span className="grouplabel">practice</span>
            <div className="modes">
              {[["all", "All"], ["learning", "Learning"], ["known", "Known"]].map(([v, l]) => (
                <button key={v} className={"mode" + (scope === v ? " on" : "")} onClick={() => setScope(v)}>{l}</button>
              ))}
            </div>
          </>}
        </div>

        {mode === "steps" ? (
          <div className="card setupcard">
            <button className="setuphead" onClick={() => setSetupOpen((o) => !o)}>
              <strong>Bencisco step trainer</strong>
              <span className="setupsum">
                {plan.ok
                  ? stepLabelOf(plan.key)
                    + (plan.kind === "fc" ? " · optimal length " + (fcTarget === 0 ? "any" : fcTarget) : "")
                    + (stepSel.includes("fc") && fcMetric === "native" ? " · face turns" : "")
                  : "pick consecutive steps"}
              </span>
              <span className="chev">{setupOpen ? "▾" : "▸"}</span>
            </button>
            {setupOpen && (
              <div className="setupbody">
                <div className="chips" style={{ alignItems: "center" }}>
                  <span className="grouplabel">steps</span>
                  <div className="modes">
                    {[["fc", "First center"], ["t1", "First triple"], ["t2", "Second triple"], ["sc", "Second center"], ["c3", "Third center"], ["lbt", "Last bottom triple"], ["l3t", "Last 3 triples"]].map(([v, l]) => (
                      <button key={v} className={"mode" + (stepSel.includes(v) ? " on" : "")} onClick={() => toggleStep(v)}>{l}</button>
                    ))}
                  </div>
                </div>
                {!plan.ok ? (
                  <div className="hint" style={{ textAlign: "left", marginTop: 8 }}>
                    {plan.reason === "fcreach"
                      ? "First-center selections reach at most the second triple for now: an exact first-center-to-centers target is beyond the current tables, and this trainer never shows a target it cannot prove."
                      : plan.reason === "c4gap"
                      ? "The center steps cannot span into the finish steps: the last center's edge alignment (always 1 or 3 turns) sits between the third center and the last bottom triple. Practice the finish steps on their own — last bottom triple, last 3 triples, or both together."
                      : "Pick one step or a consecutive run of steps — first center + first triple works; a selection with a gap (like first center + second triple) does not."}
                  </div>
                ) : (
                  <>
                    {stepSel.includes("fc") && (
                      <div className="chips" style={{ alignItems: "center", marginTop: 8 }}>
                        <span className="grouplabel">counting</span>
                        <div className="modes">
                          <button className={"mode" + (fcMetric === "token" ? " on" : "")}
                            onClick={() => { setFcMetric("token"); if (fcTarget > fcGn("token")) setFcTarget(0); }}>slice turns = 1 move</button>
                          <button className={"mode" + (fcMetric === "native" ? " on" : "")}
                            onClick={() => { setFcMetric("native"); }}>face turns only</button>
                        </div>
                      </div>
                    )}
                    {plan.kind === "fc" && (
                      <div className="chips" style={{ alignItems: "center" }}>
                        <span className="grouplabel">optimal length</span>
                        <div className="modes">
                          <button className={"mode" + (fcTarget === 0 ? " on" : "")} onClick={() => setFcTarget(0)}>any</button>
                          {Array.from({ length: fcGn(fcMetric) }, (_, i) => i + 1).map((n) => {
                            const FC = fcRef.current;
                            const hist = FC ? (fcMetric === "native" ? FC.hist16 : FC.hist24) : null;
                            const pct = hist ? (100 * hist[n] / FC.N) : null;
                            return (
                              <button key={n} className={"mode" + (fcTarget === n ? " on" : "")}
                                title={pct != null ? pct.toFixed(pct < 1 ? 2 : 1) + "% of positions" : ""}
                                onClick={() => setFcTarget(n)}>{n}</button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {plan.kind === "fc" && (
                      <>
                        <div className="hint" style={{ textAlign: "left", marginTop: 8 }}>
                          Scramble with white on top — the short scramble&apos;s only job is to displace the
                          white center, and the diagram shows only its pieces. Build the white center: the
                          three white-sticker edges plus the three white triangles, grouped into a hexagon
                          around any face where white can live. Each scramble shows its exact optimal length
                          as the target. Solve it, then pick how many moves you used to see whether you
                          matched the optimal.
                          God&apos;s number for this step is {fcMetric === "native" ? "7 face turns" : "6 moves counting a slice turn as one"}
                          {fcMetric === "native" ? "" : " (7 in pure face turns)"}: no scramble ever needs more.
                        </div>
                        <div className="hint" style={{ textAlign: "left", marginTop: 4 }}>
                          Watch for the false solve: the mirror formation (all six white stickers in place but
                          the side colors in reverse order around the hexagon) can never survive a full solve,
                          and it sits at exactly God&apos;s number from a real center.
                        </div>
                      </>
                    )}
                    {plan.kind === "f2t" && (
                      <>
                        <div className="hint" style={{ textAlign: "left", marginTop: 8 }}>
                          Scramble a solved puzzle with white on top — the short scramble never touches the
                          white center, so you start exactly at the triples step. Then follow a {"{X,Y}"} bracket
                          into the solving hold (white center on BL) and solve
                          {plan.mode === "first" ? " one bottom triple — whichever is easier" :
                           plan.mode === "second" ? " the remaining bottom triple (the other one is already solved)" :
                           " both bottom triples"} with R, U and Rw turns.
                          The diagram shows only the pieces that matter: the white center, the two bottom
                          corners, and every candidate source triangle.
                        </div>
                        <div className="hint" style={{ textAlign: "left", marginTop: 4 }}>
                          Each scramble shows its exact optimal turn count as the target. {"{X,Y}"} brackets are
                          free re-orientations — count only the turns. Solve, then pick how many turns you used
                          to see whether you matched the optimal.
                        </div>
                      </>
                    )}
                    {plan.kind === "c23" && (
                      <>
                        <div className="hint" style={{ textAlign: "left", marginTop: 8 }}>
                          Scramble a solved puzzle with white on top — the scramble leaves the white center and
                          both bottom triples solved{plan.mode === "third" ? ", plus one more center (named under the diagram)" : ""},
                          so you start exactly at the {plan.mode === "third" ? "third" : "second"}-center step.
                          Then follow the {"{X,Y}"} bracket into the solving hold (white center on BL) and form
                          {plan.mode === "second" ? " one more center — around any of the three remaining candidate faces —" :
                           plan.mode === "third" ? " one more center — any two formed in total count —" :
                           " two more centers — any two of the three candidates —"} with R, U and Rw turns only.
                          The solved triples never leave their place — Rw re-grips for you, so no rotations and
                          no BL turns are ever needed. The diagram shows only the pieces that matter.
                        </div>
                        <div className="hint" style={{ textAlign: "left", marginTop: 4 }}>
                          Each scramble shows its exact optimal turn count as the target — optimal over
                          triple-preserving words, so it is fair for a solve that keeps the triples in. The one
                          {" {X,Y}"} bracket is the entry hold, not a move. Deep scrambles can take a few seconds
                          to prepare. Solve, then pick how many turns you used to see whether you matched the optimal.
                        </div>
                      </>
                    )}
                    {plan.kind === "lbt" && (
                      <div className="hint" style={{ textAlign: "left", marginTop: 8 }}>
                        The scramble leaves everything solved except the last bottom triple and the top
                        layer — exactly where a real solve stands after the centers. Solve the last bottom
                        triple (the slot between F and BL) with an LBT sheet algorithm. The target is the
                        fewest turns over the sheet lines that apply to this exact state; the reveal lists
                        them with their case names. Solve, then pick how many turns you used.
                      </div>
                    )}
                    {plan.kind === "l3t" && (
                      <>
                        <div className="hint" style={{ textAlign: "left", marginTop: 8 }}>
                          The scramble leaves only the last three triples (the top layer) unsolved. The
                          reveal shows BOTH sheet routes: the one-look 1L3T algorithm, and the 1LP pair
                          formation followed by its TCP finish (two TCP algorithms when the sheet&apos;s own
                          2-look is needed). The target is the fewest turns over every proven line of either
                          route.
                        </div>
                        <div className="hint" style={{ textAlign: "left", marginTop: 4 }}>
                          Drills sample the states both routes can solve — the supplied sheets cover most,
                          not all, of the last-layer states, and this trainer never shows a panel it cannot
                          prove. AUF turns count; {"{X,Y}"} re-grips are free.
                        </div>
                      </>
                    )}
                    {plan.kind === "span" && (
                      <>
                        <div className="hint" style={{ textAlign: "left", marginTop: 8 }}>
                          {plan.start === "fc"
                            ? "A full 30-move scramble — from the first center on, the whole puzzle matters. Solve the white center around any face, then re-grip (white on BL) and solve the selected triples with R, U and Rw turns."
                            : plan.start === "lbt"
                            ? "The scramble leaves everything solved except the last bottom triple and the top layer. Solve the last bottom triple with an LBT sheet algorithm, then finish the last three triples with either sheet route (1L3T one-look, or 1LP pair formation + TCP)."
                            : "Scramble a solved puzzle with white on top — the scramble pre-solves everything before your first selected step. Follow the {X,Y} bracket into the solving hold (white center on BL) and solve the selected steps in order: triples with R, U and Rw (free re-grips), then centers with R, U and Rw only — the solved triples never leave their place."}
                        </div>
                        <div className="hint" style={{ textAlign: "left", marginTop: 4 }}>
                          The target is the step-optimal total: each step solved in the fewest turns for its
                          own rules, and where a step has several optimal solutions, the one that sets up the
                          next step best counts — that lookahead is the skill this drill trains. {"{X,Y}"}
                          brackets are free re-orientations; count only the turns.
                          {plan.start === "lbt"
                            ? " Steps are priced separately — the step boundary is never merged away."
                            : " Deep scrambles can take a few seconds to prepare."}
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        ) : (
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
        )}

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
              {mode === "steps"
                ? (!plan.ok
                  ? (plan.reason === "fcreach"
                    ? "First-center selections reach at most the second triple — drop the center steps or the first center."
                    : plan.reason === "c4gap"
                    ? "The center steps cannot span into the finish steps — practice the last bottom triple and last 3 triples on their own."
                    : "Pick one step or a consecutive run of steps in Setup to start.")
                  : stepStatus.startsWith("error") ? "Couldn’t build the step tables: " + stepStatus.slice(7)
                  : stepStatus !== "ready" ? "Building the step distance tables… (a moment, first time only)"
                  : stepBusy ? "Searching for an optimal scramble… (deep ones take a few seconds)"
                  : plan.kind === "fc" ? "Couldn’t generate a scramble. Try another optimal length."
                  : "Couldn’t generate a scramble — try again.")
                : entries.length === 0
                ? (scope === "learning" ? "Nothing left to learn in this selection — every enabled case is marked known."
                  : scope === "known" ? "No cases marked known yet in this selection."
                  : "Pick at least one subset and group in Setup to start.")
                : "Couldn’t generate a scramble — try other cases."}
            </div>
          </div>
        ) : isStepKind(current) ? (
          <div className="stage" style={{ cursor: "default" }}>
            <div className="stagegrid">
              <div className="scramble">{current.scramble}</div>
              <Net state={current.state} w={240} mask={current.mask} />
            </div>
            <div className="hint" style={{ marginTop: 6 }}>
              {current.kind === "fc" ? <>
                solve the white center — target <strong>{current.optimal}</strong> move{current.optimal === 1 ? "" : "s"}
                {current.metric === "native" ? " (face turns)" : ""}
              </> : current.kind === "c23" ? <>
                form {current.mode === "second" ? "your second center (any of the three candidates)"
                  : current.mode === "third" ? "your third center (any two formed in total)"
                  : "your second and third centers (any two of the three)"} — target <strong>{current.optimal}</strong> turn{current.optimal === 1 ? "" : "s"}
                {current.mode === "third" ? " · the center around the " + current.presolvedFace + " face is already solved" : ""}
              </> : current.kind === "lbt" ? <>
                solve the last bottom triple with an LBT sheet algorithm — target <strong>{current.optimal}</strong> turn{current.optimal === 1 ? "" : "s"}
              </> : current.kind === "l3t" ? <>
                solve the last 3 triples — target <strong>{current.optimal}</strong> turn{current.optimal === 1 ? "" : "s"}
                {" (1L3T " + current.parts.l3t + " · via 1LP " + current.parts.chain + ")"}
              </> : current.kind === "span" ? <>
                solve {stepLabelOf(current.spanKey)} — target <strong>{current.optimal}</strong> turn{current.optimal === 1 ? "" : "s"}
                {" ("}
                {(() => {
                  const names = [];
                  if (current.steps.includes("fc")) names.push("center");
                  if (current.steps.includes("t1") || current.steps.includes("t2")) names.push("triples");
                  if (current.steps.includes("sc") || current.steps.includes("c3")) names.push("centers");
                  if (current.steps.includes("lbt")) names.push("LBT");
                  if (current.steps.includes("l3t")) names.push("L3T");
                  return current.breakdown.map((n, i) => names[i] + " " + n).join(" · ");
                })()}
                {")"}
                {current.metric === "native" ? " · face turns" : ""}
                {current.start === "t2" ? " · the " + (current.presolved === 3 ? "back" : "right") + " corner triple is already solved" : ""}
              </> : <>
                solve {current.mode === "first" ? "either bottom triple"
                  : current.mode === "second" ? "the remaining bottom triple"
                  : "both bottom triples"} — target <strong>{current.optimal}</strong> turn{current.optimal === 1 ? "" : "s"}
                {current.mode === "second" ? " · the " + (current.presolved === 3 ? "back" : "right") + " corner triple is already solved" : ""}
              </>}
            </div>
            {phase === "stopped" && last ? (
              <>
                <div style={{
                  margin: "12px auto 4px", padding: "8px 14px", borderRadius: 8, textAlign: "center",
                  fontWeight: 600, maxWidth: 460,
                  background: last.answer == null ? "rgba(120,130,150,.16)" : last.correct ? "rgba(39,151,90,.18)" : "rgba(207,77,68,.16)",
                  color: last.answer == null ? "inherit" : last.correct ? "#38b06e" : "#e46a60",
                }}>
                  {last.answer == null
                    ? "The optimal is " + last.optimal + " move" + (last.optimal === 1 ? "" : "s") + ". Here’s how."
                    : last.correct
                    ? "Correct — " + last.answer + " move" + (last.answer === 1 ? "" : "s") + " is optimal."
                    : last.more
                    ? "Not optimal — the best is " + last.optimal + "."
                    : "Not optimal — you used " + last.answer + ", the best is " + last.optimal + "."}
                </div>
                <div className="analysis" onPointerDown={(e) => e.stopPropagation()}>
                  {last.drill.kind === "fc" ? <FcSolutions drill={last.drill} />
                    : last.drill.kind === "c23" ? <C23Solutions drill={last.drill} />
                    : last.drill.kind === "lbt" ? <LbtSolutions drill={last.drill} />
                    : last.drill.kind === "l3t" ? <L3tSolutions drill={last.drill} />
                    : last.drill.kind === "span" ? <SpanSolutions drill={last.drill} />
                    : <F2tSolutions drill={last.drill} />}
                </div>
                <button className="restart" onClick={advanceStep}>Next scramble</button>
              </>
            ) : (
              <div style={{ textAlign: "center", marginTop: 14 }}>
                <div className="hint" style={{ marginBottom: 8 }}>
                  How many {current.kind === "fc" ? "moves" : "turns"} did your solve take?
                </div>
                <div className="chips" style={{ justifyContent: "center" }}>
                  {fcAnswerButtons(current.optimal).map((b) => (
                    <button key={b.count} className="mode" onClick={() => answerStep(b.count, b.more)}>{b.label}</button>
                  ))}
                </div>
                <button className="preset" style={{ marginTop: 10 }} onClick={revealStep}>I’m stuck — show the solutions</button>
              </div>
            )}
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
                {!isStepKind(last.drill) && (() => {
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
        {mode === "steps" ? (
        <div className="panelrow">
          <div className="card">
            <h3>Optimal-solve rate</h3>
            {(() => {
              const order = (k) => {
                const base = k.endsWith("@native") ? k.slice(0, -7) : k;
                const parts = base.split("+");
                return core.SPAN_STEPS.indexOf(parts[0]) * 100 + parts.length * 10 + (k.endsWith("@native") ? 1 : 0);
              };
              const rows = Object.keys(stepStats).filter((k) => stepStats[k] && stepStats[k].n)
                .sort((a, b) => order(a) - order(b))
                .map((k) => ({ k, name: stepLabelOf(k), ...stepStats[k] }));
              if (!rows.length) return <div className="empty">Solve a few and your optimal-solve rate lands here, split by step selection.</div>;
              return (
                <table>
                  <thead><tr><th>Drill</th><th>Solves</th><th>Optimal</th><th>Rate</th></tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.k}>
                        <td className="name">{r.name}</td>
                        <td className="mono">{r.n}</td>
                        <td className="mono">{r.opt}</td>
                        <td className="mono">{Math.round((100 * r.opt) / r.n)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            })()}
          </div>
          <div className="card">
            <h3>Session</h3>
            {stepSession.length === 0 ? (
              <div className="empty">Each solve lands here — green if you matched the optimal.</div>
            ) : (
              <div className="times">
                {stepSession.slice(-24).map((r, i) => (
                  <span key={i} className="timepill" title={"optimal was " + r.optimal}
                    style={{ "--cdot": r.correct ? "#27975a" : "#cf4d44" }}>
                    {r.correct ? "✓ " + r.count : (r.more ? r.count + "+" : r.count)}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        ) : (
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
        )}

        {caseBrowser && <CaseBrowser subKey={caseBrowser} />}
      </div>
    </div>
  );
}
