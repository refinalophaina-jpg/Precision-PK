// AinaDara Calc | Therapeutic Drug Monitoring Suite
// Single-file React JSX — 2020 ASHP/IDSA/PIDS/SIDP Vancomycin Guidelines
// Clinical Decision Support Only — All recommendations require clinician review

import { useState, useReducer, useEffect, useCallback, useRef } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer, ScatterChart, Scatter } from "recharts";

// ═══════════════════════════════════════════════════════════
// CLAUDE API SMART VALIDATION
// ═══════════════════════════════════════════════════════════
const CLAUDE_API_KEY_STORAGE = 'ainadara_claude_api_key';
function getClaudeApiKey() { try { return localStorage.getItem(CLAUDE_API_KEY_STORAGE)||''; } catch { return ''; } }
function setClaudeApiKey(k) { try { localStorage.setItem(CLAUDE_API_KEY_STORAGE, k); } catch {} }

async function claudeSmartValidate(patient, doses, levels, pkResult, auc24) {
  const apiKey = getClaudeApiKey();
  if (!apiKey) return null; // skip if no key configured

  const summary = [
    `Patient: ${patient.age}yo ${patient.sex}, ${patient.abw_kg}kg, Mode: ${patient.mode}`,
    `SCr: ${patient.scr} mg/dL, CrCl: ${patient.crcl?.toFixed(0)||'N/A'} mL/min`,
    patient.mode==='neonatal' ? `PMA: ${patient.pma_weeks} weeks` : '',
    `Doses: ${doses.map(d=>`${d.dose_mg}mg q${d.tau_h}h`).join(', ')}`,
    `Levels: ${levels.map(l=>`${l.conc} mg/L at ${l.t_abs}h (${l.label||''})`).join(', ')}`,
    pkResult ? `PK: CL=${pkResult.CL_post?.toFixed(3)} L/h, Vd=${pkResult.Vd_post?.toFixed(1)} L, t½=${pkResult.t_half?.toFixed(1)}h` : '',
    auc24 ? `AUC24: ${typeof auc24==='number'?auc24.toFixed(0):auc24} mg·h/L` : '',
    patient.infection_type ? `Infection: ${patient.infection_type}` : '',
    patient.nephrotoxins?.length ? `Concurrent nephrotoxins: ${patient.nephrotoxins.join(', ')}` : '',
  ].filter(Boolean).join('\n');

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system: `You are a clinical pharmacokinetics expert reviewing vancomycin TDM data per 2020 ASHP/IDSA guidelines.
Respond ONLY with a JSON array of alert objects. Each object: {"level":"WARN"|"INFO","message":"..."}
Flag ONLY genuinely unusual or potentially dangerous findings:
- Implausible PK parameters for the patient type
- Dose-exposure mismatches suggesting data entry error
- Drug interactions that compound nephrotoxicity risk
- AUC/MIC concerns for the infection type
- Weight-based dosing anomalies
If everything looks clinically reasonable, return an empty array: []
Be concise. Max 2-3 alerts. No commentary outside the JSON.`,
        messages: [{ role: 'user', content: summary }],
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const text = data.content?.[0]?.text || '[]';
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed.map((a,i)=>({
      id: `claude_${i}`,
      level: a.level==='WARN'?'WARN':'INFO',
      message: `🤖 AI: ${a.message}`,
    })) : [];
  } catch (e) {
    console.warn('Claude Smart Validation error:', e);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
// PK MATH ENGINE (embedded)
// ═══════════════════════════════════════════════════════════
const PK = {
  ibw: (sex, ht) => { const h = ht/2.54; return h<=60 ? (sex==='M'?50:45.5) : (sex==='M'?50+2.3*(h-60):45.5+2.3*(h-60)); },
  adjbw: (ibw, abw) => abw<=ibw ? abw : ibw+0.4*(abw-ibw),
  bmi: (wt, ht) => wt/((ht/100)**2),
  bsa: (ht, wt) => Math.sqrt(ht*wt/3600),
  dosingWt: (abw, ibw) => abw<=ibw ? abw : PK.adjbw(ibw,abw),

  crcl: (age, sex, wt, scr) => {
    if(scr<=0||wt<=0||age<=0) return null;
    const c = ((140-age)*wt)/(72*scr);
    return sex==='F' ? c*0.85 : c;
  },

  schwartz: (ht, scr, age, sex) => {
    if(scr<=0||ht<=0) return null;
    let k = 0.55;
    if(age<1) k=0.45;
    else if(age>=13&&sex==='M') k=0.70;
    const norm = k*ht/scr;
    const bsa = PK.bsa(ht, 30); // rough
    return norm*(bsa/1.73);
  },

  populationPrior: (patient) => {
    const { mode, age, sex, abw_kg, ibw_kg, scr, crcl, pma_weeks, crrt_effluent } = patient;
    if(mode==='neonatal') {
      const wt = abw_kg||1;
      let CL;
      if(pma_weeks<=28) CL=0.0131*wt+0.0087;
      else if(pma_weeks<=36) CL=0.0248*wt+0.0120;
      else if(pma_weeks<=44) CL=0.0303*wt+0.0160;
      else CL=0.0370*wt+0.0220;
      const isPre=pma_weeks<37;
      if(scr&&((isPre&&scr>1.0)||((!isPre)&&scr>0.7))) CL*=(0.5/scr);
      const Vd=0.69*wt;
      return {CL,Vd,CV_CL:0.45,CV_Vd:0.40,model:'Grimsley-Thomson Neonatal'};
    }
    if(mode==='HD') {
      const wt=ibw_kg||abw_kg||70;
      return {CL:0.10,Vd:0.75*wt,CV_CL:0.35,CV_Vd:0.35,model:'HD Interdialytic'};
    }
    if(mode==='CRRT') {
      const eff=(crrt_effluent||22)/1000; // mL/kg/h -> L/kg/h
      const wt=abw_kg||70;
      const CL=eff*wt+0.22;
      return {CL,Vd:0.85*wt,CV_CL:0.40,CV_Vd:0.40,model:'CRRT Effluent-Based'};
    }
    if(mode==='obese') {
      const wt=abw_kg||70;
      const sx=sex==='M'?1:0;
      let CL_raw=9.656-0.078*(age||50)-2.009*(scr||1.0)+1.09*sx+0.04*Math.pow(wt,0.75);
      const CL=Math.max(0.5,CL_raw/60); // mL/min -> L/h
      const Vd=0.4*wt;
      return {CL,Vd,CV_CL:0.32,CV_Vd:0.28,model:'Crass 2018 Obese'};
    }
    if(mode==='pediatric') {
      const crc=crcl||50;
      const wt=abw_kg||20;
      return {CL:crc*0.038+0.18,Vd:0.65*wt,CV_CL:0.40,CV_Vd:0.35,model:'Modified Goti Pediatric'};
    }
    // standard adult (Matzke 1984)
    const crc=crcl||50;
    const wt=ibw_kg||abw_kg||70;
    return {CL:crc*0.041+0.22,Vd:0.70*wt,CV_CL:0.35,CV_Vd:0.30,model:'Matzke 1984 Standard'};
  },

  predictConc: (t_abs, doses, CL, Vd) => {
    const ke=CL/Vd;
    let conc=0;
    for(const d of doses) {
      const t_start=t_abs-d.start_h;
      if(t_start<0) continue;
      const t_end=t_abs-(d.start_h+d.tinf_h);
      const Cmax_inf=(d.dose_mg/(d.tinf_h*ke*Vd))*(1-Math.exp(-ke*d.tinf_h));
      if(t_end>=0) conc+=Cmax_inf*Math.exp(-ke*t_end);
      else conc+=(d.dose_mg/d.tinf_h)/(ke*Vd)*(1-Math.exp(-ke*t_start));
    }
    return Math.max(0,conc);
  },

  bayesianMAP: (prior, doses, observed, maxIter=500) => {
    const {CL:CL_p, Vd:Vd_p, CV_CL, CV_Vd} = prior;
    const addErr=0.5, propErr=0.15;
    const sigCL=Math.sqrt(Math.log(1+CV_CL**2));
    const sigVd=Math.sqrt(Math.log(1+CV_Vd**2));
    let lCL=Math.log(CL_p), lVd=Math.log(Vd_p);
    const obj=(lc,lv)=>{
      const cl=Math.exp(lc), vd=Math.exp(lv);
      const pen=(lc-Math.log(CL_p))**2/(2*sigCL**2)+(lv-Math.log(Vd_p))**2/(2*sigVd**2);
      let lik=0;
      for(const o of observed) {
        const pred=PK.predictConc(o.t_abs,doses,cl,vd);
        if(pred<=0) return 1e9;
        const sig=Math.sqrt(addErr**2+(propErr*pred)**2);
        lik+=(o.conc-pred)**2/(2*sig**2);
      }
      return pen+lik;
    };
    const h=0.001, lr=0.01;
    let prev=Infinity;
    for(let i=0;i<maxIter;i++){
      const cur=obj(lCL,lVd);
      if(Math.abs(cur-prev)<1e-9) break;
      prev=cur;
      const gCL=(obj(lCL+h,lVd)-cur)/h;
      const gVd=(obj(lCL,lVd+h)-cur)/h;
      lCL=lCL-lr*gCL;
      lVd=lVd-lr*gVd;
    }
    const CL_post=Math.exp(lCL), Vd_post=Math.exp(lVd);
    const ke=CL_post/Vd_post;
    return {CL_post,Vd_post,ke,t_half:0.693/ke,converged:true};
  },

  calcAUC24: (Cmax, Cmin, ke, tinf, tau) => {
    const AUCinf=tinf*(Cmax+Cmin)/2;
    const AUCelim=(Cmax-Cmin)/ke;
    return (AUCinf+AUCelim)*(24/tau);
  },

  calcSteadyState: (dose, tinf, tau, CL, Vd) => {
    const ke=CL/Vd;
    const Cmax=(dose/(tinf*ke*Vd))*(1-Math.exp(-ke*tinf))/(1-Math.exp(-ke*tau));
    const Cmin=Cmax*Math.exp(-ke*(tau-tinf));
    return {Cmax,Cmin};
  },

  recommendDose: (CL, Vd, targetAUC=500) => {
    const ke=CL/Vd, t_half=0.693/ke;
    const tdd=targetAUC*CL;
    let tau;
    if(t_half<=6) tau=8;
    else if(t_half<=12) tau=12;
    else if(t_half<=18) tau=24;
    else if(t_half<=36) tau=36;
    else tau=48;
    const rawDose=tdd*(tau/24);
    const dose=Math.min(Math.round(rawDose/250)*250, 3000);
    const tinf=dose>1500?2:1;
    const {Cmax,Cmin}=PK.calcSteadyState(dose,tinf,tau,CL,Vd);
    const predAUC=PK.calcAUC24(Cmax,Cmin,ke,tinf,tau);
    return {dose,tau,tinf,daily_dose:dose*(24/tau),predAUC,Cmax,Cmin};
  },

  kdigo: (scr_now, scr_48h, scr_7d) => {
    if(scr_7d && scr_now/scr_7d>=3.0) return {stage:3,criteria:'SCr ≥ 3× baseline'};
    if(scr_7d && scr_now/scr_7d>=2.0) return {stage:2,criteria:'SCr ≥ 2× baseline'};
    if(scr_48h && (scr_now-scr_48h)>=0.3) return {stage:1,criteria:`+${(scr_now-scr_48h).toFixed(2)} mg/dL in 48h`};
    if(scr_7d && scr_now/scr_7d>=1.5) return {stage:1,criteria:'SCr ≥ 1.5× baseline in 7 days'};
    return {stage:0,criteria:'None'};
  },

  validate: (patient, doses, levels) => {
    const stops=[], warns=[];
    const {age,abw_kg,height_cm,scr,mode}=patient;
    if(age&&(age<0||age>120)) stops.push('Age out of range (0–120)');
    if(abw_kg&&(abw_kg<0.3||abw_kg>300)) stops.push('Weight out of range (0.3–300 kg)');
    if(height_cm&&(height_cm<30||height_cm>250)) stops.push('Height out of range (30–250 cm)');
    if(scr!==undefined&&scr!==''&&scr<=0) stops.push('SCr must be > 0');
    if(scr>15&&mode!=='HD') warns.push('SCr > 15 mg/dL — confirm value or check HD mode');
    for(const d of doses) {
      if(d.dose_mg<100) stops.push(`Dose ${d.dose_mg}mg too low (< 100 mg)`);
      if(d.dose_mg>5000) stops.push(`Dose ${d.dose_mg}mg exceeds 5000 mg`);
      if(d.tau_h&&d.tau_h<6&&mode!=='CI') warns.push(`Interval ${d.tau_h}h < 6h — unusual for vancomycin`);
    }
    for(const l of levels) {
      if(l.conc<0||l.conc>150) stops.push(`Level ${l.conc} mg/L out of range (0–150)`);
    }
    return {stops,warns};
  }
};

// ═══════════════════════════════════════════════════════════
// NEPHROTOXIN DATABASE
// ═══════════════════════════════════════════════════════════
const NEPHROTOXINS = {
  pip_tazo: {name:'Pip/Tazo',risk:'HIGH',alert:'WARN',action:'SCr every 24–48h; consider cefepime/meropenem as pip/tazo alternative'},
  aminoglycoside: {name:'Aminoglycoside',risk:'HIGH',alert:'WARN',action:'Daily SCr; limit combination < 3 days if possible'},
  ampho_b: {name:'Amphotericin B',risk:'VERY HIGH',alert:'DANGER',action:'Use liposomal if possible; daily SCr mandatory'},
  loop_diuretic: {name:'Loop Diuretic',risk:'MODERATE',alert:'WARN',action:'Monitor volume status; SCr every 48h'},
  nsaid: {name:'NSAID',risk:'MODERATE',alert:'WARN',action:'Avoid if possible; shortest duration + daily SCr'},
  contrast: {name:'IV Contrast',risk:'MODERATE',alert:'WARN',action:'Hydrate before/after; SCr at 24h and 48h'},
  calcineurin: {name:'Calcineurin Inhibitor',risk:'HIGH',alert:'DANGER',action:'Daily SCr; frequent tacrolimus/CSA levels; nephrology consult'},
  acei_arb: {name:'ACEi/ARB',risk:'LOW-MOD',alert:'INFO',action:'Monitor SCr if volume-depleted'},
  cisplatin: {name:'Cisplatin/Ifosfamide',risk:'HIGH',alert:'WARN',action:'Avoid concurrent vancomycin during cisplatin if possible'},
  tmp_smx: {name:'TMP-SMX',risk:'LOW-MOD',alert:'INFO',action:'TMP blocks creatinine tubular secretion — SCr elevation may be artifact, not true AKI'}
};

// ═══════════════════════════════════════════════════════════
// STATE MANAGEMENT
// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// LOCALSTORAGE PERSISTENCE (Phase 3)
// ═══════════════════════════════════════════════════════════
const STORAGE_KEY = 'ainadara_calc_state';

function loadPersistedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Only restore encounters and patient — UI resets fresh
      return { encounters: parsed.encounters || [], patient: parsed.patient || null };
    }
  } catch (e) { /* ignore corrupt storage */ }
  return null;
}

function persistState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      encounters: state.encounters,
      patient: state.patient,
      savedAt: new Date().toISOString(),
    }));
  } catch (e) { /* storage full or unavailable */ }
}

const defaultPatient = {
  id: Date.now().toString(),
  name: '',
  age: '',
  sex: 'M',
  height_cm: '',
  abw_kg: '',
  ibw_kg: null,
  adjbw_kg: null,
  bmi: null,
  crcl: null,
  scr: '',
  scr_48h: '',
  scr_7d: '',
  mode: 'standard',
  pma_weeks: '',
  pma_days: '',
  postnatal_days: '',
  birth_weight_kg: '',
  crrt_effluent: 22,
  ci_target_css: 22,
  mic: 1.0,
  infection_type: 'bacteremia',
  indication: 'MRSA',
  organism: '',
  nephrotoxins: [],
  // Clinical documentation fields
  cultures: '',        // e.g. "Blood cx 3/1: MRSA (MIC 1), cleared 3/3"
  imaging: '',         // e.g. "TTE: no vegetations, CXR: RLL infiltrate"
  wbc: '',             // WBC count
  temp: '',            // Temperature
  procalcitonin: '',   // PCT
  clinical_status: '', // improving | stable | worsening
  allergies: '',
  hd_schedule: '',     // e.g. "MWF" for dialysis patients
  antibiotic_day: '',  // Day of therapy
  additional_abx: '',  // other antibiotics
};

const persisted = loadPersistedState();

const initialState = {
  patient: persisted?.patient || { ...defaultPatient },
  encounters: persisted?.encounters || [],
  current_encounter: null,
  alerts: [],
  ui: {
    activeTab: 'patient',
    darkMode: true,
    showMath: {},
    showAlt: false,
  }
};

function reducer(state, action) {
  switch(action.type) {
    case 'SET_PATIENT': {
      const p = {...state.patient, ...action.payload};
      // auto-calculate derived values
      if(p.height_cm && p.abw_kg) {
        p.bmi = PK.bmi(+p.abw_kg, +p.height_cm);
        p.ibw_kg = PK.ibw(p.sex, +p.height_cm);
        p.adjbw_kg = PK.adjbw(p.ibw_kg, +p.abw_kg);
      }
      if(p.age && p.sex && p.abw_kg && p.height_cm && p.scr) {
        const ibw = p.ibw_kg || PK.ibw(p.sex, +p.height_cm);
        const dw = PK.dosingWt(+p.abw_kg, ibw);
        if(p.mode==='pediatric') {
          p.crcl = PK.schwartz(+p.height_cm, +p.scr, +p.age, p.sex);
        } else {
          p.crcl = PK.crcl(+p.age, p.sex, dw, +p.scr);
        }
      }
      return {...state, patient: p};
    }
    case 'TOGGLE_NEPHROTOXIN': {
      const n = state.patient.nephrotoxins;
      const updated = n.includes(action.key) ? n.filter(x=>x!==action.key) : [...n, action.key];
      return {...state, patient: {...state.patient, nephrotoxins: updated}};
    }
    case 'SET_ENCOUNTER': return {...state, current_encounter: action.payload};
    case 'ADD_ENCOUNTER': {
      const enc = action.payload;
      // Bayesian prior propagation: attach previous posterior as prior source
      if (state.encounters.length > 0) {
        const prev = state.encounters[state.encounters.length - 1];
        if (prev.pk && prev.pk.CL_post && prev.pk.Vd_post) {
          enc.propagated_prior = { CL: prev.pk.CL_post, Vd: prev.pk.Vd_post, source_encounter_id: prev.id };
        }
      }
      enc.encounter_number = state.encounters.filter(e => e.id !== enc.id).length + 1;
      const encounters = [...state.encounters.filter(e=>e.id!==enc.id), enc];
      return {...state, encounters, current_encounter: enc};
    }
    case 'CLEAR_STATE': {
      localStorage.removeItem(STORAGE_KEY);
      return { ...initialState, patient: { ...defaultPatient }, encounters: [], current_encounter: null, alerts: [] };
    }
    case 'SET_ALERTS': return {...state, alerts: action.payload};
    case 'SET_UI': return {...state, ui: {...state.ui, ...action.payload}};
    case 'TOGGLE_MATH': {
      const sm = {...state.ui.showMath, [action.key]: !state.ui.showMath[action.key]};
      return {...state, ui: {...state.ui, showMath: sm}};
    }
    case 'LOAD_SCENARIO': {
      const s = SCENARIOS[action.key];
      return {
        ...state,
        patient: {...initialState.patient, ...s.patient},
        current_encounter: {...(state.current_encounter||{}), ...s.encounter},
        ui: {...state.ui, activeTab: 'dosing'}
      };
    }
    default: return state;
  }
}

// ═══════════════════════════════════════════════════════════
// CLINICAL SCENARIOS
// ═══════════════════════════════════════════════════════════
const SCENARIOS = {
  // Steady-state scenarios (2+ levels, routine monitoring)
  ss_adult_trough: {
    label: 'Adult — SS Trough Only',
    category: 'steady_state',
    patient: {age:65, sex:'M', height_cm:178, abw_kg:80, scr:1.1, scr_48h:'', scr_7d:'', mode:'standard', name:'', infection_type:'bacteremia'},
    encounter: {
      doses:[{dose_mg:1250,tinf_h:1,tau_h:12,start_h:0},{dose_mg:1250,tinf_h:1,tau_h:12,start_h:12},{dose_mg:1250,tinf_h:1,tau_h:12,start_h:24},{dose_mg:1250,tinf_h:1,tau_h:12,start_h:36}],
      levels:[{t_abs:47,conc:14.2,label:'Trough'}]
    }
  },
  ss_adult_pk: {
    label: 'Adult — SS Peak+Trough',
    category: 'steady_state',
    patient: {age:70, sex:'M', height_cm:175, abw_kg:75, scr:1.4, scr_48h:'', scr_7d:'', mode:'standard', name:''},
    encounter: {
      doses:[{dose_mg:1000,tinf_h:1,tau_h:12,start_h:0},{dose_mg:1000,tinf_h:1,tau_h:12,start_h:12},{dose_mg:1000,tinf_h:1,tau_h:12,start_h:24}],
      levels:[{t_abs:27,conc:28.5,label:'Peak'},{t_abs:36,conc:10.2,label:'Trough'}]
    }
  },
  // Not at steady state / random levels
  non_ss_random: {
    label: 'Adult — Random Level (not SS)',
    category: 'not_steady_state',
    patient: {age:55, sex:'F', height_cm:165, abw_kg:68, scr:0.9, mode:'standard', name:'', infection_type:'ssti'},
    encounter: {
      doses:[{dose_mg:1000,tinf_h:1,tau_h:12,start_h:0},{dose_mg:1000,tinf_h:1,tau_h:12,start_h:12}],
      levels:[{t_abs:18,conc:19.8,label:'Random'}]
    }
  },
  non_ss_two_levels: {
    label: 'Adult — Two Levels (accumulation)',
    category: 'not_steady_state',
    patient: {age:72, sex:'M', height_cm:170, abw_kg:85, scr:1.8, mode:'standard', name:'', infection_type:'osteomyelitis'},
    encounter: {
      doses:[{dose_mg:1500,tinf_h:1.5,tau_h:12,start_h:0},{dose_mg:1500,tinf_h:1.5,tau_h:12,start_h:12}],
      levels:[{t_abs:3.5,conc:38.2,label:'Peak'},{t_abs:11,conc:22.1,label:'Trough'}]
    }
  },
  // Special populations
  obese_ss: {
    label: 'Obese — SS Trough',
    category: 'special_population',
    patient: {age:45, sex:'F', height_cm:165, abw_kg:125, scr:0.9, mode:'obese', name:''},
    encounter: {
      doses:[{dose_mg:1000,tinf_h:1,tau_h:12,start_h:0},{dose_mg:1000,tinf_h:1,tau_h:12,start_h:12},{dose_mg:1000,tinf_h:1,tau_h:12,start_h:24}],
      levels:[{t_abs:35,conc:7.2,label:'Trough'}]
    }
  },
  aki_rising: {
    label: 'AKI — Rising SCr',
    category: 'special_population',
    patient: {age:58, sex:'M', height_cm:178, abw_kg:75, scr:1.6, scr_48h:1.1, scr_7d:1.0, mode:'AKI', name:'', nephrotoxins:['pip_tazo']},
    encounter: {
      doses:[{dose_mg:1500,tinf_h:1,tau_h:12,start_h:0},{dose_mg:1500,tinf_h:1,tau_h:12,start_h:12},{dose_mg:1500,tinf_h:1,tau_h:12,start_h:24}],
      levels:[{t_abs:27,conc:32.1,label:'Peak'},{t_abs:36,conc:18.9,label:'Trough'}]
    }
  },
  neo_preterm: {
    label: 'Neonate — Preterm 28wk',
    category: 'special_population',
    patient: {age:0, sex:'M', abw_kg:1.1, height_cm:38, scr:0.8, mode:'neonatal', pma_weeks:28, postnatal_days:5, birth_weight_kg:1.0, name:''},
    encounter: {
      doses:[{dose_mg:16.5,tinf_h:1,tau_h:24,start_h:0}],
      levels:[{t_abs:2,conc:22.1,label:'Peak'}]
    }
  },
  peds_standard: {
    label: 'Pediatric — 8yo SSTI',
    category: 'special_population',
    patient: {age:8, sex:'M', height_cm:128, abw_kg:25, scr:0.5, mode:'pediatric', name:'', infection_type:'ssti'},
    encounter: {
      doses:[{dose_mg:375,tinf_h:1,tau_h:8,start_h:0},{dose_mg:375,tinf_h:1,tau_h:8,start_h:8},{dose_mg:375,tinf_h:1,tau_h:8,start_h:16}],
      levels:[{t_abs:23,conc:11.5,label:'Trough'}]
    }
  },
  // Dialysis
  hd_pre_post: {
    label: 'HD — Pre+Post Levels',
    category: 'dialysis',
    patient: {age:62, sex:'M', height_cm:175, abw_kg:78, scr:6.2, mode:'HD', name:''},
    encounter: {
      doses:[{dose_mg:1000,tinf_h:1,tau_h:48,start_h:0}],
      levels:[{t_abs:46,conc:18.5,label:'Pre-HD'},{t_abs:50,conc:8.2,label:'Post-HD'}]
    }
  },
  crrt_icu: {
    label: 'CRRT — ICU Sepsis',
    category: 'dialysis',
    patient: {age:48, sex:'M', height_cm:180, abw_kg:90, scr:3.5, mode:'CRRT', crrt_effluent:25, name:'', infection_type:'bacteremia'},
    encounter: {
      doses:[{dose_mg:1500,tinf_h:1.5,tau_h:12,start_h:0},{dose_mg:1500,tinf_h:1.5,tau_h:12,start_h:12}],
      levels:[{t_abs:15.5,conc:25.3,label:'Peak'},{t_abs:24,conc:15.1,label:'Trough'}]
    }
  },
  // Difficult-to-treat
  high_mic: {
    label: 'High MIC (MIC 2) — Bacteremia',
    category: 'difficult',
    patient: {age:55, sex:'M', height_cm:175, abw_kg:78, scr:1.0, mode:'standard', mic:2.0, name:'', infection_type:'bacteremia'},
    encounter: {
      doses:[{dose_mg:1750,tinf_h:1.5,tau_h:12,start_h:0},{dose_mg:1750,tinf_h:1.5,tau_h:12,start_h:12}],
      levels:[{t_abs:13.5,conc:14.5,label:'Trough'}]
    }
  },
  ci_target: {
    label: 'CI — Target Css 22',
    category: 'difficult',
    patient: {age:50, sex:'M', height_cm:178, abw_kg:80, scr:1.0, mode:'CI', ci_target_css:22, name:'', infection_type:'endocarditis'},
    encounter: {
      doses:[{dose_mg:2000,tinf_h:2,tau_h:24,start_h:0}],
      levels:[]
    }
  },
  supra_accumulation: {
    label: 'Supratherapeutic — Accumulation',
    category: 'difficult',
    patient: {age:78, sex:'F', height_cm:155, abw_kg:55, scr:2.1, mode:'standard', name:'', infection_type:'bacteremia', nephrotoxins:['aminoglycoside']},
    encounter: {
      doses:[{dose_mg:1000,tinf_h:1,tau_h:12,start_h:0},{dose_mg:1000,tinf_h:1,tau_h:12,start_h:12},{dose_mg:1000,tinf_h:1,tau_h:12,start_h:24},{dose_mg:1000,tinf_h:1,tau_h:12,start_h:36}],
      levels:[{t_abs:39,conc:42.5,label:'Peak'},{t_abs:48,conc:28.7,label:'Trough'}]
    }
  },
};

// ═══════════════════════════════════════════════════════════
// STYLES (dark clinical theme)
// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// LIGHT CLINICAL THEME (Phase 6)
// ═══════════════════════════════════════════════════════════
const S = {
  app: {
    minHeight:'100vh',
    background:'#f0f4f8',
    color:'#1e293b',
    fontFamily:"'DM Sans', 'Segoe UI', sans-serif",
  },
  card: {
    background:'#ffffff',
    border:'1px solid #e2e8f0',
    borderRadius:'12px',
    padding:'20px',
    boxShadow:'0 1px 3px rgba(0,0,0,0.04)',
  },
  cardDark: {
    background:'#f8fafc',
    border:'1px solid #e2e8f0',
    borderRadius:'12px',
    padding:'20px',
  },
  input: {
    background:'#f8fafc',
    border:'1px solid #cbd5e1',
    borderRadius:'8px',
    color:'#1e293b',
    padding:'8px 12px',
    fontSize:'14px',
    width:'100%',
    outline:'none',
    fontFamily:"'DM Mono', monospace",
    boxSizing:'border-box',
  },
  inputSm: {
    background:'#f8fafc',
    border:'1px solid #cbd5e1',
    borderRadius:'6px',
    color:'#1e293b',
    padding:'6px 10px',
    fontSize:'13px',
    width:'100%',
    outline:'none',
    fontFamily:"'DM Mono', monospace",
    boxSizing:'border-box',
  },
  select: {
    background:'#f8fafc',
    border:'1px solid #cbd5e1',
    borderRadius:'8px',
    color:'#1e293b',
    padding:'8px 12px',
    fontSize:'14px',
    width:'100%',
    outline:'none',
    boxSizing:'border-box',
  },
  label: { fontSize:'12px', color:'#64748b', marginBottom:'4px', display:'block', textTransform:'uppercase', letterSpacing:'0.05em' },
  btnPrimary: {
    background:'linear-gradient(135deg,#0891b2,#0e7490)',
    color:'#ffffff',
    border:'none',
    borderRadius:'8px',
    padding:'10px 20px',
    fontWeight:'700',
    cursor:'pointer',
    fontSize:'14px',
    letterSpacing:'0.02em',
  },
  btnSecondary: {
    background:'transparent',
    color:'#0891b2',
    border:'1px solid #0891b2',
    borderRadius:'8px',
    padding:'8px 16px',
    cursor:'pointer',
    fontSize:'13px',
  },
  btnDanger: {
    background:'#ef4444',
    color:'white',
    border:'none',
    borderRadius:'6px',
    padding:'6px 12px',
    cursor:'pointer',
    fontSize:'12px',
  },
  btnGhost: {
    background:'#f1f5f9',
    color:'#64748b',
    border:'1px solid #e2e8f0',
    borderRadius:'6px',
    padding:'5px 10px',
    cursor:'pointer',
    fontSize:'12px',
  },
  mono: { fontFamily:"'DM Mono', monospace" },
  cyan: { color:'#0891b2' },
  green: { color:'#059669' },
  amber: { color:'#d97706' },
  red: { color:'#dc2626' },
  purple: { color:'#7c3aed' },
  muted: { color:'#94a3b8' },
  h1: { fontSize:'20px', fontWeight:'800', color:'#0f172a', margin:0 },
  h2: { fontSize:'16px', fontWeight:'700', color:'#1e293b', margin:0 },
  h3: { fontSize:'13px', fontWeight:'600', color:'#64748b', textTransform:'uppercase', letterSpacing:'0.08em' },
};

// ═══════════════════════════════════════════════════════════
// ALERT COMPONENT
// ═══════════════════════════════════════════════════════════
function AlertBanner({alerts, onDismiss}) {
  if(!alerts.length) return null;
  const colors = {DANGER:'#dc2626',WARN:'#d97706',INFO:'#0891b2'};
  const bg = {DANGER:'#fef2f2',WARN:'#fffbeb',INFO:'#ecfeff'};
  const sorted = [...alerts].sort((a,b) => {
    const o={DANGER:0,WARN:1,INFO:2};
    return (o[a.level]||2)-(o[b.level]||2);
  });
  return (
    <div style={{display:'flex',flexDirection:'column',gap:'6px',marginBottom:'16px'}}>
      {sorted.map(a=>(
        <div key={a.id} style={{
          display:'flex',alignItems:'flex-start',gap:'10px',
          background:bg[a.level],
          border:`1px solid ${colors[a.level]}40`,
          borderLeft:`3px solid ${colors[a.level]}`,
          borderRadius:'8px',padding:'10px 14px',
        }}>
          <span style={{color:colors[a.level],fontSize:'13px',fontWeight:'700',minWidth:'54px'}}>{a.level}</span>
          <span style={{fontSize:'13px',color:'#1e293b',flex:1}}>{a.message}</span>
          {onDismiss && <button onClick={()=>onDismiss(a.id)} style={{background:'none',border:'none',color:'#64748b',cursor:'pointer',fontSize:'16px',lineHeight:'1',padding:'0 4px'}}>×</button>}
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// FORMULA TOOLTIP
// ═══════════════════════════════════════════════════════════
function MathTip({id, label, formula, result, evidence, dispatch}) {
  const [show, setShow] = useState(false);
  return (
    <span style={{display:'inline-block'}}>
      <button onClick={()=>setShow(!show)} style={{
        background:'none',border:'none',color:'#0891b2',cursor:'pointer',
        fontSize:'11px',padding:'0 4px',fontFamily:'monospace',
      }} title="Show formula">ⓘ</button>
      {show && (
        <div style={{
          background:'#f1f5f9',border:'1px solid #334155',borderRadius:'8px',
          padding:'12px',marginTop:'4px',fontSize:'12px',
          fontFamily:"'DM Mono',monospace",color:'#94a3b8',
          maxWidth:'320px',lineHeight:'1.6',
        }}>
          <div style={{color:'#0891b2',marginBottom:'4px',fontWeight:'600'}}>{label}</div>
          <div style={{color:'#1e293b',whiteSpace:'pre-wrap'}}>{formula}</div>
          {result&&<div style={{color:'#059669',marginTop:'6px'}}>= {result}</div>}
          {evidence&&<div style={{color:'#d97706',marginTop:'4px',fontSize:'11px'}}>[{evidence}]</div>}
        </div>
      )}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════
// AUC GAUGE (SVG)
// ═══════════════════════════════════════════════════════════
function AUCGauge({auc, target_low=400, target_high=600}) {
  const max=900, size=160, cx=80, cy=90, r=60, stroke=12;
  const pct=Math.min(1,Math.max(0,(auc||0)/max));
  const lo=target_low/max, hi=target_high/max;
  const arc=(p)=>{
    const a=Math.PI*(1-p);
    return {x:cx+r*Math.cos(a), y:cy-r*Math.sin(a)};
  };
  const arcPath=(p1,p2,col)=>{
    const s=arc(p1),e=arc(p2);
    const large=(p2-p1)>0.5?1:0;
    return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 0 ${e.x} ${e.y}`;
  };
  const needle=arc(pct);
  let color='#dc2626', status='SUBTHERAPEUTIC';
  if((auc||0)>=target_low && (auc||0)<=target_high) { color='#059669'; status='THERAPEUTIC'; }
  else if((auc||0)>target_high) { color='#d97706'; status='SUPRATHERAPEUTIC'; }
  return (
    <div style={{textAlign:'center'}}>
      <svg width={size} height={size*0.75} viewBox={`0 0 ${size} ${size*0.75}`}>
        <path d={arcPath(0,1,'#1e293b')} fill="none" stroke="#e2e8f0" strokeWidth={stroke+2} strokeLinecap="round"/>
        <path d={arcPath(0,lo,'#1e293b')} fill="none" stroke="#cbd5e1" strokeWidth={stroke} strokeLinecap="round"/>
        <path d={arcPath(lo,hi,'#1e293b')} fill="none" stroke="#05966940" strokeWidth={stroke} strokeLinecap="round"/>
        <path d={arcPath(hi,1,'#1e293b')} fill="none" stroke="#cbd5e1" strokeWidth={stroke} strokeLinecap="round"/>
        {auc>0 && <path d={arcPath(0,pct)} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" style={{filter:`drop-shadow(0 0 6px ${color})`}}/>}
        <line x1={cx} y1={cy} x2={needle.x} y2={needle.y} stroke={color} strokeWidth="2" strokeLinecap="round" style={{filter:`drop-shadow(0 0 4px ${color})`}}/>
        <circle cx={cx} cy={cy} r="4" fill={color}/>
        <text x={cx} y={cy-20} textAnchor="middle" fill={color} fontSize="18" fontWeight="800" fontFamily="'DM Mono',monospace">{auc?auc.toFixed(0):'—'}</text>
        <text x={cx} y={cy-6} textAnchor="middle" fill="#64748b" fontSize="9">mg·h/L</text>
        <text x={10} y={cy+8} fill="#334155" fontSize="9" fontFamily="monospace">0</text>
        <text x={cx-10} y={cy-r-10} fill="#64748b" fontSize="8" fontFamily="monospace">450</text>
        <text x={size-18} y={cy+8} fill="#334155" fontSize="9" fontFamily="monospace">900</text>
      </svg>
      <div style={{
        display:'inline-block',padding:'3px 12px',borderRadius:'12px',
        background:`${color}20`,border:`1px solid ${color}60`,
        color:color,fontSize:'11px',fontWeight:'700',letterSpacing:'0.06em',
      }}>{status}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// PK CONCENTRATION-TIME CURVE (SVG)
// ═══════════════════════════════════════════════════════════
function PKChart({encounter, recommendation}) {
  if(!encounter?.pk) return null;
  const {pk, doses, levels} = encounter;
  if(!pk||!doses?.length) return null;

  const W=460, H=200, PAD={t:20,r:20,b:40,l:50};
  const maxT=Math.max(...doses.map(d=>d.start_h+d.tau_h),48);
  const points=[], recPoints=[];

  for(let t=0;t<=maxT;t+=0.25) {
    const c=PK.predictConc(t,doses,pk.CL_post,pk.Vd_post);
    points.push({t,c});
  }
  if(recommendation?.dose) {
    const recDoses=[{dose_mg:recommendation.dose,tinf_h:recommendation.tinf,start_h:0,tau_h:recommendation.tau}];
    for(let t=0;t<=48;t+=0.25) {
      const c=PK.predictConc(t,recDoses,pk.CL_post,pk.Vd_post);
      recPoints.push({t,c});
    }
  }

  const allC=[...points.map(p=>p.c),...(levels||[]).map(l=>l.conc)];
  const maxC=Math.max(...allC,30);
  const scX=(t)=>PAD.l+(t/maxT)*(W-PAD.l-PAD.r);
  const scY=(c)=>PAD.t+(H-PAD.t-PAD.b)*(1-c/maxC);

  const toPath=(pts)=>{
    if(!pts.length) return '';
    return pts.map((p,i)=>`${i===0?'M':'L'}${scX(p.t).toFixed(1)},${scY(p.c).toFixed(1)}`).join(' ');
  };

  const yTicks=[0,10,20,30,maxC].filter((v,i,a)=>a.indexOf(v)===i).sort((a,b)=>a-b);
  const xTicks=[0,12,24,36,48].filter(t=>t<=maxT);

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{overflow:'visible'}}>
      {/* Therapeutic zone shading — approximate */}
      <rect x={PAD.l} y={scY(20)} width={W-PAD.l-PAD.r} height={scY(10)-scY(20)} fill="#00e5a008"/>
      {/* grid */}
      {yTicks.map(v=>(
        <g key={v}>
          <line x1={PAD.l} x2={W-PAD.r} y1={scY(v)} y2={scY(v)} stroke="#e2e8f0" strokeDasharray="3,3"/>
          <text x={PAD.l-6} y={scY(v)+4} textAnchor="end" fill="#475569" fontSize="9" fontFamily="monospace">{v}</text>
        </g>
      ))}
      {xTicks.map(t=>(
        <g key={t}>
          <line x1={scX(t)} x2={scX(t)} y1={PAD.t} y2={H-PAD.b} stroke="#e2e8f0" strokeDasharray="3,3"/>
          <text x={scX(t)} y={H-PAD.b+12} textAnchor="middle" fill="#475569" fontSize="9" fontFamily="monospace">{t}h</text>
        </g>
      ))}
      {/* axes */}
      <line x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={H-PAD.b} stroke="#cbd5e1"/>
      <line x1={PAD.l} x2={W-PAD.r} y1={H-PAD.b} y2={H-PAD.b} stroke="#cbd5e1"/>
      <text x={14} y={H/2} textAnchor="middle" fill="#64748b" fontSize="9" transform={`rotate(-90,14,${H/2})`}>mg/L</text>
      {/* current curve */}
      <path d={toPath(points)} fill="none" stroke="#00d4ff" strokeWidth="1.5" style={{filter:'drop-shadow(0 0 3px #00d4ff60)'}}/>
      {/* recommended curve */}
      {recPoints.length>0 && <path d={toPath(recPoints)} fill="none" stroke="#a78bfa" strokeWidth="1.5" strokeDasharray="5,3"/>}
      {/* observed levels */}
      {(levels||[]).map((l,i)=>(
        <g key={i}>
          <circle cx={scX(l.t_abs)} cy={scY(l.conc)} r="5" fill="#d97706" stroke="#ffffff" strokeWidth="1.5"/>
          <text x={scX(l.t_abs)} y={scY(l.conc)-8} textAnchor="middle" fill="#d97706" fontSize="8">{l.label}</text>
        </g>
      ))}
      {/* legend */}
      <g transform={`translate(${W-130},${PAD.t})`}>
        <line x1="0" y1="6" x2="16" y2="6" stroke="#00d4ff" strokeWidth="1.5"/>
        <text x="20" y="10" fill="#64748b" fontSize="9">Current</text>
        {recPoints.length>0 && <>
          <line x1="0" y1="20" x2="16" y2="20" stroke="#a78bfa" strokeWidth="1.5" strokeDasharray="5,3"/>
          <text x="20" y="24" fill="#64748b" fontSize="9">Recommended</text>
        </>}
      </g>
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════
// PATIENT PANEL
// ═══════════════════════════════════════════════════════════
function PatientPanel({state, dispatch}) {
  const {patient} = state;
  const set = useCallback((k,v)=>dispatch({type:'SET_PATIENT',payload:{[k]:v}}), [dispatch]);

  const modes = [
    {v:'standard',l:'Standard Adult'},
    {v:'obese',l:'Obese (BMI ≥ 30)'},
    {v:'HD',l:'Hemodialysis'},
    {v:'CRRT',l:'CRRT'},
    {v:'AKI',l:'AKI / Unstable'},
    {v:'neonatal',l:'Neonatal'},
    {v:'pediatric',l:'Pediatric'},
    {v:'CI',l:'Continuous Infusion'},
  ];
  const infectionTypes = ['bacteremia','endocarditis','pneumonia','osteomyelitis','ssti','cns','other'];

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'16px'}}>
      <div style={S.card}>
        <div style={{...S.h3,marginBottom:'14px'}}>Patient Mode</div>
        <select value={patient.mode} onChange={e=>set('mode',e.target.value)} style={S.select}>
          {modes.map(m=><option key={m.v} value={m.v}>{m.l}</option>)}
        </select>
        <div style={{marginTop:'10px'}}>
          <label style={S.label}>Load Clinical Scenario</label>
          <select onChange={e=>{if(e.target.value)dispatch({type:'LOAD_SCENARIO',key:e.target.value})}} defaultValue="" style={S.select}>
            <option value="">— Select scenario —</option>
            <optgroup label="Steady State">
              {Object.entries(SCENARIOS).filter(([,s])=>s.category==='steady_state').map(([k,s])=><option key={k} value={k}>{s.label}</option>)}
            </optgroup>
            <optgroup label="Not at Steady State">
              {Object.entries(SCENARIOS).filter(([,s])=>s.category==='not_steady_state').map(([k,s])=><option key={k} value={k}>{s.label}</option>)}
            </optgroup>
            <optgroup label="Special Populations">
              {Object.entries(SCENARIOS).filter(([,s])=>s.category==='special_population').map(([k,s])=><option key={k} value={k}>{s.label}</option>)}
            </optgroup>
            <optgroup label="Dialysis">
              {Object.entries(SCENARIOS).filter(([,s])=>s.category==='dialysis').map(([k,s])=><option key={k} value={k}>{s.label}</option>)}
            </optgroup>
            <optgroup label="Difficult-to-Treat">
              {Object.entries(SCENARIOS).filter(([,s])=>s.category==='difficult').map(([k,s])=><option key={k} value={k}>{s.label}</option>)}
            </optgroup>
          </select>
        </div>
      </div>

      <div style={S.card}>
        <div style={{...S.h3,marginBottom:'14px'}}>Demographics</div>
        <div className='ad-grid-2' style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px'}}>
          <div>
            <label style={S.label}>Patient Name / ID</label>
            <input style={S.input} value={patient.name} onChange={e=>set('name',e.target.value)} placeholder="Optional"/>
          </div>
          <div>
            <label style={S.label}>Age (years)</label>
            <input style={S.input} type="number" value={patient.age} onChange={e=>set('age',e.target.value)} placeholder="e.g. 65"/>
          </div>
          <div>
            <label style={S.label}>Sex</label>
            <div style={{display:'flex',gap:'8px'}}>
              {['M','F'].map(s=>(
                <button key={s} onClick={()=>set('sex',s)} style={{
                  flex:1,padding:'8px',borderRadius:'8px',cursor:'pointer',fontWeight:'700',fontSize:'14px',
                  background:patient.sex===s?'#0891b2':'#f1f5f9',
                  color:patient.sex===s?'#ffffff':'#64748b',
                  border:`1px solid ${patient.sex===s?'#0891b2':'#334155'}`,
                }}>{s}</button>
              ))}
            </div>
          </div>
          <div>
            <label style={S.label}>Height (cm)</label>
            <input style={S.input} type="number" value={patient.height_cm} onChange={e=>set('height_cm',e.target.value)} placeholder="e.g. 175"/>
          </div>
          <div>
            <label style={S.label}>Actual Body Weight (kg)</label>
            <input style={S.input} type="number" value={patient.abw_kg} onChange={e=>set('abw_kg',e.target.value)} placeholder="e.g. 75"/>
          </div>
          <div>
            <label style={S.label}>SCr (mg/dL)</label>
            <input style={S.input} type="number" step="0.1" value={patient.scr} onChange={e=>set('scr',e.target.value)} placeholder="e.g. 1.2"/>
          </div>
          <div>
            <label style={S.label}>SCr 48h ago (mg/dL)</label>
            <input style={S.input} type="number" step="0.1" value={patient.scr_48h} onChange={e=>set('scr_48h',e.target.value)} placeholder="optional"/>
          </div>
          <div>
            <label style={S.label}>SCr 7-day baseline</label>
            <input style={S.input} type="number" step="0.1" value={patient.scr_7d} onChange={e=>set('scr_7d',e.target.value)} placeholder="optional"/>
          </div>
          <div>
            <label style={S.label}>BMD MIC (mg/L)</label>
            <input style={S.input} type="number" step="0.5" value={patient.mic} onChange={e=>set('mic',+e.target.value)} placeholder="1.0"/>
          </div>
          <div>
            <label style={S.label}>Infection Type</label>
            <select value={patient.infection_type} onChange={e=>set('infection_type',e.target.value)} style={S.select}>
              {infectionTypes.map(t=><option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
      </div>

      {patient.mode==='neonatal'&&(
        <div style={S.card}>
          <div style={{...S.h3,marginBottom:'14px'}}>Neonatal Parameters</div>
          <div className='ad-grid-2' style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px'}}>
            <div><label style={S.label}>PMA Weeks</label><input style={S.input} type="number" value={patient.pma_weeks} onChange={e=>set('pma_weeks',+e.target.value)}/></div>
            <div><label style={S.label}>PMA Days</label><input style={S.input} type="number" value={patient.pma_days} onChange={e=>set('pma_days',+e.target.value)}/></div>
            <div><label style={S.label}>Postnatal Days</label><input style={S.input} type="number" value={patient.postnatal_days} onChange={e=>set('postnatal_days',+e.target.value)}/></div>
            <div><label style={S.label}>Birth Weight (kg)</label><input style={S.input} type="number" step="0.1" value={patient.birth_weight_kg} onChange={e=>set('birth_weight_kg',+e.target.value)}/></div>
          </div>
          {patient.postnatal_days<3&&(
            <div style={{marginTop:'10px',padding:'8px 12px',background:'rgba(245,158,11,0.1)',borderRadius:'6px',border:'1px solid #f59e0b40',fontSize:'12px',color:'#d97706'}}>
              ⚠ Postnatal age &lt; 72h — SCr reflects maternal creatinine. Do not use for CrCl estimation.
            </div>
          )}
        </div>
      )}

      {/* Auto-calculated values */}
      {(patient.ibw_kg||patient.crcl)&&(
        <div style={{...S.card,background:'#f8fafc'}}>
          <div style={{...S.h3,marginBottom:'12px'}}>Auto-Calculated</div>
          <div className='ad-grid-3' style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'12px'}}>
            {patient.ibw_kg&&<div>
              <div style={S.label}>IBW</div>
              <div style={{...S.mono,...S.cyan,fontSize:'16px',fontWeight:'700'}}>{patient.ibw_kg.toFixed(1)} kg</div>
              <div style={{fontSize:'10px',...S.muted}}>Devine formula</div>
            </div>}
            {patient.bmi&&<div>
              <div style={S.label}>BMI</div>
              <div style={{...S.mono,fontSize:'16px',fontWeight:'700',color:patient.bmi>=30?'#d97706':'#059669'}}>{patient.bmi.toFixed(1)}</div>
              <div style={{fontSize:'10px',...S.muted}}>{patient.bmi>=30?'Obese':'Normal'}</div>
            </div>}
            {patient.crcl&&<div>
              <div style={S.label}>CrCl</div>
              <div style={{...S.mono,fontSize:'16px',fontWeight:'700',color:patient.crcl>130?'#7c3aed':patient.crcl<30?'#dc2626':'#059669'}}>{patient.crcl.toFixed(0)} mL/min</div>
              <div style={{fontSize:'10px',...S.muted}}>{patient.crcl>130?'ARC':patient.crcl<30?'Renal Impairment':'Cockcroft-Gault'}</div>
            </div>}
          </div>
        </div>
      )}

      {/* Nephrotoxins */}
      <div style={S.card}>
        <div style={{...S.h3,marginBottom:'12px'}}>Concurrent Nephrotoxins</div>
        <div style={{display:'flex',flexWrap:'wrap',gap:'6px'}}>
          {Object.entries(NEPHROTOXINS).map(([k,n])=>{
            const active=patient.nephrotoxins.includes(k);
            const col=n.alert==='DANGER'?'#dc2626':n.alert==='WARN'?'#d97706':'#0891b2';
            return (
              <button key={k} onClick={()=>dispatch({type:'TOGGLE_NEPHROTOXIN',key:k})} style={{
                padding:'5px 10px',borderRadius:'20px',cursor:'pointer',fontSize:'11px',fontWeight:'600',
                background:active?`${col}15`:'#f1f5f9',
                color:active?col:'#64748b',
                border:`1px solid ${active?col:'#334155'}`,
              }}>{n.name}</button>
            );
          })}
        </div>
        {patient.nephrotoxins.length>0&&(
          <div style={{marginTop:'10px',display:'flex',flexDirection:'column',gap:'4px'}}>
            {patient.nephrotoxins.map(k=>(
              <div key={k} style={{fontSize:'12px',color:'#94a3b8',paddingLeft:'8px',borderLeft:'2px solid #334155'}}>
                <span style={{color:NEPHROTOXINS[k].alert==='DANGER'?'#dc2626':'#d97706',fontWeight:'700'}}>{NEPHROTOXINS[k].name}</span>: {NEPHROTOXINS[k].action}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Clinical Documentation */}
      <div style={S.card}>
        <div style={{...S.h3,marginBottom:'14px'}}>Clinical Documentation</div>
        <div style={{fontSize:'11px',color:'#64748b',marginBottom:'12px'}}>These fields populate the progress note generator. All are optional.</div>
        <div className='ad-grid-2' style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px'}}>
          <div>
            <label style={S.label}>Antibiotic Day</label>
            <input style={S.input} type="number" value={patient.antibiotic_day} onChange={e=>set('antibiotic_day',e.target.value)} placeholder="e.g. 3"/>
          </div>
          <div>
            <label style={S.label}>Clinical Status</label>
            <select value={patient.clinical_status} onChange={e=>set('clinical_status',e.target.value)} style={S.select}>
              <option value="">— Select —</option>
              <option value="improving">Improving</option>
              <option value="stable">Stable</option>
              <option value="worsening">Worsening</option>
            </select>
          </div>
          <div>
            <label style={S.label}>WBC (×10³/μL)</label>
            <input style={S.input} type="number" step="0.1" value={patient.wbc} onChange={e=>set('wbc',e.target.value)} placeholder="e.g. 12.5"/>
          </div>
          <div>
            <label style={S.label}>Temp (°F)</label>
            <input style={S.input} type="number" step="0.1" value={patient.temp} onChange={e=>set('temp',e.target.value)} placeholder="e.g. 101.2"/>
          </div>
          <div>
            <label style={S.label}>Procalcitonin (ng/mL)</label>
            <input style={S.input} type="number" step="0.01" value={patient.procalcitonin} onChange={e=>set('procalcitonin',e.target.value)} placeholder="optional"/>
          </div>
          <div>
            <label style={S.label}>Allergies</label>
            <input style={S.input} value={patient.allergies} onChange={e=>set('allergies',e.target.value)} placeholder="NKDA or list"/>
          </div>
          <div>
            <label style={S.label}>Additional Antibiotics</label>
            <input style={S.input} value={patient.additional_abx} onChange={e=>set('additional_abx',e.target.value)} placeholder="e.g. Zosyn 4.5g q8h"/>
          </div>
          {patient.mode==='HD'&&<div>
            <label style={S.label}>HD Schedule</label>
            <input style={S.input} value={patient.hd_schedule} onChange={e=>set('hd_schedule',e.target.value)} placeholder="e.g. MWF"/>
          </div>}
        </div>
        <div style={{marginTop:'10px'}}>
          <label style={S.label}>Cultures & Microbiology</label>
          <textarea style={{...S.input,minHeight:'60px',resize:'vertical'}} value={patient.cultures} onChange={e=>set('cultures',e.target.value)} placeholder="e.g. Blood cx 3/1: 2/2 MRSA (MIC 1.0), repeat 3/3: NGTD, Wound cx: MRSA"/>
        </div>
        <div style={{marginTop:'10px'}}>
          <label style={S.label}>Imaging & Diagnostics</label>
          <textarea style={{...S.input,minHeight:'60px',resize:'vertical'}} value={patient.imaging} onChange={e=>set('imaging',e.target.value)} placeholder="e.g. TTE: no vegetations, CXR: improved RLL infiltrate, MRI L-spine: epidural abscess"/>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// DOSING PANEL
// ═══════════════════════════════════════════════════════════
function DosingPanel({state, dispatch}) {
  const {patient} = state;
  const [doses, setDoses] = useState(state.current_encounter?.doses||[{dose_mg:1000,tinf_h:1,tau_h:12,start_h:0}]);
  const [levels, setLevels] = useState(state.current_encounter?.levels||[]);
  const [newDose, setNewDose] = useState({dose_mg:'',tinf_h:1,tau_h:12,start_h:''});
  const [newLevel, setNewLevel] = useState({t_abs:'',conc:'',label:'Trough'});
  const [ciTarget, setCiTarget] = useState(patient.ci_target_css||22);
  const [measCss, setMeasCss] = useState('');
  const [aiValidating, setAiValidating] = useState(false);

  // Clinical workflow state
  const [clinicalWorkflow, setClinicalWorkflow] = useState('steady_state'); // steady_state | not_ss | new_start | hd_monitoring
  const [levelStrategy, setLevelStrategy] = useState('trough_only'); // trough_only | peak_trough | random | pre_post_hd | two_random | multiple_days
  const [monitoringPhilosophy, setMonitoringPhilosophy] = useState('auc'); // auc | trough
  const [numDosesPrior, setNumDosesPrior] = useState(3);
  const [ssEstimated, setSsEstimated] = useState(true);

  // sync from loaded scenario
  useEffect(()=>{
    if(state.current_encounter?.doses) setDoses(state.current_encounter.doses);
    if(state.current_encounter?.levels) setLevels(state.current_encounter.levels);
  },[state.current_encounter]);

  // Auto-detect workflow from scenario
  useEffect(()=>{
    if (patient.mode==='HD') { setClinicalWorkflow('hd_monitoring'); setLevelStrategy('pre_post_hd'); }
    else if (patient.mode==='CI') setClinicalWorkflow('new_start');
  },[patient.mode]);

  const addDose=()=>{
    if(!newDose.dose_mg||newDose.start_h==='') return;
    setDoses([...doses,{...newDose,dose_mg:+newDose.dose_mg,start_h:+newDose.start_h,tinf_h:+newDose.tinf_h,tau_h:+newDose.tau_h}]);
    setNewDose({dose_mg:'',tinf_h:1,tau_h:12,start_h:''});
  };
  const addLevel=()=>{
    if(!newLevel.t_abs||!newLevel.conc) return;
    setLevels([...levels,{...newLevel,t_abs:+newLevel.t_abs,conc:+newLevel.conc}]);
    setNewLevel({t_abs:'',conc:'',label:'Trough'});
  };

  const runCalc=()=>{
    // Validation
    const valid=PK.validate(patient,doses,levels);
    if(valid.stops.length>0) {
      dispatch({type:'SET_ALERTS',payload:valid.stops.map((m,i)=>({id:`stop_${i}`,level:'DANGER',message:m}))});
      return;
    }

    const alerts=[];
    valid.warns.forEach((m,i)=>alerts.push({id:`warn_${i}`,level:'WARN',message:m}));

    // Build prior — use previous encounter posterior if available (Bayesian propagation)
    const popPrior=PK.populationPrior({...patient,crcl:patient.crcl||50});
    let prior = popPrior;
    const prevEnc = state.encounters.length > 0 ? state.encounters[state.encounters.length - 1] : null;
    if (prevEnc?.pk?.CL_post && prevEnc?.pk?.Vd_post) {
      prior = { ...popPrior, CL: prevEnc.pk.CL_post, Vd: prevEnc.pk.Vd_post };
      alerts.push({ id: 'propagated', level: 'INFO', message: `Bayesian prior propagated from encounter #${state.encounters.length}: CL=${prevEnc.pk.CL_post.toFixed(3)} L/h, Vd=${prevEnc.pk.Vd_post.toFixed(1)} L` });
    }

    let pk;
    if(levels.length>=1&&doses.length>=1) {
      pk=PK.bayesianMAP(prior,doses,levels);
    } else {
      pk={CL_post:prior.CL,Vd_post:prior.Vd,ke:prior.CL/prior.Vd,t_half:0.693/(prior.CL/prior.Vd),method:'population_prior'};
    }
    pk.method=levels.length>=1?'Bayesian MAP':'Population Prior';
    pk.model=prior.model;
    pk.CL_prior=prior.CL;
    pk.Vd_prior=prior.Vd;

    // Current regimen AUC
    let auc24=null;
    if(doses.length>0&&pk) {
      const lastDose=doses[doses.length-1];
      const {Cmax,Cmin}=PK.calcSteadyState(lastDose.dose_mg,lastDose.tinf_h,lastDose.tau_h,pk.CL_post,pk.Vd_post);
      auc24=PK.calcAUC24(Cmax,Cmin,pk.ke,lastDose.tinf_h,lastDose.tau_h);
    }

    // CI mode
    let ciRate=null;
    if(patient.mode==='CI') {
      ciRate={
        rate:(ciTarget*pk.CL_post).toFixed(1),
        daily:(ciTarget*pk.CL_post*24).toFixed(0),
        ld_low:Math.round(15*(patient.abw_kg||70)/250)*250,
        ld_high:Math.round(20*(patient.abw_kg||70)/250)*250,
        auc24:(ciTarget*24).toFixed(0),
        adjusted:measCss?((ciTarget/+measCss)*ciTarget*pk.CL_post).toFixed(1):null,
      };
    }

    // Dose recommendation
    const rec=PK.recommendDose(pk.CL_post,pk.Vd_post,500);
    const aucMic=auc24?(auc24/(patient.mic||1)):null;

    // AKI check
    let aki={stage:0};
    if(patient.scr&&(patient.scr_48h||patient.scr_7d)) {
      aki=PK.kdigo(+patient.scr,patient.scr_48h?+patient.scr_48h:undefined,patient.scr_7d?+patient.scr_7d:undefined);
    }
    if(aki.stage>=1) alerts.push({id:'aki',level:aki.stage>=2?'DANGER':'WARN',message:`KDIGO AKI Stage ${aki.stage}: ${aki.criteria}. Reassess vancomycin therapy.`});

    // AUC alerts
    if(auc24) {
      if(auc24>700) alerts.push({id:'auc_hi',level:'DANGER',message:`AUC24 ${auc24.toFixed(0)} mg·h/L markedly exceeds target (>700). Dose reduction required.`});
      else if(auc24>600) alerts.push({id:'auc_warn',level:'WARN',message:`AUC24 ${auc24.toFixed(0)} mg·h/L approaching nephrotoxicity threshold (>600).`});
      else if(auc24<400) alerts.push({id:'auc_low',level:'WARN',message:`AUC24 ${auc24.toFixed(0)} mg·h/L subtherapeutic (<400). Treatment failure risk.`});
    }

    // MIC alert
    if(patient.mic>1) alerts.push({id:'mic_hi',level:'WARN',message:`MIC ${patient.mic} mg/L — AUC/MIC target (≥400) unlikely achievable with conventional dosing. Consider alternative therapy.`});

    // Nephrotoxin alerts
    patient.nephrotoxins.forEach(k=>{
      const n=NEPHROTOXINS[k];
      alerts.push({id:`nep_${k}`,level:n.alert,message:`${n.name}: ${n.action}`});
    });

    // CrCl alerts
    if(patient.crcl&&patient.crcl>130) alerts.push({id:'arc',level:'INFO',message:'Augmented Renal Clearance (CrCl > 130 mL/min) — higher or more frequent doses may be needed.'});

    // Red Man Syndrome check
    if(doses.length>0) {
      const lastD=doses[doses.length-1];
      const ratePerMin=lastD.dose_mg/(lastD.tinf_h*60);
      if(ratePerMin>10) alerts.push({id:'rms',level:'WARN',message:`Infusion rate ${ratePerMin.toFixed(0)} mg/min exceeds 10 mg/min limit. Min infusion time: ${(lastD.dose_mg/600).toFixed(1)}h. Red Man Syndrome risk.`});
    }

    const encounter={
      id:Date.now(),
      timestamp:new Date().toISOString(),
      doses,levels,pk,
      auc24,aucMic,aki,rec,ciRate,
      alerts,
      scr_at_encounter: patient.scr ? +patient.scr : null,
      patient_snapshot: { name: patient.name, mode: patient.mode, age: patient.age, scr: patient.scr },
    };

    dispatch({type:'ADD_ENCOUNTER',payload:encounter});
    dispatch({type:'SET_ALERTS',payload:alerts});
    dispatch({type:'SET_UI',payload:{activeTab:'results'}});

    // Claude AI Smart Validation (async, non-blocking)
    if (getClaudeApiKey()) {
      setAiValidating(true);
      claudeSmartValidate(patient, doses, levels, pk, auc24).then(aiAlerts => {
        setAiValidating(false);
        if (aiAlerts && aiAlerts.length > 0) {
          dispatch({type:'SET_ALERTS', payload:[...alerts, ...aiAlerts]});
        }
      }).catch(() => setAiValidating(false));
    }
  };

  // Quick-fill helpers for common level strategies
  const quickFillLevels = (strategy) => {
    setLevelStrategy(strategy);
    // Clear existing levels for fresh quick-fill
    setLevels([]);
  };

  // Helper to auto-generate dose rows from a regimen
  const autoFillDoses = (dose, tau, tinf, count) => {
    const newDoses = [];
    for (let i = 0; i < count; i++) {
      newDoses.push({ dose_mg: dose, tau_h: tau, tinf_h: tinf, start_h: i * tau });
    }
    setDoses(newDoses);
  };

  // Estimated trough from population PK (if not at SS)
  const estimatedTrough = (() => {
    if (!patient.crcl || doses.length === 0) return null;
    try {
      const prior = PK.populationPrior({...patient, crcl: patient.crcl});
      const lastDose = doses[doses.length - 1];
      const ke = prior.CL / prior.Vd;
      const {Cmax, Cmin} = PK.calcSteadyState(lastDose.dose_mg, lastDose.tinf_h, lastDose.tau_h, prior.CL, prior.Vd);
      // If not at SS, estimate using number of doses given
      if (clinicalWorkflow === 'not_ss' && doses.length < 5) {
        const accumFactor = (1 - Math.exp(-ke * lastDose.tau_h * doses.length)) / (1 - Math.exp(-ke * lastDose.tau_h));
        return { estTrough: (Cmin * accumFactor).toFixed(1), ssTrough: Cmin.toFixed(1), ssAUC: ((Cmax + Cmin) / 2 * lastDose.tau_h * 24 / lastDose.tau_h).toFixed(0) };
      }
      return { ssTrough: Cmin.toFixed(1), ssAUC: null };
    } catch { return null; }
  })();

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'16px'}}>
      {/* Clinical Workflow */}
      <div style={S.card}>
        <div style={{...S.h3,marginBottom:'14px'}}>Clinical Workflow</div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'8px'}}>
          {[
            {v:'steady_state',l:'At Steady State',desc:'≥4-5 doses given, routine monitoring'},
            {v:'not_ss',l:'Not at Steady State',desc:'Early therapy, accumulating'},
            {v:'new_start',l:'New Start / Empiric',desc:'Initial dosing, no levels yet'},
            {v:'hd_monitoring',l:'HD / CRRT Monitoring',desc:'Dialysis level monitoring'},
          ].map(w=>(
            <button key={w.v} onClick={()=>setClinicalWorkflow(w.v)} style={{
              padding:'10px',borderRadius:'8px',cursor:'pointer',textAlign:'left',
              background:clinicalWorkflow===w.v?'#0891b215':'#f8fafc',
              border:`1px solid ${clinicalWorkflow===w.v?'#0891b2':'#e2e8f0'}`,
              color:clinicalWorkflow===w.v?'#0891b2':'#64748b',transition:'all 0.15s',
            }}>
              <div style={{fontWeight:'700',fontSize:'12px'}}>{w.l}</div>
              <div style={{fontSize:'10px',marginTop:'2px',opacity:0.7}}>{w.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Monitoring Philosophy */}
      <div style={S.card}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'10px'}}>
          <div style={S.h3}>Monitoring Philosophy</div>
          <div style={{display:'flex',gap:'4px',background:'#f1f5f9',borderRadius:'8px',padding:'2px'}}>
            <button onClick={()=>setMonitoringPhilosophy('auc')} style={{
              padding:'6px 14px',borderRadius:'6px',border:'none',cursor:'pointer',fontSize:'12px',fontWeight:'700',
              background:monitoringPhilosophy==='auc'?'#0891b2':'transparent',
              color:monitoringPhilosophy==='auc'?'#fff':'#64748b',
            }}>AUC-Guided</button>
            <button onClick={()=>setMonitoringPhilosophy('trough')} style={{
              padding:'6px 14px',borderRadius:'6px',border:'none',cursor:'pointer',fontSize:'12px',fontWeight:'700',
              background:monitoringPhilosophy==='trough'?'#7c3aed':'transparent',
              color:monitoringPhilosophy==='trough'?'#fff':'#64748b',
            }}>Trough-Based</button>
          </div>
        </div>
        <div style={{fontSize:'12px',color:'#64748b',padding:'8px 12px',background:'#f8fafc',borderRadius:'6px',border:'1px solid #e2e8f0'}}>
          {monitoringPhilosophy==='auc' ? (
            <>
              <strong style={{color:'#0891b2'}}>AUC₂₄/MIC 400–600</strong> — 2020 guideline-recommended. Requires ≥1 level (ideally 2) for Bayesian estimation. More precise dosing, reduced nephrotoxicity vs trough-based approach. <em>Preferred for all patients.</em>
            </>
          ) : (
            <>
              <strong style={{color:'#7c3aed'}}>Trough 15–20 mg/L</strong> — Legacy approach. Simpler monitoring. Note: 2020 guidelines recommend transitioning to AUC-guided monitoring. Trough-only correlates poorly with AUC₂₄ in many patients. <em>Acceptable when AUC monitoring unavailable.</em>
            </>
          )}
        </div>
      </div>

      {/* Level Strategy */}
      <div style={S.card}>
        <div style={{...S.h3,marginBottom:'10px'}}>Level Strategy</div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'6px',marginBottom:'12px'}}>
          {[
            {v:'trough_only',l:'Trough Only',show:true},
            {v:'peak_trough',l:'Peak + Trough',show:true},
            {v:'random',l:'Random Level',show:clinicalWorkflow==='not_ss'||true},
            {v:'pre_post_hd',l:'Pre/Post HD',show:patient.mode==='HD'||clinicalWorkflow==='hd_monitoring'},
            {v:'two_random',l:'Two Random Levels',show:clinicalWorkflow==='not_ss'||true},
            {v:'multiple_days',l:'Multi-Day Levels',show:true},
          ].filter(s=>s.show).map(s=>(
            <button key={s.v} onClick={()=>quickFillLevels(s.v)} style={{
              padding:'8px',borderRadius:'6px',cursor:'pointer',fontSize:'11px',fontWeight:'600',
              background:levelStrategy===s.v?'#d9770615':'#f8fafc',
              border:`1px solid ${levelStrategy===s.v?'#d97706':'#e2e8f0'}`,
              color:levelStrategy===s.v?'#d97706':'#64748b',
            }}>{s.l}</button>
          ))}
        </div>

        {/* Contextual guidance per strategy */}
        <div style={{fontSize:'11px',color:'#475569',padding:'6px 10px',background:'#fffbeb',borderRadius:'6px',border:'1px solid #fde68a',marginBottom:'12px'}}>
          {levelStrategy==='trough_only'&&'Draw trough 30 min before next dose (at steady state, typically before 4th or 5th dose). Enter the trough concentration and the time in hours from first dose.'}
          {levelStrategy==='peak_trough'&&'Draw peak 1–2h after end of infusion, trough 30 min before next dose. Two levels enable precise Bayesian PK estimation (Sawchuk-Zaske).'}
          {levelStrategy==='random'&&'Any level drawn at a known time post-dose. Bayesian estimation will extrapolate to estimate trough and AUC. Best with population PK prior.'}
          {levelStrategy==='pre_post_hd'&&'Pre-HD: Draw immediately before dialysis. Post-HD: Draw 30 min after dialysis completion (allow redistribution). Used to calculate HD clearance.'}
          {levelStrategy==='two_random'&&'Two levels at different times (not SS). Allows direct calculation of ke and Vd without relying heavily on population priors. Ideal for accumulation assessment.'}
          {levelStrategy==='multiple_days'&&'Levels from different dosing days. Useful for assessing accumulation trend, non-linear kinetics, or changing renal function over time.'}
        </div>
      </div>

      {/* CI Rate Calculator */}
      {patient.mode==='CI'&&(
        <div style={S.card}>
          <div style={{...S.h3,marginBottom:'14px'}}>Continuous Infusion Calculator</div>
          <div className='ad-grid-2' style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px',marginBottom:'12px'}}>
            <div>
              <label style={S.label}>Target Css (mg/L)</label>
              <input style={S.input} type="number" value={ciTarget} onChange={e=>setCiTarget(+e.target.value)} placeholder="20–25"/>
            </div>
            <div>
              <label style={S.label}>Measured Css (for adjustment)</label>
              <input style={S.input} type="number" value={measCss} onChange={e=>setMeasCss(e.target.value)} placeholder="optional"/>
            </div>
          </div>
          {patient.crcl&&(()=>{
            const prior=PK.populationPrior({...patient,crcl:patient.crcl});
            const rate=ciTarget*prior.CL;
            return (
              <div style={{background:'#f8fafc',borderRadius:'8px',padding:'12px'}}>
                <div className='ad-grid-3' style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'8px',fontSize:'12px'}}>
                  <div><div style={S.label}>Loading Dose</div><div style={{...S.mono,...S.cyan,fontSize:'15px',fontWeight:'700'}}>{Math.round(15*(+patient.abw_kg||70)/250)*250}–{Math.round(20*(+patient.abw_kg||70)/250)*250} mg</div></div>
                  <div><div style={S.label}>CI Rate</div><div style={{...S.mono,...S.cyan,fontSize:'15px',fontWeight:'700'}}>{rate.toFixed(1)} mg/h</div></div>
                  <div><div style={S.label}>AUC₂₄</div><div style={{...S.mono,...S.green,fontSize:'15px',fontWeight:'700'}}>{(ciTarget*24).toFixed(0)} mg·h/L</div></div>
                </div>
                {measCss&&<div style={{marginTop:'8px',fontSize:'12px',color:'#7c3aed'}}>Adjusted rate: {((ciTarget/+measCss)*rate).toFixed(1)} mg/h → Css {ciTarget} mg/L</div>}
              </div>
            );
          })()}
        </div>
      )}

      {/* Dose History with Quick-Fill */}
      <div style={S.card}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'14px'}}>
          <div style={S.h3}>Dosing History</div>
          <div style={{display:'flex',gap:'4px'}}>
            {[
              {label:'1g q12h ×3',dose:1000,tau:12,tinf:1,count:3},
              {label:'1.5g q12h ×3',dose:1500,tau:12,tinf:1.5,count:3},
              {label:'1.25g q8h ×4',dose:1250,tau:8,tinf:1,count:4},
              {label:'750mg q12h ×3',dose:750,tau:12,tinf:1,count:3},
            ].map((qf,i)=>(
              <button key={i} onClick={()=>autoFillDoses(qf.dose,qf.tau,qf.tinf,qf.count)} style={{
                padding:'4px 8px',borderRadius:'4px',border:'1px solid #e2e8f0',background:'#f8fafc',
                cursor:'pointer',fontSize:'10px',color:'#64748b',whiteSpace:'nowrap',
              }}>{qf.label}</button>
            ))}
          </div>
        </div>
        {doses.map((d,i)=>(
          <div key={i} style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'6px',background:'#f1f5f9',borderRadius:'6px',padding:'8px 12px',fontSize:'13px'}}>
            <span style={{...S.mono,minWidth:'24px',color:'#64748b'}}>#{i+1}</span>
            <span style={{...S.mono,flex:1}}><span style={S.cyan}>{d.dose_mg}</span> mg q{d.tau_h}h × {d.tinf_h}h infusion</span>
            <span style={{...S.mono,...S.muted,fontSize:'12px'}}>t₀={d.start_h}h</span>
            <button onClick={()=>setDoses(doses.filter((_,j)=>j!==i))} style={{background:'none',border:'none',color:'#475569',cursor:'pointer',fontSize:'16px'}}>×</button>
          </div>
        ))}
        <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr auto',gap:'6px',marginTop:'8px',alignItems:'end'}}>
          <div>
            <label style={S.label}>Dose (mg)</label>
            <input style={S.inputSm} type="number" value={newDose.dose_mg} onChange={e=>setNewDose({...newDose,dose_mg:e.target.value})} placeholder="1000"/>
          </div>
          <div>
            <label style={S.label}>Interval (h)</label>
            <input style={S.inputSm} type="number" value={newDose.tau_h} onChange={e=>setNewDose({...newDose,tau_h:+e.target.value})} placeholder="12"/>
          </div>
          <div>
            <label style={S.label}>Duration (h)</label>
            <input style={S.inputSm} type="number" value={newDose.tinf_h} onChange={e=>setNewDose({...newDose,tinf_h:+e.target.value})} placeholder="1"/>
          </div>
          <div>
            <label style={S.label}>Start (h)</label>
            <input style={S.inputSm} type="number" value={newDose.start_h} onChange={e=>setNewDose({...newDose,start_h:e.target.value})} placeholder="0"/>
          </div>
          <button onClick={addDose} style={{...S.btnPrimary,padding:'6px 14px',fontSize:'20px',alignSelf:'flex-end'}}>+</button>
        </div>

        {/* Estimated trough/AUC preview */}
        {estimatedTrough && (
          <div style={{marginTop:'10px',padding:'10px 12px',background:'#f0f9ff',borderRadius:'6px',border:'1px solid #bae6fd',fontSize:'12px'}}>
            <div style={{fontWeight:'700',color:'#0369a1',marginBottom:'4px'}}>Population Estimate (before levels)</div>
            <div style={{display:'flex',gap:'16px',flexWrap:'wrap'}}>
              <span>Est. SS Trough: <strong style={{color:+estimatedTrough.ssTrough>20?'#dc2626':+estimatedTrough.ssTrough<10?'#d97706':'#059669'}}>{estimatedTrough.ssTrough} mg/L</strong></span>
              {estimatedTrough.estTrough && <span>Current est. Trough (non-SS): <strong style={{color:'#7c3aed'}}>{estimatedTrough.estTrough} mg/L</strong></span>}
              {estimatedTrough.ssAUC && <span>Est. SS AUC₂₄: <strong>{estimatedTrough.ssAUC} mg·h/L</strong></span>}
            </div>
          </div>
        )}
      </div>

      {/* Observed Levels */}
      <div style={S.card}>
        <div style={{...S.h3,marginBottom:'14px'}}>Observed Levels</div>
        {levels.length===0&&(
          <div style={{...S.muted,fontSize:'13px',marginBottom:'8px'}}>
            {clinicalWorkflow==='new_start'
              ? 'No levels yet — analysis will use population prior estimates only'
              : 'No levels entered — add observed drug concentrations below'}
          </div>
        )}
        {levels.map((l,i)=>(
          <div key={i} style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'6px',background:'#f1f5f9',borderRadius:'6px',padding:'8px 12px',fontSize:'13px'}}>
            <span style={{color:'#d97706',minWidth:'60px',fontWeight:'600'}}>{l.label}</span>
            <span style={{...S.mono,flex:1}}><span style={{color:'#d97706'}}>{l.conc}</span> mg/L @ t={l.t_abs}h</span>
            <button onClick={()=>setLevels(levels.filter((_,j)=>j!==i))} style={{background:'none',border:'none',color:'#475569',cursor:'pointer',fontSize:'16px'}}>×</button>
          </div>
        ))}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr auto',gap:'6px',marginTop:'8px',alignItems:'end'}}>
          <div>
            <label style={S.label}>Type</label>
            <select style={{...S.select,padding:'6px 10px',fontSize:'13px'}} value={newLevel.label} onChange={e=>setNewLevel({...newLevel,label:e.target.value})}>
              {(levelStrategy==='pre_post_hd'
                ? ['Pre-HD','Post-HD','Random']
                : ['Trough','Peak','Random','Pre-HD','Post-HD','Day 1','Day 2','Day 3']
              ).map(l=><option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div>
            <label style={S.label}>Conc (mg/L)</label>
            <input style={S.inputSm} type="number" value={newLevel.conc} onChange={e=>setNewLevel({...newLevel,conc:e.target.value})} placeholder="12.5"/>
          </div>
          <div>
            <label style={S.label}>Time (h from 1st dose)</label>
            <input style={S.inputSm} type="number" value={newLevel.t_abs} onChange={e=>setNewLevel({...newLevel,t_abs:e.target.value})} placeholder="23.5"/>
          </div>
          <button onClick={addLevel} style={{...S.btnPrimary,padding:'6px 14px',fontSize:'20px',alignSelf:'flex-end'}}>+</button>
        </div>
        <div style={{marginTop:'8px',fontSize:'11px',color:'#475569'}}>
          Times in hours from first dose start. For q12h: trough ≈ t=11.5h from last dose, peak ≈ t=2h post-infusion end.
        </div>
      </div>

      <button onClick={runCalc} style={{...S.btnPrimary,padding:'14px',fontSize:'15px',fontWeight:'800',letterSpacing:'0.04em',textAlign:'center'}}>
        ▶ RUN {monitoringPhilosophy==='auc'?'AUC-GUIDED':'TROUGH-BASED'} BAYESIAN ANALYSIS
      </button>
      {aiValidating && (
        <div style={{textAlign:'center',padding:'8px',fontSize:'12px',color:'#0891b2',animation:'pulse 1.5s infinite'}}>
          🤖 Claude AI validating clinical plausibility...
        </div>
      )}
      {getClaudeApiKey() && !aiValidating && (
        <div style={{textAlign:'center',fontSize:'11px',color:'#94a3b8',marginTop:'4px'}}>
          🤖 AI Smart Validation enabled
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// RESULTS PANEL
// ═══════════════════════════════════════════════════════════
function ResultsPanel({state, dispatch}) {
  const enc=state.current_encounter;
  if(!enc?.pk) return (
    <div style={{...S.card,textAlign:'center',padding:'48px'}}>
      <div style={{fontSize:'32px',marginBottom:'12px'}}>⚕</div>
      <div style={{...S.h2,color:'#64748b'}}>No calculation yet</div>
      <div style={{...S.muted,fontSize:'13px',marginTop:'8px'}}>Enter patient data and run analysis</div>
    </div>
  );

  const {pk, auc24, aucMic, aki, rec, ciRate, doses, levels} = enc;
  const grade='A-II';

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'16px'}}>
      {/* AUC Overview */}
      <div style={{...S.card,display:'flex',gap:'24px',alignItems:'center',flexWrap:'wrap'}}>
        <AUCGauge auc={auc24}/>
        <div style={{flex:1,minWidth:'200px'}}>
          <div style={{...S.h2,marginBottom:'12px'}}>PK Results</div>
          <div className='ad-grid-2' style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
            {[
              {l:'Method',v:pk.method,c:'#64748b'},
              {l:'Model',v:pk.model,c:'#64748b'},
              {l:'CL (post)',v:`${pk.CL_post.toFixed(3)} L/h`,c:'#0891b2'},
              {l:'Vd (post)',v:`${pk.Vd_post.toFixed(1)} L`,c:'#0891b2'},
              {l:'Ke',v:`${pk.ke.toFixed(4)} h⁻¹`,c:'#7c3aed'},
              {l:'t½',v:`${pk.t_half.toFixed(1)} h`,c:'#7c3aed'},
              {l:'AUC/MIC',v:aucMic?`${aucMic.toFixed(0)} (MIC ${state.patient.mic})`:'-',c:aucMic&&aucMic>=400?'#059669':'#dc2626'},
            ].map(({l,v,c})=>(
              <div key={l}>
                <div style={{...S.label,marginBottom:'2px'}}>{l}</div>
                <div style={{...S.mono,fontSize:'13px',color:c,fontWeight:'600'}}>{v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Dose Recommendation */}
      {rec&&(
        <div style={{...S.card,borderColor:'#00d4ff40'}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'12px'}}>
            <div style={S.h2}>Recommendation</div>
            <span style={{fontSize:'11px',background:'#f59e0b25',color:'#d97706',padding:'2px 8px',borderRadius:'12px',border:'1px solid #f59e0b40'}}>{grade}</span>
          </div>
          <div className='ad-grid-2' style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'16px'}}>
            <div style={{background:'#f8fafc',borderRadius:'8px',padding:'12px'}}>
              <div style={{fontSize:'11px',color:'#64748b',marginBottom:'6px',textTransform:'uppercase',letterSpacing:'0.06em'}}>Current Regimen</div>
              {doses[doses.length-1]&&<div style={{...S.mono,fontSize:'15px',color:'#94a3b8'}}>{doses[doses.length-1].dose_mg} mg q{doses[doses.length-1].tau_h}h</div>}
              <div style={{...S.mono,fontSize:'13px',color:auc24<400?'#dc2626':auc24>600?'#d97706':'#059669',marginTop:'4px'}}>AUC₂₄: {auc24?.toFixed(0)||'—'} mg·h/L</div>
            </div>
            <div style={{background:'#f8fafc',borderRadius:'8px',padding:'12px',border:'1px solid #00d4ff30'}}>
              <div style={{fontSize:'11px',color:'#0891b2',marginBottom:'6px',textTransform:'uppercase',letterSpacing:'0.06em'}}>Recommended</div>
              <div style={{...S.mono,fontSize:'15px',color:'#0891b2',fontWeight:'700'}}>{rec.dose} mg q{rec.tau}h × {rec.tinf}h</div>
              <div style={{...S.mono,fontSize:'13px',color:'#059669',marginTop:'4px'}}>Pred. AUC₂₄: {rec.predAUC.toFixed(0)} mg·h/L ✓</div>
            </div>
          </div>
          <div className='ad-grid-3' style={{marginTop:'12px',display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'8px',fontSize:'12px'}}>
            <div><span style={S.muted}>Daily Dose: </span><span style={S.mono}>{rec.daily_dose.toFixed(0)} mg/day</span></div>
            <div><span style={S.muted}>Pred. Cmax: </span><span style={{...S.mono,color:'#7c3aed'}}>{rec.Cmax.toFixed(1)} mg/L</span></div>
            <div><span style={S.muted}>Pred. Cmin: </span><span style={{...S.mono,color:'#7c3aed'}}>{rec.Cmin.toFixed(1)} mg/L</span></div>
          </div>
          {state.patient.mode==='HD'&&(
            <div style={{marginTop:'10px',padding:'8px 12px',background:'rgba(0,212,255,0.07)',borderRadius:'6px',fontSize:'12px',color:'#0891b2'}}>
              HD monitoring: Target pre-dialysis concentration 15–20 mg/L. Dose after each HD session. Monitor weekly minimum.
            </div>
          )}
          {state.patient.mic>1&&(
            <div style={{marginTop:'10px',padding:'8px 12px',background:'rgba(255,71,87,0.08)',borderRadius:'6px',fontSize:'12px',color:'#dc2626'}}>
              ⚠ MIC {state.patient.mic} mg/L — AUC/MIC target ≥ 400 unlikely with conventional dosing. Alternative therapy strongly considered (see Alternatives tab).
            </div>
          )}
        </div>
      )}

      {/* CI Results */}
      {ciRate&&(
        <div style={S.card}>
          <div style={{...S.h2,marginBottom:'12px'}}>Continuous Infusion Plan</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'12px'}}>
            <div><div style={S.label}>Loading Dose</div><div style={{...S.mono,...S.cyan,fontSize:'16px',fontWeight:'700'}}>{ciRate.ld_low}–{ciRate.ld_high} mg</div><div style={{fontSize:'11px',...S.muted}}>Infuse over 1–2h</div></div>
            <div><div style={S.label}>CI Rate</div><div style={{...S.mono,...S.cyan,fontSize:'16px',fontWeight:'700'}}>{ciRate.rate} mg/h</div><div style={{fontSize:'11px',...S.muted}}>Dedicated line required</div></div>
            <div><div style={S.label}>Predicted AUC₂₄</div><div style={{...S.mono,...S.green,fontSize:'16px',fontWeight:'700'}}>{ciRate.auc24} mg·h/L</div><div style={{fontSize:'11px',...S.muted}}>= Css × 24</div></div>
          </div>
        </div>
      )}

      {/* AKI Status */}
      {aki&&aki.stage>0&&(
        <div style={{...S.card,borderColor:aki.stage>=2?'#ff475740':'#f59e0b40'}}>
          <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
            <span style={{fontSize:'20px'}}>🔴</span>
            <div>
              <div style={{fontWeight:'700',color:aki.stage>=2?'#dc2626':'#d97706'}}>KDIGO AKI Stage {aki.stage}</div>
              <div style={{fontSize:'13px',color:'#94a3b8',marginTop:'2px'}}>{aki.criteria}</div>
            </div>
          </div>
        </div>
      )}

      {/* PK Chart */}
      <div style={S.card}>
        <div style={{...S.h3,marginBottom:'12px'}}>Concentration–Time Curve</div>
        <PKChart encounter={enc} recommendation={rec}/>
        <div style={{fontSize:'11px',color:'#475569',marginTop:'8px',display:'flex',gap:'16px'}}>
          <span>— Current</span><span style={{color:'#7c3aed'}}>- - Recommended</span><span style={{color:'#d97706'}}>● Observed</span>
        </div>
      </div>

      {/* Bayesian prior vs posterior */}
      {pk.CL_prior&&(
        <div style={S.card}>
          <div style={{...S.h3,marginBottom:'12px'}}>Bayesian Prior vs Posterior</div>
          <table style={{width:'100%',fontSize:'13px',borderCollapse:'collapse'}}>
            <thead>
              <tr style={{color:'#64748b',fontSize:'11px',textTransform:'uppercase'}}>
                <th style={{textAlign:'left',padding:'6px 0',fontWeight:'600'}}>Parameter</th>
                <th style={{textAlign:'right',padding:'6px 0',fontWeight:'600'}}>Prior</th>
                <th style={{textAlign:'right',padding:'6px 0',fontWeight:'600'}}>Posterior</th>
                <th style={{textAlign:'right',padding:'6px 0',fontWeight:'600'}}>Change</th>
              </tr>
            </thead>
            <tbody>
              {[
                {p:'CL (L/h)',pr:pk.CL_prior,po:pk.CL_post},
                {p:'Vd (L)',pr:pk.Vd_prior,po:pk.Vd_post},
                {p:'Ke (h⁻¹)',pr:pk.CL_prior/pk.Vd_prior,po:pk.ke},
                {p:'t½ (h)',pr:0.693/(pk.CL_prior/pk.Vd_prior),po:pk.t_half},
              ].map(({p,pr,po})=>{
                const delta=((po-pr)/pr*100);
                return(
                  <tr key={p} style={{borderTop:'1px solid #e2e8f0'}}>
                    <td style={{padding:'8px 0',color:'#94a3b8',fontFamily:'monospace'}}>{p}</td>
                    <td style={{textAlign:'right',padding:'8px 0',fontFamily:'monospace',color:'#64748b'}}>{pr.toFixed(3)}</td>
                    <td style={{textAlign:'right',padding:'8px 0',fontFamily:'monospace',color:'#0891b2',fontWeight:'600'}}>{po.toFixed(3)}</td>
                    <td style={{textAlign:'right',padding:'8px 0',fontFamily:'monospace',color:Math.abs(delta)>15?'#d97706':'#64748b',fontSize:'12px'}}>{delta>0?'+':''}{delta.toFixed(0)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{fontSize:'11px',color:'#94a3b8',textAlign:'center',padding:'8px',borderTop:'1px solid #e2e8f0'}}>
        Based on 2020 ASHP/IDSA/PIDS/SIDP Vancomycin Consensus Guidelines [A-II] • Clinical Decision Support Only
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// ALTERNATIVES PANEL
// ═══════════════════════════════════════════════════════════
function AlternativesPanel({state}) {
  const p=state.patient;
  const enc=state.current_encounter;
  const showTrigger=p.mic>1||enc?.aki?.stage>=2||(enc?.auc24>700);

  const agents=[
    {
      name:'Daptomycin',evidence:'A-I',
      dose:'6 mg/kg q24h (bacteremia/IE); 4 mg/kg q24h (SSTI)',
      renal:'CrCl ≥30: no adjustment. CrCl <30: 6 mg/kg q48h. HD: dose post-HD.',
      monitor:'CPK baseline + weekly. Blood cultures q48h in bacteremia.',
      contraindicated:p.infection_type==='pneumonia',
      contraindText:'CONTRAINDICATED for pneumonia — inactivated by pulmonary surfactant',
      bestFor:['bacteremia','endocarditis','osteomyelitis','ssti'],
      color:'#0891b2',
    },
    {
      name:'Linezolid',evidence:'A-I (SSTI/HAP); B-II (bacteremia)',
      dose:'600 mg IV/PO q12h (same dose — 100% oral bioavailability)',
      renal:'No renal dose adjustment needed.',
      monitor:'CBC weekly (thrombocytopenia). Screen serotonergic drugs. Lactic acid if prolonged.',
      contraindicated:p.infection_type==='endocarditis',
      contraindText:'Avoid for endocarditis — bacteriostatic, insufficient for high inoculum',
      bestFor:['pneumonia','osteomyelitis','ssti','cns'],
      color:'#059669',
    },
    {
      name:'Ceftaroline (5th-gen cephalosporin)',evidence:'A-I (SSTI/CAP); B-II (salvage bacteremia)',
      dose:'600 mg q8h (serious BSI/MRSA); 600 mg q12h (SSTI/CAP)',
      renal:'CrCl 30–50: 400 mg q8h. CrCl 15–30: 300 mg q8h. HD: 200 mg q8h.',
      monitor:'Standard β-lactam safety. CBC (rare hemolytic anemia).',
      bestFor:['bacteremia','ssti'],
      color:'#7c3aed',
    },
    {
      name:'Dapto + Ceftaroline (Combination)',evidence:'B-II',
      dose:'Daptomycin 8–10 mg/kg q24h + Ceftaroline 600 mg q8h',
      renal:'Adjust each agent individually per CrCl.',
      monitor:'CPK weekly + standard ceftaroline monitoring.',
      bestFor:['bacteremia','endocarditis'],
      indication:'Persistent bacteremia ≥5 days; VISA/hVISA; vancomycin failure',
      color:'#d97706',
    },
  ];

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'16px'}}>
      {showTrigger&&(
        <div style={{...S.card,borderColor:'#f59e0b40',background:'rgba(245,158,11,0.05)'}}>
          <div style={{display:'flex',gap:'10px',alignItems:'center'}}>
            <span style={{fontSize:'20px'}}>⚠</span>
            <div>
              <div style={{fontWeight:'700',color:'#d97706'}}>Alternative Therapy Consideration Triggered</div>
              <div style={{fontSize:'12px',color:'#94a3b8',marginTop:'2px'}}>
                {p.mic>1&&`MIC ${p.mic} mg/L — AUC/MIC target unachievable. `}
                {enc?.aki?.stage>=2&&`KDIGO AKI Stage ${enc.aki.stage} — nephrotoxicity despite therapy. `}
                {enc?.auc24>700&&`AUC ${enc.auc24.toFixed(0)} mg·h/L markedly supratherapeutic. `}
              </div>
            </div>
          </div>
        </div>
      )}
      {!showTrigger&&(
        <div style={{...S.card,padding:'12px 16px',fontSize:'13px',color:'#64748b'}}>
          Showing all alternatives. This panel auto-highlights when MIC &gt; 1, AKI Stage 2+, or AUC &gt; 700.
        </div>
      )}
      {agents.map(a=>(
        <div key={a.name} style={{...S.card,borderColor:a.contraindicated?'#ff475730':`${a.color}25`}}>
          <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:'10px'}}>
            <div>
              <div style={{fontSize:'15px',fontWeight:'700',color:a.contraindicated?'#64748b':a.color}}>{a.contraindicated?'✗ ':''}{a.name}</div>
              {a.indication&&<div style={{fontSize:'12px',color:'#64748b',marginTop:'2px'}}>{a.indication}</div>}
            </div>
            <span style={{fontSize:'11px',background:`${a.color}15`,color:a.color,padding:'2px 8px',borderRadius:'12px',border:`1px solid ${a.color}30`}}>{a.evidence}</span>
          </div>
          {a.contraindicated&&(
            <div style={{padding:'6px 10px',background:'rgba(255,71,87,0.1)',borderRadius:'6px',fontSize:'12px',color:'#dc2626',marginBottom:'8px'}}>
              {a.contraindText}
            </div>
          )}
          <div className='ad-grid-2' style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px',fontSize:'12px'}}>
            <div><span style={S.muted}>Dose: </span>{a.dose}</div>
            <div><span style={S.muted}>Renal: </span>{a.renal}</div>
            <div style={{gridColumn:'1/-1'}}><span style={S.muted}>Monitor: </span>{a.monitor}</div>
          </div>
        </div>
      ))}
      <div style={{...S.card,background:'#f8fafc',fontSize:'12px',color:'#64748b'}}>
        <strong style={{color:'#94a3b8'}}>See-saw effect:</strong> As vancomycin MIC increases, daptomycin susceptibility may decrease (cross-resistance). Always obtain daptomycin MIC before using after vancomycin failure.
        <br/><br/>
        <strong style={{color:'#94a3b8'}}>CISA/VISA:</strong> Ceftaroline MIC typically falls as vancomycin MIC rises — useful for VISA/hVISA isolates.
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// HISTORY PANEL
// ═══════════════════════════════════════════════════════════
function HistoryPanel({state, dispatch}) {
  const encs=state.encounters;
  if(!encs.length) return (
    <div style={{...S.card,textAlign:'center',padding:'48px',color:'#64748b'}}>
      No encounter history yet. Run calculations to populate.
    </div>
  );

  const chartData=encs.map((e,i)=>({
    encounter:i+1,
    auc:e.auc24?+e.auc24.toFixed(0):null,
    scr: e.scr_at_encounter || null,
    dose:e.doses?.[e.doses.length-1]?.dose_mg,
    aki:e.aki?.stage||0,
    ts:e.timestamp,
    cl: e.pk?.CL_post ? +e.pk.CL_post.toFixed(3) : null,
  })).filter(d=>d.auc);

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'16px'}}>
      {/* Clear history button */}
      <div style={{display:'flex',justifyContent:'flex-end'}}>
        <button onClick={()=>{if(confirm('Clear all encounter history and patient data?'))dispatch({type:'CLEAR_STATE'})}} style={{...S.btnGhost,fontSize:'11px'}}>Clear History</button>
      </div>

      {chartData.length>1&&(
        <div style={S.card}>
          <div style={{...S.h3,marginBottom:'12px'}}>Longitudinal AUC₂₄ + SCr Trend</div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData} margin={{top:10,right:50,left:0,bottom:0}}>
              <CartesianGrid strokeDasharray="3,3" stroke="#e2e8f0"/>
              <XAxis dataKey="encounter" stroke="#475569" tick={{fill:'#94a3b8',fontSize:11}} label={{value:'Encounter',position:'insideBottom',offset:-2,fill:'#94a3b8',fontSize:10}}/>
              <YAxis yAxisId="auc" stroke="#00d4ff" tick={{fill:'#00d4ff80',fontSize:11}} domain={[0,900]} label={{value:'AUC₂₄ (mg·h/L)',angle:-90,position:'insideLeft',fill:'#00d4ff80',fontSize:10}}/>
              <YAxis yAxisId="scr" orientation="right" stroke="#f59e0b" tick={{fill:'#f59e0b80',fontSize:11}} domain={[0,'auto']} label={{value:'SCr (mg/dL)',angle:90,position:'insideRight',fill:'#f59e0b80',fontSize:10}}/>
              <Tooltip contentStyle={{background:'#ffffff',border:'1px solid #e2e8f0',borderRadius:'8px',fontSize:'12px',boxShadow:'0 2px 8px rgba(0,0,0,0.08)'}}/>
              <ReferenceLine yAxisId="auc" y={400} stroke="#00e5a0" strokeDasharray="4,4" label={{value:'400',fill:'#00e5a080',fontSize:10}}/>
              <ReferenceLine yAxisId="auc" y={600} stroke="#f59e0b" strokeDasharray="4,4" label={{value:'600',fill:'#f59e0b80',fontSize:10}}/>
              <Line yAxisId="auc" type="monotone" dataKey="auc" stroke="#00d4ff" strokeWidth={2} dot={{r:4,fill:'#0891b2'}} name="AUC₂₄" connectNulls/>
              <Line yAxisId="scr" type="monotone" dataKey="scr" stroke="#f59e0b" strokeWidth={2} dot={{r:4,fill:'#d97706'}} name="SCr" strokeDasharray="5,3" connectNulls/>
            </LineChart>
          </ResponsiveContainer>
          <div style={{display:'flex',gap:'16px',justifyContent:'center',marginTop:'8px',fontSize:'11px'}}>
            <span style={{color:'#0891b2'}}>— AUC₂₄</span>
            <span style={{color:'#d97706'}}>- - SCr</span>
            <span style={{color:'#059669'}}>··· 400 target</span>
            <span style={{color:'#d97706'}}>··· 600 ceiling</span>
          </div>
        </div>
      )}

      <div style={S.card}>
        <div style={{...S.h3,marginBottom:'12px'}}>Encounter Log</div>
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',fontSize:'12px',borderCollapse:'collapse',whiteSpace:'nowrap'}}>
            <thead>
              <tr style={{color:'#64748b',fontSize:'11px',textTransform:'uppercase',borderBottom:'1px solid #e2e8f0'}}>
                {['#','Time','Regimen','AUC₂₄','Ke (h⁻¹)','t½ (h)','AKI','Status'].map(h=>(
                  <th key={h} style={{padding:'6px 8px',textAlign:'left',fontWeight:'600'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {encs.map((e,i)=>{
                const d=e.doses?.[e.doses.length-1];
                const auc=e.auc24?.toFixed(0);
                const status=!auc?'-':+auc<400?'Subtherapeutic':+auc>600?'Supratherapeutic':'Therapeutic';
                const sc={Therapeutic:'#059669',Subtherapeutic:'#dc2626',Supratherapeutic:'#d97706','-':'#64748b'};
                return (
                  <tr key={e.id} style={{borderBottom:'1px solid #f1f5f9'}}>
                    <td style={{padding:'8px',color:'#64748b'}}>{i+1}</td>
                    <td style={{padding:'8px',color:'#64748b',fontSize:'11px',fontFamily:'monospace'}}>{new Date(e.timestamp).toLocaleDateString()}</td>
                    <td style={{padding:'8px',fontFamily:'monospace',color:'#94a3b8'}}>{d?`${d.dose_mg}mg q${d.tau_h}h`:'-'}</td>
                    <td style={{padding:'8px',fontFamily:'monospace',color:sc[status]||'#64748b'}}>{auc||'-'}</td>
                    <td style={{padding:'8px',fontFamily:'monospace',color:'#7c3aed'}}>{e.pk?.ke?.toFixed(4)||'-'}</td>
                    <td style={{padding:'8px',fontFamily:'monospace',color:'#7c3aed'}}>{e.pk?.t_half?.toFixed(1)||'-'}</td>
                    <td style={{padding:'8px',color:e.aki?.stage>0?'#dc2626':'#64748b'}}>{e.aki?.stage>0?`Stage ${e.aki.stage}`:'-'}</td>
                    <td style={{padding:'8px'}}><span style={{
                      color:sc[status],background:`${sc[status]}15`,
                      padding:'2px 8px',borderRadius:'12px',fontSize:'11px',border:`1px solid ${sc[status]}30`,
                    }}>{status}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// PHASE 4: PDF EXPORT (jsPDF via CDN)
// ═══════════════════════════════════════════════════════════
function exportPDF(state) {
  const enc = state.current_encounter;
  const p = state.patient;
  if (!enc?.pk) { alert('Run analysis before exporting.'); return; }

  const {pk, auc24, aucMic, aki, rec, ciRate, doses, levels} = enc;
  const status = !auc24 ? 'N/A' : auc24 < 400 ? 'SUBTHERAPEUTIC' : auc24 > 600 ? 'SUPRATHERAPEUTIC' : 'THERAPEUTIC';
  const statusColor = !auc24?'#666':auc24<400?'#dc2626':auc24>600?'#d97706':'#059669';

  const r = (label, val) => `<tr><td style="color:#6b7280;padding:4px 12px 4px 0;white-space:nowrap">${label}</td><td style="font-family:monospace;padding:4px 0">${val}</td></tr>`;
  const hdr = (num, title) => `<h2 style="color:#0e7490;border-bottom:2px solid #0891b2;padding-bottom:6px;margin:24px 0 12px;font-size:16px">${num}. ${title}</h2>`;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>AinaDara TDM Report — ${p.name||'Patient'}</title>
<style>
  @page { size: letter; margin: 0.75in; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } .no-print { display:none; } }
  body { font-family: 'Segoe UI','Helvetica Neue',Arial,sans-serif; font-size:12px; color:#1e293b; max-width:720px; margin:0 auto; padding:20px; line-height:1.5; }
  h1 { font-size:22px; color:#0e7490; margin:0 0 4px; } .subtitle { font-size:10px; color:#94a3b8; margin-bottom:20px; }
  table { border-collapse:collapse; width:100%; } .section-table td { vertical-align:top; }
  .alert { padding:6px 10px; border-radius:6px; margin:4px 0; font-size:11px; }
  .alert-danger { background:#fef2f2; border:1px solid #fecaca; color:#991b1b; }
  .alert-warn { background:#fffbeb; border:1px solid #fde68a; color:#92400e; }
  .alert-info { background:#f0f9ff; border:1px solid #bae6fd; color:#075985; }
  .btn-print { background:#0891b2; color:white; border:none; padding:10px 24px; border-radius:8px; cursor:pointer; font-size:14px; font-weight:700; margin:20px 0; }
  .metric-box { background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:12px; text-align:center; }
  .metric-label { font-size:10px; color:#64748b; text-transform:uppercase; letter-spacing:0.06em; }
  .metric-value { font-size:18px; font-weight:700; font-family:monospace; margin-top:4px; }
</style></head><body>
<div class="no-print" style="text-align:center;padding:12px;background:#f0f9ff;border-radius:8px;margin-bottom:16px">
  <button class="btn-print" onclick="window.print()">🖨 Print / Save as PDF</button>
  <div style="font-size:11px;color:#64748b;margin-top:4px">Use "Save as PDF" in the print dialog for best results</div>
</div>

<h1>⚕ AinaDara Calc — TDM Report</h1>
<div class="subtitle">Generated: ${new Date().toLocaleString()} | Clinical Decision Support Only | 2020 ASHP/IDSA Vancomycin Guidelines</div>

${hdr('1','Patient Summary')}
<table class="section-table">
  ${r('Name / ID', p.name || 'N/A')}
  ${r('Age / Sex', `${p.age || '-'} years / ${p.sex}`)}
  ${r('Weight (ABW)', `${p.abw_kg || '-'} kg`)}
  ${r('Height', `${p.height_cm || '-'} cm`)}
  ${r('BMI', p.bmi ? `${p.bmi.toFixed(1)} kg/m²` : '-')}
  ${r('IBW / AdjBW', `${p.ibw_kg?.toFixed(1) || '-'} / ${p.adjbw_kg?.toFixed(1) || '-'} kg`)}
  ${r('SCr', `${p.scr || '-'} mg/dL`)}
  ${r('CrCl', p.crcl ? `${p.crcl.toFixed(0)} mL/min (Cockcroft-Gault)` : '-')}
  ${r('Mode', p.mode.toUpperCase())}
  ${r('Infection', p.infection_type)}
  ${r('MIC', `${p.mic} mg/L`)}
  ${p.nephrotoxins.length > 0 ? r('Nephrotoxins', p.nephrotoxins.map(k => NEPHROTOXINS[k]?.name||k).join(', ')) : ''}
  ${p.mode==='neonatal' ? r('PMA', `${p.pma_weeks||'-'} weeks`) : ''}
</table>

${hdr('2','Pharmacokinetic Analysis')}
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px">
  <div class="metric-box"><div class="metric-label">CL (post)</div><div class="metric-value" style="color:#0891b2">${pk.CL_post.toFixed(3)} L/h</div></div>
  <div class="metric-box"><div class="metric-label">Vd (post)</div><div class="metric-value" style="color:#0891b2">${pk.Vd_post.toFixed(1)} L</div></div>
  <div class="metric-box"><div class="metric-label">ke</div><div class="metric-value" style="color:#7c3aed">${pk.ke.toFixed(4)} h⁻¹</div></div>
  <div class="metric-box"><div class="metric-label">t½</div><div class="metric-value" style="color:#7c3aed">${pk.t_half.toFixed(1)} h</div></div>
</div>
<table class="section-table">
  ${r('Method', pk.method)}
  ${r('PK Model', pk.model || '-')}
  ${pk.CL_prior ? r('CL prior → post', `${pk.CL_prior.toFixed(3)} → ${pk.CL_post.toFixed(3)} L/h (${((pk.CL_post-pk.CL_prior)/pk.CL_prior*100).toFixed(0)}%)`) : ''}
  ${pk.Vd_prior ? r('Vd prior → post', `${pk.Vd_prior.toFixed(1)} → ${pk.Vd_post.toFixed(1)} L (${((pk.Vd_post-pk.Vd_prior)/pk.Vd_prior*100).toFixed(0)}%)`) : ''}
</table>
<h3 style="font-size:13px;color:#475569;margin:16px 0 8px">Dosing History</h3>
<table style="width:100%;font-size:11px;border:1px solid #e2e8f0;border-radius:6px">
  <thead><tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0">
    <th style="padding:6px;text-align:left">Dose #</th><th style="padding:6px;text-align:left">Dose</th><th style="padding:6px;text-align:left">Interval</th><th style="padding:6px;text-align:left">Infusion</th><th style="padding:6px;text-align:left">Start</th>
  </tr></thead>
  <tbody>${(doses||[]).map((d,i)=>`<tr style="border-bottom:1px solid #f1f5f9"><td style="padding:4px 6px">#${i+1}</td><td style="padding:4px 6px;font-family:monospace">${d.dose_mg} mg</td><td style="padding:4px 6px">q${d.tau_h}h</td><td style="padding:4px 6px">${d.tinf_h}h</td><td style="padding:4px 6px">t₀=${d.start_h}h</td></tr>`).join('')}</tbody>
</table>
<h3 style="font-size:13px;color:#475569;margin:16px 0 8px">Observed Levels</h3>
<table style="width:100%;font-size:11px;border:1px solid #e2e8f0;border-radius:6px">
  <thead><tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0"><th style="padding:6px;text-align:left">Level #</th><th style="padding:6px;text-align:left">Type</th><th style="padding:6px;text-align:left">Concentration</th><th style="padding:6px;text-align:left">Time</th></tr></thead>
  <tbody>${(levels||[]).map((l,i)=>`<tr style="border-bottom:1px solid #f1f5f9"><td style="padding:4px 6px">#${i+1}</td><td style="padding:4px 6px">${l.label||'—'}</td><td style="padding:4px 6px;font-family:monospace">${l.conc} mg/L</td><td style="padding:4px 6px">t=${l.t_abs}h</td></tr>`).join('')}</tbody>
</table>

${hdr('3','Dose Recommendation')}
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px">
  <div class="metric-box"><div class="metric-label">Current AUC₂₄</div><div class="metric-value" style="color:${statusColor}">${auc24?auc24.toFixed(0):'—'}</div><div style="font-size:10px;color:${statusColor}">${status}</div></div>
  <div class="metric-box"><div class="metric-label">AUC/MIC</div><div class="metric-value" style="color:${aucMic&&aucMic>=400?'#059669':'#dc2626'}">${aucMic?aucMic.toFixed(0):'—'}</div><div style="font-size:10px;color:#64748b">Target ≥ 400</div></div>
  <div class="metric-box"><div class="metric-label">Target AUC₂₄</div><div class="metric-value" style="color:#059669">400–600</div><div style="font-size:10px;color:#64748b">mg·h/L</div></div>
</div>
${rec ? `<table class="section-table">
  ${r('Current Regimen', doses.length>0 ? `${doses[doses.length-1].dose_mg}mg q${doses[doses.length-1].tau_h}h` : 'N/A')}
  ${r('<strong style="color:#0891b2">Recommended</strong>', `<strong style="color:#0891b2">${rec.dose}mg q${rec.tau}h × ${rec.tinf}h infusion</strong>`)}
  ${r('Daily Dose', `${rec.daily_dose.toFixed(0)} mg/day`)}
  ${r('Predicted AUC₂₄', `${rec.predAUC.toFixed(0)} mg·h/L`)}
  ${r('Predicted Cmax', `${rec.Cmax.toFixed(1)} mg/L`)}
  ${r('Predicted Cmin', `${rec.Cmin.toFixed(1)} mg/L`)}
</table>` : '<p style="color:#94a3b8">No dose recommendation available</p>'}
${ciRate ? `<h3 style="font-size:13px;color:#475569;margin:16px 0 8px">Continuous Infusion Plan</h3>
<table class="section-table">${r('Loading Dose',`${ciRate.ld_low}–${ciRate.ld_high} mg`)}${r('CI Rate',`${ciRate.rate} mg/h (${ciRate.daily} mg/day)`)}${r('AUC₂₄ from Css',`${ciRate.auc24} mg·h/L`)}</table>` : ''}

${hdr('4','Safety Assessment')}
${aki&&aki.stage>0 ? `<div class="alert alert-danger" style="font-size:13px;font-weight:700">⚠ KDIGO AKI Stage ${aki.stage}: ${aki.criteria}</div>` : '<p style="color:#059669">No AKI criteria met ✓</p>'}
${(enc.alerts||[]).length > 0 ? `<div style="margin-top:10px">${enc.alerts.map(a => `<div class="alert alert-${a.level==='DANGER'?'danger':a.level==='WARN'?'warn':'info'}">[${a.level}] ${a.message}</div>`).join('')}</div>` : ''}
${p.nephrotoxins.length > 0 ? `<h3 style="font-size:13px;color:#475569;margin:16px 0 8px">Concurrent Nephrotoxins</h3>${p.nephrotoxins.map(k=>{const n=NEPHROTOXINS[k];return n?`<div class="alert alert-warn">${n.name} (${n.risk}): ${n.action}</div>`:''}).join('')}` : ''}

${hdr('5','Longitudinal Monitoring')}
${state.encounters.length > 1 ? `<table style="width:100%;font-size:11px;border:1px solid #e2e8f0;border-radius:6px">
  <thead><tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0"><th style="padding:6px;text-align:left">#</th><th style="padding:6px;text-align:left">Date</th><th style="padding:6px;text-align:left">Regimen</th><th style="padding:6px;text-align:left">AUC₂₄</th><th style="padding:6px;text-align:left">SCr</th></tr></thead>
  <tbody>${state.encounters.map((e,i)=>{const d=e.doses?.[e.doses.length-1];return `<tr style="border-bottom:1px solid #f1f5f9"><td style="padding:4px 6px">${i+1}</td><td style="padding:4px 6px">${new Date(e.timestamp).toLocaleDateString()}</td><td style="padding:4px 6px;font-family:monospace">${d?d.dose_mg+'mg q'+d.tau_h+'h':'N/A'}</td><td style="padding:4px 6px;font-family:monospace">${e.auc24?e.auc24.toFixed(0):'—'}</td><td style="padding:4px 6px">${e.scr_at_encounter||'—'}</td></tr>`}).join('')}</tbody>
</table>` : '<p style="color:#94a3b8">Single encounter — no trend data</p>'}

<div style="margin-top:32px;padding-top:16px;border-top:2px solid #e2e8f0;font-size:10px;color:#94a3b8;text-align:center">
  <strong style="color:#64748b">CLINICAL DECISION SUPPORT ONLY.</strong> All recommendations require qualified pharmacist/physician review before implementation.<br/>
  Based on 2020 ASHP/IDSA/PIDS/SIDP Vancomycin Consensus Guidelines.<br/>
  Report generated by AinaDara Calc v1.0 on ${new Date().toISOString()}
</div>
</body></html>`;

  const w = window.open('', '_blank', 'width=800,height=900');
  if (w) {
    w.document.write(html);
    w.document.close();
  } else {
    // Fallback: download as HTML file
    const blob = new Blob([html], {type:'text/html'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AinaDara_TDM_Report_${p.name||'patient'}_${new Date().toISOString().slice(0,10)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

// ═══════════════════════════════════════════════════════════
// PROGRESS NOTE GENERATOR
// ═══════════════════════════════════════════════════════════
function ProgressNotePanel({state}) {
  const enc = state.current_encounter;
  const p = state.patient;
  const [noteText, setNoteText] = useState('');
  const [copied, setCopied] = useState(false);

  const generateNote = () => {
    const {pk, auc24, aucMic, aki, rec, ciRate, doses, levels} = enc || {};
    const lastDose = doses?.[doses.length-1];
    const status = !auc24 ? 'N/A' : auc24 < 400 ? 'subtherapeutic' : auc24 > 600 ? 'supratherapeutic' : 'therapeutic';
    const troughLevel = levels?.find(l=>l.label==='Trough');
    const peakLevel = levels?.find(l=>l.label==='Peak');
    const now = new Date();

    // Build AUC/Trough interpretation
    let pkInterp = '';
    if (auc24) {
      pkInterp = `AUC₂₄ = ${auc24.toFixed(0)} mg·h/L (${status}; target 400-600). `;
      if (aucMic) pkInterp += `AUC/MIC = ${aucMic.toFixed(0)} (target ≥400 per 2020 ASHP/IDSA guidelines). `;
    }
    if (troughLevel) {
      const tInterp = +troughLevel.conc < 10 ? 'subtherapeutic' : +troughLevel.conc > 20 ? 'supratherapeutic' : 'within goal range';
      pkInterp += `Trough level: ${troughLevel.conc} mg/L (${tInterp}; historical target 15-20 mg/L for serious infections). `;
    }

    // Assessment severity
    const assessParts = [];
    if (p.clinical_status) assessParts.push(`Patient is clinically ${p.clinical_status}`);
    if (p.wbc) assessParts.push(`WBC ${p.wbc}×10³/μL${+p.wbc>11?' (leukocytosis)':+p.wbc<4?' (leukopenia)':''}`);
    if (p.temp) assessParts.push(`Temp ${p.temp}°F${+p.temp>100.4?' (febrile)':''}`);
    if (p.procalcitonin) assessParts.push(`PCT ${p.procalcitonin} ng/mL${+p.procalcitonin>0.5?' (elevated)':''}`);

    const note = `VANCOMYCIN THERAPEUTIC DRUG MONITORING NOTE
Date: ${now.toLocaleDateString()} ${now.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}

PATIENT: ${p.name || '[Name]'} | ${p.age || '—'}yo ${p.sex} | ${p.abw_kg || '—'}kg | ${p.height_cm || '—'}cm
Mode: ${p.mode.toUpperCase()} | BMI: ${p.bmi ? p.bmi.toFixed(1) : '—'} | IBW: ${p.ibw_kg?.toFixed(1)||'—'}kg | AdjBW: ${p.adjbw_kg?.toFixed(1)||'—'}kg
Allergies: ${p.allergies || 'NKDA'}

INDICATION: ${p.infection_type?.replace(/_/g,' ').toUpperCase() || 'N/A'}
Organism: ${p.organism || p.indication || 'MRSA (presumed/confirmed)'}
MIC: ${p.mic} mg/L (broth microdilution)
Day of Therapy: ${p.antibiotic_day || '—'}
${p.additional_abx ? 'Concurrent Antibiotics: '+p.additional_abx : ''}

MICROBIOLOGY:
${p.cultures || 'No culture data entered'}

IMAGING/DIAGNOSTICS:
${p.imaging || 'No imaging data entered'}

RELEVANT LABS:
SCr: ${p.scr || '—'} mg/dL | CrCl: ${p.crcl ? p.crcl.toFixed(0)+' mL/min (CG)' : '—'}${p.scr_48h ? ' | SCr 48h ago: '+p.scr_48h+' mg/dL' : ''}
${p.wbc ? 'WBC: '+p.wbc+'×10³/μL' : ''}${p.temp ? ' | Temp: '+p.temp+'°F' : ''}${p.procalcitonin ? ' | PCT: '+p.procalcitonin+' ng/mL' : ''}

CURRENT REGIMEN:
${lastDose ? `Vancomycin ${lastDose.dose_mg}mg q${lastDose.tau_h}h IV infused over ${lastDose.tinf_h}h` : 'No regimen entered'}
${p.mode==='CI' && ciRate ? `Continuous infusion: ${ciRate.rate} mg/h (target Css ${p.ci_target_css||22} mg/L)` : ''}
${p.mode==='HD' && p.hd_schedule ? `HD Schedule: ${p.hd_schedule}` : ''}

VANCOMYCIN LEVELS:
${levels?.length > 0 ? levels.map(l => `  ${l.label}: ${l.conc} mg/L at t=${l.t_abs}h post first dose`).join('\n') : '  No levels drawn'}

PHARMACOKINETIC ANALYSIS:
Method: ${pk?.method || 'Population Prior'}
Model: ${pk?.model || 'Matzke 1984'}
CL: ${pk?.CL_post?.toFixed(3)||'—'} L/h | Vd: ${pk?.Vd_post?.toFixed(1)||'—'} L
Ke: ${pk?.ke?.toFixed(4)||'—'} h⁻¹ | t½: ${pk?.t_half?.toFixed(1)||'—'} h
${pkInterp}
${aki && aki.stage > 0 ? `⚠ KDIGO AKI Stage ${aki.stage}: ${aki.criteria}\n${aki.action}` : 'No AKI criteria met.'}

ASSESSMENT:
${assessParts.length > 0 ? assessParts.join('. ')+'.' : 'Clinical status not documented.'}
${auc24 ? `Current vancomycin exposure is ${status} (AUC₂₄ ${auc24.toFixed(0)} mg·h/L).` : 'Insufficient data for AUC calculation.'}
${aucMic && aucMic < 400 ? 'AUC/MIC <400 — risk of treatment failure. Consider dose escalation or alternative agent.' : ''}
${aucMic && aucMic >= 400 && aucMic <= 600 ? 'AUC/MIC within therapeutic range. Continue current regimen with monitoring.' : ''}
${p.nephrotoxins.length > 0 ? 'Concurrent nephrotoxins: '+p.nephrotoxins.map(k=>NEPHROTOXINS[k]?.name||k).join(', ')+'. Monitor renal function closely.' : ''}

RECOMMENDATION:
${rec ? `Recommend vancomycin ${rec.dose}mg q${rec.tau}h IV infused over ${rec.tinf}h.
  - Predicted AUC₂₄: ${rec.predAUC.toFixed(0)} mg·h/L
  - Predicted Cmax: ${rec.Cmax.toFixed(1)} mg/L | Predicted Cmin: ${rec.Cmin.toFixed(1)} mg/L
  - Daily dose: ${rec.daily_dose.toFixed(0)} mg/day` : 'Continue current regimen pending additional data.'}

MONITORING PLAN:
- Obtain ${troughLevel ? 'repeat ' : ''}trough level 30 min before ${rec ? `4th dose of new regimen` : 'next dose'}
- ${p.mode==='AKI'||aki?.stage>=1 ? 'BMP daily (AKI monitoring)' : 'BMP q48-72h'}
- ${p.procalcitonin ? 'Repeat PCT in 48-72h for de-escalation assessment' : 'Consider PCT trending if source control unclear'}
- Reassess clinical response in 48-72h
${p.mic > 1 ? '- MIC >1: Reassess need for alternative agent (see ID consult)' : ''}

Electronically signed,
Clinical Pharmacist — Vancomycin TDM Service
Generated by AinaDara Calc | For clinical decision support only
`;

    setNoteText(note);
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(noteText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (!enc?.pk) return (
    <div style={{...S.card,textAlign:'center',padding:'48px'}}>
      <div style={{fontSize:'32px',marginBottom:'12px'}}>📝</div>
      <div style={{...S.h2,color:'#64748b'}}>Run analysis first</div>
      <div style={{...S.muted,fontSize:'13px',marginTop:'8px'}}>Enter patient data, dosing, and levels, then run Bayesian analysis to generate a progress note.</div>
    </div>
  );

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'16px'}}>
      <div style={S.card}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'14px'}}>
          <div style={S.h2}>Progress Note Generator</div>
          <div style={{display:'flex',gap:'8px'}}>
            <button onClick={generateNote} style={{...S.btnPrimary,padding:'8px 16px',fontSize:'13px'}}>
              📝 Generate Note
            </button>
            {noteText && (
              <button onClick={copyToClipboard} style={{...S.btnSecondary,padding:'8px 16px',fontSize:'13px'}}>
                {copied ? '✓ Copied!' : '📋 Copy'}
              </button>
            )}
          </div>
        </div>
        <div style={{fontSize:'12px',color:'#64748b',marginBottom:'12px'}}>
          Generates a complete TDM progress note from patient data, PK analysis, cultures, imaging, and recommendations. Add clinical documentation on the Patient tab for a more complete note.
        </div>

        {/* Quick clinical status */}
        {!state.patient.clinical_status && (
          <div style={{padding:'10px 12px',background:'#fffbeb',borderRadius:'6px',border:'1px solid #fde68a',fontSize:'12px',color:'#92400e',marginBottom:'12px'}}>
            Tip: Add cultures, imaging, WBC, temp, and clinical status on the Patient tab for a more comprehensive note.
          </div>
        )}
      </div>

      {noteText && (
        <div style={S.card}>
          <textarea
            value={noteText}
            onChange={e=>setNoteText(e.target.value)}
            style={{
              ...S.input,
              minHeight:'600px',
              fontFamily:"'DM Mono', 'Consolas', monospace",
              fontSize:'12px',
              lineHeight:'1.6',
              resize:'vertical',
              whiteSpace:'pre-wrap',
            }}
          />
          <div style={{marginTop:'8px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div style={{fontSize:'11px',color:'#94a3b8'}}>
              You can edit the note above before copying. Changes are not saved.
            </div>
            <button onClick={copyToClipboard} style={{...S.btnPrimary,padding:'8px 20px',fontSize:'13px'}}>
              {copied ? '✓ Copied to Clipboard!' : '📋 Copy to Clipboard'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// PHASE 5: MONTE CARLO TARGET ATTAINMENT PANEL
// ═══════════════════════════════════════════════════════════
function MonteCarloPanel({state}) {
  const enc = state.current_encounter;
  const [mcResult, setMcResult] = useState(null);
  const [simDose, setSimDose] = useState(enc?.rec?.dose || 1000);
  const [simTau, setSimTau] = useState(enc?.rec?.tau || 12);
  const [simTinf, setSimTinf] = useState(enc?.rec?.tinf || 1);

  useEffect(() => {
    if (enc?.rec) {
      setSimDose(enc.rec.dose);
      setSimTau(enc.rec.tau);
      setSimTinf(enc.rec.tinf);
    }
  }, [enc]);

  const runMC = useCallback(() => {
    if (!enc?.pk) return;
    const prior = PK.populationPrior({...state.patient, crcl: state.patient.crcl || 50});
    // Use Box-Muller Monte Carlo — 1000 virtual patients
    const N = 1000;
    const cv_CL = prior.CV_CL || 0.35;
    const cv_Vd = prior.CV_Vd || 0.30;
    const mean_CL = enc.pk.CL_post;
    const mean_Vd = enc.pk.Vd_post;

    const sigma2_CL = Math.log(1 + cv_CL * cv_CL);
    const mu_CL = Math.log(mean_CL) - sigma2_CL / 2;
    const sigma2_Vd = Math.log(1 + cv_Vd * cv_Vd);
    const mu_Vd = Math.log(mean_Vd) - sigma2_Vd / 2;

    const aucDist = [];
    let target = 0, sub = 0, supra = 0;

    for (let i = 0; i < N; i++) {
      const u1 = Math.max(1e-10, Math.random());
      const u2 = Math.random();
      const mag = Math.sqrt(-2 * Math.log(u1));
      const z1 = mag * Math.cos(2 * Math.PI * u2);
      const z2 = mag * Math.sin(2 * Math.PI * u2);
      const CL_i = Math.exp(mu_CL + Math.sqrt(sigma2_CL) * z1);
      const Vd_i = Math.exp(mu_Vd + Math.sqrt(sigma2_Vd) * z2);
      const tdd = simDose * (24 / simTau);
      const auc = tdd / CL_i;
      aucDist.push(auc);
      if (auc >= 400 && auc <= 600) target++;
      else if (auc < 400) sub++;
      else supra++;
    }

    aucDist.sort((a, b) => a - b);

    // Build histogram bins
    const binWidth = 50;
    const bins = {};
    aucDist.forEach(a => {
      const bin = Math.floor(a / binWidth) * binWidth;
      bins[bin] = (bins[bin] || 0) + 1;
    });
    const histogram = Object.entries(bins).map(([bin, count]) => ({
      bin: +bin, count, pct: (count / N * 100).toFixed(1),
      zone: +bin >= 400 && +bin < 600 ? 'target' : +bin < 400 ? 'sub' : 'supra'
    })).sort((a, b) => a.bin - b.bin);

    setMcResult({
      pct_target: (target / N * 100).toFixed(1),
      pct_sub: (sub / N * 100).toFixed(1),
      pct_supra: (supra / N * 100).toFixed(1),
      median: aucDist[Math.floor(N / 2)],
      p10: aucDist[Math.floor(N * 0.1)],
      p90: aucDist[Math.floor(N * 0.9)],
      histogram,
      n: N,
    });
  }, [enc, state.patient, simDose, simTau, simTinf]);

  if (!enc?.pk) return (
    <div style={{...S.card, textAlign: 'center', padding: '48px', color: '#64748b'}}>
      Run Bayesian analysis first to enable Monte Carlo simulation.
    </div>
  );

  const barColors = { target: '#059669', sub: '#dc2626', supra: '#d97706' };
  const maxCount = mcResult ? Math.max(...mcResult.histogram.map(h => h.count)) : 1;

  return (
    <div style={{display: 'flex', flexDirection: 'column', gap: '16px'}}>
      <div style={S.card}>
        <div style={{...S.h3, marginBottom: '14px'}}>Dose Simulation Parameters</div>
        <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: '10px', alignItems: 'end'}}>
          <div>
            <label style={S.label}>Dose (mg)</label>
            <input style={S.input} type="number" value={simDose} onChange={e => setSimDose(+e.target.value)}/>
          </div>
          <div>
            <label style={S.label}>Interval (h)</label>
            <input style={S.input} type="number" value={simTau} onChange={e => setSimTau(+e.target.value)}/>
          </div>
          <div>
            <label style={S.label}>Infusion (h)</label>
            <input style={S.input} type="number" value={simTinf} onChange={e => setSimTinf(+e.target.value)}/>
          </div>
          <button onClick={runMC} style={{...S.btnPrimary, padding: '10px 20px'}}>Simulate 1000 Patients</button>
        </div>
      </div>

      {mcResult && (
        <>
          {/* Target Attainment Summary */}
          <div className='ad-grid-3' style={{...S.card, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', textAlign: 'center'}}>
            <div>
              <div style={{...S.mono, fontSize: '28px', fontWeight: '800', color: '#dc2626'}}>{mcResult.pct_sub}%</div>
              <div style={{...S.label, color: '#dc2626'}}>Subtherapeutic (&lt;400)</div>
            </div>
            <div>
              <div style={{...S.mono, fontSize: '28px', fontWeight: '800', color: '#059669'}}>{mcResult.pct_target}%</div>
              <div style={{...S.label, color: '#059669'}}>Target (400–600)</div>
            </div>
            <div>
              <div style={{...S.mono, fontSize: '28px', fontWeight: '800', color: '#d97706'}}>{mcResult.pct_supra}%</div>
              <div style={{...S.label, color: '#d97706'}}>Supratherapeutic (&gt;600)</div>
            </div>
          </div>

          {/* SVG Histogram */}
          <div style={S.card}>
            <div style={{...S.h3, marginBottom: '12px'}}>AUC₂₄ Distribution (n={mcResult.n})</div>
            <svg width="100%" viewBox="0 0 500 200" style={{overflow: 'visible'}}>
              {/* Reference zones */}
              <rect x={500*(400/1200)} y="0" width={500*(200/1200)} height="170" fill="#00e5a008" stroke="#00e5a020" strokeDasharray="3,3"/>
              {mcResult.histogram.map((h, i) => {
                const barH = (h.count / maxCount) * 150;
                const x = 500 * (h.bin / 1200);
                const w = Math.max(500 * (45 / 1200), 2);
                return (
                  <g key={i}>
                    <rect x={x} y={170 - barH} width={w} height={barH} fill={barColors[h.zone]} opacity="0.8" rx="1"/>
                  </g>
                );
              })}
              {/* X axis */}
              <line x1="0" y1="170" x2="500" y2="170" stroke="#cbd5e1"/>
              {[0, 200, 400, 600, 800, 1000, 1200].map(v => (
                <text key={v} x={500*(v/1200)} y="185" textAnchor="middle" fill="#64748b" fontSize="9" fontFamily="monospace">{v}</text>
              ))}
              <text x="250" y="198" textAnchor="middle" fill="#64748b" fontSize="9">AUC₂₄ (mg·h/L)</text>
              {/* Reference lines */}
              <line x1={500*(400/1200)} y1="0" x2={500*(400/1200)} y2="170" stroke="#00e5a0" strokeDasharray="4,4"/>
              <line x1={500*(600/1200)} y1="0" x2={500*(600/1200)} y2="170" stroke="#f59e0b" strokeDasharray="4,4"/>
            </svg>
            <div className='ad-grid-3' style={{display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginTop: '12px', fontSize: '12px'}}>
              <div><span style={S.muted}>Median: </span><span style={S.mono}>{mcResult.median.toFixed(0)} mg·h/L</span></div>
              <div><span style={S.muted}>P10: </span><span style={S.mono}>{mcResult.p10.toFixed(0)}</span></div>
              <div><span style={S.muted}>P90: </span><span style={S.mono}>{mcResult.p90.toFixed(0)}</span></div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════
export default function AinaDaraCalc() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const {ui, patient, alerts} = state;
  const [showSettings, setShowSettings] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState(getClaudeApiKey());

  // Load fonts
  useEffect(()=>{
    const link=document.createElement('link');
    link.rel='stylesheet';
    link.href='https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700;800&family=DM+Mono:wght@400;500;600&display=swap';
    document.head.appendChild(link);
  },[]);

  // Phase 3: Auto-persist state to localStorage on encounters/patient change
  useEffect(()=>{
    persistState(state);
  },[state.encounters, state.patient]);

  const tabs=[
    {id:'patient',label:'Patient',icon:'👤'},
    {id:'dosing',label:'Dosing',icon:'💊'},
    {id:'results',label:'Results',icon:'📊'},
    {id:'note',label:'Note',icon:'📝'},
    {id:'montecarlo',label:'Monte Carlo',icon:'🎲'},
    {id:'history',label:'History',icon:'📋'},
    {id:'alternatives',label:'Alternatives',icon:'⚕'},
  ];

  const modeColors={standard:'#0891b2',obese:'#d97706',HD:'#7c3aed',CRRT:'#059669',AKI:'#dc2626',neonatal:'#ea580c',pediatric:'#0284c7',CI:'#7c3aed'};
  const modeColor=modeColors[patient.mode]||'#0891b2';

  return (
    <div style={S.app}>
      {/* Responsive meta */}
      <style>{`
        @media (max-width: 768px) {
          .ad-grid-2 { grid-template-columns: 1fr !important; }
          .ad-grid-3 { grid-template-columns: 1fr 1fr !important; }
          .ad-tabs { overflow-x: auto; -webkit-overflow-scrolling: touch; }
          .ad-tabs button { padding: 10px 12px !important; font-size: 12px !important; white-space: nowrap; }
          .ad-header-meta { display: none !important; }
        }
        @media (max-width: 375px) {
          .ad-grid-3 { grid-template-columns: 1fr !important; }
          .ad-tabs button { padding: 8px 8px !important; font-size: 11px !important; }
        }
      `}</style>
      {/* Header */}
      <div style={{
        background:'linear-gradient(180deg,#ffffff 0%,#f8fafc 100%)',
        borderBottom:'1px solid #e2e8f0',
        padding:'0 24px',
        position:'sticky',top:0,zIndex:100,
      }}>
        <div style={{maxWidth:'1200px',margin:'0 auto',display:'flex',alignItems:'center',gap:'16px',height:'56px'}}>
          <div style={{display:'flex',alignItems:'center',gap:'10px',flex:1}}>
            <div style={{
              width:'32px',height:'32px',borderRadius:'8px',
              background:`linear-gradient(135deg,${modeColor},${modeColor}80)`,
              display:'flex',alignItems:'center',justifyContent:'center',
              fontSize:'16px',fontWeight:'800',color:'#ffffff',
            }}>⚕</div>
            <div>
              <div style={{fontSize:'14px',fontWeight:'800',color:'#0f172a',letterSpacing:'-0.01em'}}>AinaDara Calc</div>
              <div style={{fontSize:'10px',color:'#64748b',letterSpacing:'0.04em',textTransform:'uppercase'}}>TDM Suite</div>
            </div>
          </div>
          {/* Mode badge */}
          <div style={{
            fontSize:'11px',padding:'4px 10px',borderRadius:'20px',fontWeight:'700',
            background:`${modeColor}20`,color:modeColor,border:`1px solid ${modeColor}40`,
          }}>{patient.mode.toUpperCase()}</div>
          {patient.name&&<div style={{fontSize:'13px',color:'#64748b',maxWidth:'120px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{patient.name}</div>}
          {patient.crcl&&<div style={{fontSize:'12px',color:'#64748b',fontFamily:'monospace'}}>CrCl {patient.crcl.toFixed(0)}</div>}
          {/* PDF Export */}
          {state.current_encounter?.pk && (
            <button onClick={()=>exportPDF(state)} style={{...S.btnSecondary,padding:'5px 12px',fontSize:'11px'}}>PDF Report</button>
          )}
          {/* Settings */}
          <button onClick={()=>setShowSettings(!showSettings)} style={{
            background:'none',border:'none',cursor:'pointer',fontSize:'18px',color:'#64748b',padding:'4px',
            opacity: getClaudeApiKey()?1:0.5,
          }} title="Settings — Claude AI Validation">⚙️</button>
          {/* Alert count */}
          {alerts.filter(a=>a.level==='DANGER').length>0&&(
            <div style={{background:'#dc2626',color:'white',fontSize:'11px',fontWeight:'700',borderRadius:'12px',padding:'2px 8px'}}>
              {alerts.filter(a=>a.level==='DANGER').length} DANGER
            </div>
          )}
        </div>
        {/* Tabs */}
        <div className="ad-tabs" style={{maxWidth:'1200px',margin:'0 auto',display:'flex',gap:'0',borderTop:'1px solid #e2e8f0'}}>
          {tabs.map(t=>(
            <button key={t.id} onClick={()=>dispatch({type:'SET_UI',payload:{activeTab:t.id}})} style={{
              padding:'10px 20px',background:'none',border:'none',
              color:ui.activeTab===t.id?modeColor:'#94a3b8',
              fontWeight:ui.activeTab===t.id?'700':'400',
              fontSize:'13px',cursor:'pointer',
              borderBottom:ui.activeTab===t.id?`2px solid ${modeColor}`:'2px solid transparent',
              transition:'all 0.15s',
            }}>{t.icon} {t.label}</button>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <div style={{maxWidth:'1200px',margin:'0 auto',padding:'20px 24px'}}>
        <AlertBanner alerts={alerts.filter(a=>['DANGER','WARN'].includes(a.level)).slice(0,3)} onDismiss={id=>dispatch({type:'SET_ALERTS',payload:alerts.filter(a=>a.id!==id)})}/>
        {ui.activeTab==='patient'&&<PatientPanel state={state} dispatch={dispatch}/>}
        {ui.activeTab==='dosing'&&<DosingPanel state={state} dispatch={dispatch}/>}
        {ui.activeTab==='results'&&<ResultsPanel state={state} dispatch={dispatch}/>}
        {ui.activeTab==='note'&&<ProgressNotePanel state={state}/>}
        {ui.activeTab==='montecarlo'&&<MonteCarloPanel state={state}/>}
        {ui.activeTab==='history'&&<HistoryPanel state={state} dispatch={dispatch}/>}
        {ui.activeTab==='alternatives'&&<AlternativesPanel state={state}/>}
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.3)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setShowSettings(false)}>
          <div style={{background:'#ffffff',borderRadius:'12px',padding:'24px',maxWidth:'420px',width:'90%',boxShadow:'0 8px 32px rgba(0,0,0,0.15)'}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:'16px',fontWeight:'700',color:'#0f172a',marginBottom:'16px'}}>⚙️ Settings</div>
            <div style={{marginBottom:'16px'}}>
              <label style={{...S.label,marginBottom:'6px',display:'block'}}>Claude API Key (for AI Smart Validation)</label>
              <input
                style={{...S.input,width:'100%',fontFamily:'monospace',fontSize:'12px'}}
                type="password"
                value={apiKeyInput}
                onChange={e=>setApiKeyInput(e.target.value)}
                placeholder="sk-ant-api03-..."
              />
              <div style={{fontSize:'11px',color:'#94a3b8',marginTop:'6px'}}>
                Uses Claude Haiku for real-time clinical plausibility checks. Your key is stored locally only.
              </div>
            </div>
            <div style={{display:'flex',gap:'8px',justifyContent:'flex-end'}}>
              <button onClick={()=>{setClaudeApiKey('');setApiKeyInput('');}} style={{...S.btnSecondary,padding:'6px 14px',fontSize:'12px'}}>Clear</button>
              <button onClick={()=>{setClaudeApiKey(apiKeyInput);setShowSettings(false);}} style={{...S.btnPrimary,padding:'6px 14px',fontSize:'12px'}}>Save</button>
            </div>
            {getClaudeApiKey() && (
              <div style={{marginTop:'12px',padding:'8px',background:'#f0fdf4',borderRadius:'6px',fontSize:'11px',color:'#166534'}}>
                ✓ AI Validation active — Claude will review each calculation for clinical plausibility.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{
        borderTop:'1px solid #e2e8f0',
        padding:'12px 24px',
        fontSize:'11px',
        color:'#94a3b8',
        textAlign:'center',
        marginTop:'20px',
        background:'#ffffff',
      }}>
        AinaDara Calc | Therapeutic Drug Monitoring Suite | Based on 2020 ASHP/IDSA/PIDS/SIDP Vancomycin Consensus Guidelines
        <br/>
        <strong style={{color:'#64748b'}}>FOR CLINICAL DECISION SUPPORT ONLY. All recommendations require qualified pharmacist/physician review before implementation.</strong>
      </div>
    </div>
  );
}
