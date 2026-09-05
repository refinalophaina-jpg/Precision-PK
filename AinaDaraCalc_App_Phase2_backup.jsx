// AinaDara Calc | Therapeutic Drug Monitoring Suite
// Single-file React JSX — 2020 ASHP/IDSA/PIDS/SIDP Vancomycin Guidelines
// Clinical Decision Support Only — All recommendations require clinician review

import { useState, useReducer, useEffect, useCallback, useRef } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer, ScatterChart, Scatter } from "recharts";

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
const initialState = {
  patient: {
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
  },
  encounters: [],
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
      const encounters = [...state.encounters.filter(e=>e.id!==enc.id), enc];
      return {...state, encounters, current_encounter: enc};
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
  standard: {
    patient: {age:70, sex:'M', height_cm:175, abw_kg:75, scr:1.4, scr_48h:'', scr_7d:'', mode:'standard', name:'Standard Adult'},
    encounter: {
      doses:[{dose_mg:1000,tinf_h:1,tau_h:12,start_h:0},{dose_mg:1000,tinf_h:1,tau_h:12,start_h:12},{dose_mg:1000,tinf_h:1,tau_h:12,start_h:24}],
      levels:[{t_abs:27,conc:28.5,label:'Peak'},{t_abs:36,conc:10.2,label:'Trough'}]
    }
  },
  obese: {
    patient: {age:45, sex:'F', height_cm:165, abw_kg:125, scr:0.9, mode:'obese', name:'Obese Patient'},
    encounter: {
      doses:[{dose_mg:1000,tinf_h:1,tau_h:12,start_h:0},{dose_mg:1000,tinf_h:1,tau_h:12,start_h:12}],
      levels:[{t_abs:23.5,conc:7.2,label:'Trough'}]
    }
  },
  aki: {
    patient: {age:58, sex:'M', height_cm:178, abw_kg:75, scr:1.6, scr_48h:1.1, scr_7d:1.0, mode:'AKI', name:'AKI Patient', nephrotoxins:['pip_tazo']},
    encounter: {
      doses:[{dose_mg:1500,tinf_h:1,tau_h:12,start_h:0},{dose_mg:1500,tinf_h:1,tau_h:12,start_h:12},{dose_mg:1500,tinf_h:1,tau_h:12,start_h:24}],
      levels:[{t_abs:27,conc:32.1,label:'Peak'},{t_abs:36,conc:18.9,label:'Trough'}]
    }
  },
  neonatal: {
    patient: {age:0, sex:'M', abw_kg:1.1, height_cm:38, scr:0.8, mode:'neonatal', pma_weeks:28, postnatal_days:5, birth_weight_kg:1.0, name:'Preterm Neonate'},
    encounter: {
      doses:[{dose_mg:16.5,tinf_h:1,tau_h:24,start_h:0}],
      levels:[{t_abs:2,conc:22.1,label:'Peak'}]
    }
  },
  high_mic: {
    patient: {age:55, sex:'M', height_cm:175, abw_kg:78, scr:1.0, mode:'standard', mic:2.0, name:'High MIC', infection_type:'bacteremia'},
    encounter: {
      doses:[{dose_mg:1750,tinf_h:1.5,tau_h:12,start_h:0},{dose_mg:1750,tinf_h:1.5,tau_h:12,start_h:12}],
      levels:[{t_abs:13.5,conc:14.5,label:'Trough'}]
    }
  }
};

// ═══════════════════════════════════════════════════════════
// STYLES (dark clinical theme)
// ═══════════════════════════════════════════════════════════
const S = {
  app: {
    minHeight:'100vh',
    background:'#0a0f1e',
    color:'#e2e8f0',
    fontFamily:"'DM Sans', 'Segoe UI', sans-serif",
  },
  card: {
    background:'#111827',
    border:'1px solid #1e293b',
    borderRadius:'12px',
    padding:'20px',
  },
  cardDark: {
    background:'#0d1424',
    border:'1px solid #1e293b',
    borderRadius:'12px',
    padding:'20px',
  },
  input: {
    background:'#1e293b',
    border:'1px solid #334155',
    borderRadius:'8px',
    color:'#e2e8f0',
    padding:'8px 12px',
    fontSize:'14px',
    width:'100%',
    outline:'none',
    fontFamily:"'DM Mono', monospace",
  },
  inputSm: {
    background:'#1e293b',
    border:'1px solid #334155',
    borderRadius:'6px',
    color:'#e2e8f0',
    padding:'6px 10px',
    fontSize:'13px',
    width:'100%',
    outline:'none',
    fontFamily:"'DM Mono', monospace",
  },
  select: {
    background:'#1e293b',
    border:'1px solid #334155',
    borderRadius:'8px',
    color:'#e2e8f0',
    padding:'8px 12px',
    fontSize:'14px',
    width:'100%',
    outline:'none',
  },
  label: { fontSize:'12px', color:'#64748b', marginBottom:'4px', display:'block', textTransform:'uppercase', letterSpacing:'0.05em' },
  btnPrimary: {
    background:'linear-gradient(135deg,#00d4ff,#0891b2)',
    color:'#0a0f1e',
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
    color:'#00d4ff',
    border:'1px solid #00d4ff',
    borderRadius:'8px',
    padding:'8px 16px',
    cursor:'pointer',
    fontSize:'13px',
  },
  btnDanger: {
    background:'#ff4757',
    color:'white',
    border:'none',
    borderRadius:'6px',
    padding:'6px 12px',
    cursor:'pointer',
    fontSize:'12px',
  },
  btnGhost: {
    background:'#1e293b',
    color:'#94a3b8',
    border:'1px solid #334155',
    borderRadius:'6px',
    padding:'5px 10px',
    cursor:'pointer',
    fontSize:'12px',
  },
  mono: { fontFamily:"'DM Mono', monospace" },
  cyan: { color:'#00d4ff' },
  green: { color:'#00e5a0' },
  amber: { color:'#f59e0b' },
  red: { color:'#ff4757' },
  purple: { color:'#a78bfa' },
  muted: { color:'#64748b' },
  h1: { fontSize:'20px', fontWeight:'800', color:'#f1f5f9', margin:0 },
  h2: { fontSize:'16px', fontWeight:'700', color:'#e2e8f0', margin:0 },
  h3: { fontSize:'13px', fontWeight:'600', color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.08em' },
};

// ═══════════════════════════════════════════════════════════
// ALERT COMPONENT
// ═══════════════════════════════════════════════════════════
function AlertBanner({alerts, onDismiss}) {
  if(!alerts.length) return null;
  const colors = {DANGER:'#ff4757',WARN:'#f59e0b',INFO:'#00d4ff'};
  const bg = {DANGER:'rgba(255,71,87,0.1)',WARN:'rgba(245,158,11,0.1)',INFO:'rgba(0,212,255,0.08)'};
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
          <span style={{fontSize:'13px',color:'#e2e8f0',flex:1}}>{a.message}</span>
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
        background:'none',border:'none',color:'#00d4ff',cursor:'pointer',
        fontSize:'11px',padding:'0 4px',fontFamily:'monospace',
      }} title="Show formula">ⓘ</button>
      {show && (
        <div style={{
          background:'#1e293b',border:'1px solid #334155',borderRadius:'8px',
          padding:'12px',marginTop:'4px',fontSize:'12px',
          fontFamily:"'DM Mono',monospace",color:'#94a3b8',
          maxWidth:'320px',lineHeight:'1.6',
        }}>
          <div style={{color:'#00d4ff',marginBottom:'4px',fontWeight:'600'}}>{label}</div>
          <div style={{color:'#e2e8f0',whiteSpace:'pre-wrap'}}>{formula}</div>
          {result&&<div style={{color:'#00e5a0',marginTop:'6px'}}>= {result}</div>}
          {evidence&&<div style={{color:'#f59e0b',marginTop:'4px',fontSize:'11px'}}>[{evidence}]</div>}
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
  let color='#ff4757', status='SUBTHERAPEUTIC';
  if((auc||0)>=target_low && (auc||0)<=target_high) { color='#00e5a0'; status='THERAPEUTIC'; }
  else if((auc||0)>target_high) { color='#f59e0b'; status='SUPRATHERAPEUTIC'; }
  return (
    <div style={{textAlign:'center'}}>
      <svg width={size} height={size*0.75} viewBox={`0 0 ${size} ${size*0.75}`}>
        <path d={arcPath(0,1,'#1e293b')} fill="none" stroke="#1e293b" strokeWidth={stroke+2} strokeLinecap="round"/>
        <path d={arcPath(0,lo,'#1e293b')} fill="none" stroke="#334155" strokeWidth={stroke} strokeLinecap="round"/>
        <path d={arcPath(lo,hi,'#1e293b')} fill="none" stroke="#00e5a040" strokeWidth={stroke} strokeLinecap="round"/>
        <path d={arcPath(hi,1,'#1e293b')} fill="none" stroke="#334155" strokeWidth={stroke} strokeLinecap="round"/>
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
          <line x1={PAD.l} x2={W-PAD.r} y1={scY(v)} y2={scY(v)} stroke="#1e293b" strokeDasharray="3,3"/>
          <text x={PAD.l-6} y={scY(v)+4} textAnchor="end" fill="#475569" fontSize="9" fontFamily="monospace">{v}</text>
        </g>
      ))}
      {xTicks.map(t=>(
        <g key={t}>
          <line x1={scX(t)} x2={scX(t)} y1={PAD.t} y2={H-PAD.b} stroke="#1e293b" strokeDasharray="3,3"/>
          <text x={scX(t)} y={H-PAD.b+12} textAnchor="middle" fill="#475569" fontSize="9" fontFamily="monospace">{t}h</text>
        </g>
      ))}
      {/* axes */}
      <line x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={H-PAD.b} stroke="#334155"/>
      <line x1={PAD.l} x2={W-PAD.r} y1={H-PAD.b} y2={H-PAD.b} stroke="#334155"/>
      <text x={14} y={H/2} textAnchor="middle" fill="#64748b" fontSize="9" transform={`rotate(-90,14,${H/2})`}>mg/L</text>
      {/* current curve */}
      <path d={toPath(points)} fill="none" stroke="#00d4ff" strokeWidth="1.5" style={{filter:'drop-shadow(0 0 3px #00d4ff60)'}}/>
      {/* recommended curve */}
      {recPoints.length>0 && <path d={toPath(recPoints)} fill="none" stroke="#a78bfa" strokeWidth="1.5" strokeDasharray="5,3"/>}
      {/* observed levels */}
      {(levels||[]).map((l,i)=>(
        <g key={i}>
          <circle cx={scX(l.t_abs)} cy={scY(l.conc)} r="5" fill="#f59e0b" stroke="#0a0f1e" strokeWidth="1.5"/>
          <text x={scX(l.t_abs)} y={scY(l.conc)-8} textAnchor="middle" fill="#f59e0b" fontSize="8">{l.label}</text>
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
            {Object.entries(SCENARIOS).map(([k,s])=><option key={k} value={k}>{s.patient.name}</option>)}
          </select>
        </div>
      </div>

      <div style={S.card}>
        <div style={{...S.h3,marginBottom:'14px'}}>Demographics</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px'}}>
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
                  background:patient.sex===s?'#00d4ff':'#1e293b',
                  color:patient.sex===s?'#0a0f1e':'#94a3b8',
                  border:`1px solid ${patient.sex===s?'#00d4ff':'#334155'}`,
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
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px'}}>
            <div><label style={S.label}>PMA Weeks</label><input style={S.input} type="number" value={patient.pma_weeks} onChange={e=>set('pma_weeks',+e.target.value)}/></div>
            <div><label style={S.label}>PMA Days</label><input style={S.input} type="number" value={patient.pma_days} onChange={e=>set('pma_days',+e.target.value)}/></div>
            <div><label style={S.label}>Postnatal Days</label><input style={S.input} type="number" value={patient.postnatal_days} onChange={e=>set('postnatal_days',+e.target.value)}/></div>
            <div><label style={S.label}>Birth Weight (kg)</label><input style={S.input} type="number" step="0.1" value={patient.birth_weight_kg} onChange={e=>set('birth_weight_kg',+e.target.value)}/></div>
          </div>
          {patient.postnatal_days<3&&(
            <div style={{marginTop:'10px',padding:'8px 12px',background:'rgba(245,158,11,0.1)',borderRadius:'6px',border:'1px solid #f59e0b40',fontSize:'12px',color:'#f59e0b'}}>
              ⚠ Postnatal age &lt; 72h — SCr reflects maternal creatinine. Do not use for CrCl estimation.
            </div>
          )}
        </div>
      )}

      {/* Auto-calculated values */}
      {(patient.ibw_kg||patient.crcl)&&(
        <div style={{...S.card,background:'#0d1424'}}>
          <div style={{...S.h3,marginBottom:'12px'}}>Auto-Calculated</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'12px'}}>
            {patient.ibw_kg&&<div>
              <div style={S.label}>IBW</div>
              <div style={{...S.mono,...S.cyan,fontSize:'16px',fontWeight:'700'}}>{patient.ibw_kg.toFixed(1)} kg</div>
              <div style={{fontSize:'10px',...S.muted}}>Devine formula</div>
            </div>}
            {patient.bmi&&<div>
              <div style={S.label}>BMI</div>
              <div style={{...S.mono,fontSize:'16px',fontWeight:'700',color:patient.bmi>=30?'#f59e0b':'#00e5a0'}}>{patient.bmi.toFixed(1)}</div>
              <div style={{fontSize:'10px',...S.muted}}>{patient.bmi>=30?'Obese':'Normal'}</div>
            </div>}
            {patient.crcl&&<div>
              <div style={S.label}>CrCl</div>
              <div style={{...S.mono,fontSize:'16px',fontWeight:'700',color:patient.crcl>130?'#a78bfa':patient.crcl<30?'#ff4757':'#00e5a0'}}>{patient.crcl.toFixed(0)} mL/min</div>
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
            const col=n.alert==='DANGER'?'#ff4757':n.alert==='WARN'?'#f59e0b':'#00d4ff';
            return (
              <button key={k} onClick={()=>dispatch({type:'TOGGLE_NEPHROTOXIN',key:k})} style={{
                padding:'5px 10px',borderRadius:'20px',cursor:'pointer',fontSize:'11px',fontWeight:'600',
                background:active?`${col}25`:'#1e293b',
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
                <span style={{color:NEPHROTOXINS[k].alert==='DANGER'?'#ff4757':'#f59e0b',fontWeight:'700'}}>{NEPHROTOXINS[k].name}</span>: {NEPHROTOXINS[k].action}
              </div>
            ))}
          </div>
        )}
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

  // sync from loaded scenario
  useEffect(()=>{
    if(state.current_encounter?.doses) setDoses(state.current_encounter.doses);
    if(state.current_encounter?.levels) setLevels(state.current_encounter.levels);
  },[state.current_encounter]);

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

    // Build prior
    const prior=PK.populationPrior({...patient,crcl:patient.crcl||50});

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
    };

    dispatch({type:'ADD_ENCOUNTER',payload:encounter});
    dispatch({type:'SET_ALERTS',payload:alerts});
    dispatch({type:'SET_UI',payload:{activeTab:'results'}});
  };

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'16px'}}>
      {/* CI Rate Calculator */}
      {patient.mode==='CI'&&(
        <div style={S.card}>
          <div style={{...S.h3,marginBottom:'14px'}}>Continuous Infusion Calculator</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px',marginBottom:'12px'}}>
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
              <div style={{background:'#0d1424',borderRadius:'8px',padding:'12px'}}>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'8px',fontSize:'12px'}}>
                  <div><div style={S.label}>Loading Dose</div><div style={{...S.mono,...S.cyan,fontSize:'15px',fontWeight:'700'}}>{Math.round(15*(+patient.abw_kg||70)/250)*250}–{Math.round(20*(+patient.abw_kg||70)/250)*250} mg</div></div>
                  <div><div style={S.label}>CI Rate</div><div style={{...S.mono,...S.cyan,fontSize:'15px',fontWeight:'700'}}>{rate.toFixed(1)} mg/h</div></div>
                  <div><div style={S.label}>AUC₂₄</div><div style={{...S.mono,...S.green,fontSize:'15px',fontWeight:'700'}}>{(ciTarget*24).toFixed(0)} mg·h/L</div></div>
                </div>
                {measCss&&<div style={{marginTop:'8px',fontSize:'12px',color:'#a78bfa'}}>Adjusted rate: {((ciTarget/+measCss)*rate).toFixed(1)} mg/h → Css {ciTarget} mg/L</div>}
              </div>
            );
          })()}
        </div>
      )}

      {/* Dose History */}
      <div style={S.card}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'14px'}}>
          <div style={S.h3}>Dosing History</div>
        </div>
        {doses.map((d,i)=>(
          <div key={i} style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'6px',background:'#1e293b',borderRadius:'6px',padding:'8px 12px',fontSize:'13px'}}>
            <span style={{...S.mono,...S.cyan,minWidth:'24px',color:'#64748b'}}>#{i+1}</span>
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
      </div>

      {/* Observed Levels */}
      <div style={S.card}>
        <div style={{...S.h3,marginBottom:'14px'}}>Observed Levels</div>
        {levels.length===0&&<div style={{...S.muted,fontSize:'13px',marginBottom:'8px'}}>No levels entered — population prior will be used</div>}
        {levels.map((l,i)=>(
          <div key={i} style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'6px',background:'#1e293b',borderRadius:'6px',padding:'8px 12px',fontSize:'13px'}}>
            <span style={{color:'#f59e0b',minWidth:'36px',fontWeight:'600'}}>{l.label}</span>
            <span style={{...S.mono,flex:1}}><span style={{color:'#f59e0b'}}>{l.conc}</span> mg/L @ t={l.t_abs}h</span>
            <button onClick={()=>setLevels(levels.filter((_,j)=>j!==i))} style={{background:'none',border:'none',color:'#475569',cursor:'pointer',fontSize:'16px'}}>×</button>
          </div>
        ))}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr auto',gap:'6px',marginTop:'8px',alignItems:'end'}}>
          <div>
            <label style={S.label}>Type</label>
            <select style={{...S.select,padding:'6px 10px',fontSize:'13px'}} value={newLevel.label} onChange={e=>setNewLevel({...newLevel,label:e.target.value})}>
              {['Trough','Peak','Random'].map(l=><option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div>
            <label style={S.label}>Conc (mg/L)</label>
            <input style={S.inputSm} type="number" value={newLevel.conc} onChange={e=>setNewLevel({...newLevel,conc:e.target.value})} placeholder="12.5"/>
          </div>
          <div>
            <label style={S.label}>Time (h abs)</label>
            <input style={S.inputSm} type="number" value={newLevel.t_abs} onChange={e=>setNewLevel({...newLevel,t_abs:e.target.value})} placeholder="23.5"/>
          </div>
          <button onClick={addLevel} style={{...S.btnPrimary,padding:'6px 14px',fontSize:'20px',alignSelf:'flex-end'}}>+</button>
        </div>
        <div style={{marginTop:'8px',fontSize:'11px',color:'#475569'}}>
          Times in hours from first dose start (e.g. peak at t=2h; trough at t=11.5h for q12h)
        </div>
      </div>

      <button onClick={runCalc} style={{...S.btnPrimary,padding:'14px',fontSize:'15px',fontWeight:'800',letterSpacing:'0.04em',textAlign:'center'}}>
        ▶ RUN BAYESIAN ANALYSIS
      </button>
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
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
            {[
              {l:'Method',v:pk.method,c:'#64748b'},
              {l:'Model',v:pk.model,c:'#64748b'},
              {l:'CL (post)',v:`${pk.CL_post.toFixed(3)} L/h`,c:'#00d4ff'},
              {l:'Vd (post)',v:`${pk.Vd_post.toFixed(1)} L`,c:'#00d4ff'},
              {l:'Ke',v:`${pk.ke.toFixed(4)} h⁻¹`,c:'#a78bfa'},
              {l:'t½',v:`${pk.t_half.toFixed(1)} h`,c:'#a78bfa'},
              {l:'AUC/MIC',v:aucMic?`${aucMic.toFixed(0)} (MIC ${state.patient.mic})`:'-',c:aucMic&&aucMic>=400?'#00e5a0':'#ff4757'},
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
            <span style={{fontSize:'11px',background:'#f59e0b25',color:'#f59e0b',padding:'2px 8px',borderRadius:'12px',border:'1px solid #f59e0b40'}}>{grade}</span>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'16px'}}>
            <div style={{background:'#0d1424',borderRadius:'8px',padding:'12px'}}>
              <div style={{fontSize:'11px',color:'#64748b',marginBottom:'6px',textTransform:'uppercase',letterSpacing:'0.06em'}}>Current Regimen</div>
              {doses[doses.length-1]&&<div style={{...S.mono,fontSize:'15px',color:'#94a3b8'}}>{doses[doses.length-1].dose_mg} mg q{doses[doses.length-1].tau_h}h</div>}
              <div style={{...S.mono,fontSize:'13px',color:auc24<400?'#ff4757':auc24>600?'#f59e0b':'#00e5a0',marginTop:'4px'}}>AUC₂₄: {auc24?.toFixed(0)||'—'} mg·h/L</div>
            </div>
            <div style={{background:'#0d1424',borderRadius:'8px',padding:'12px',border:'1px solid #00d4ff30'}}>
              <div style={{fontSize:'11px',color:'#00d4ff',marginBottom:'6px',textTransform:'uppercase',letterSpacing:'0.06em'}}>Recommended</div>
              <div style={{...S.mono,fontSize:'15px',color:'#00d4ff',fontWeight:'700'}}>{rec.dose} mg q{rec.tau}h × {rec.tinf}h</div>
              <div style={{...S.mono,fontSize:'13px',color:'#00e5a0',marginTop:'4px'}}>Pred. AUC₂₄: {rec.predAUC.toFixed(0)} mg·h/L ✓</div>
            </div>
          </div>
          <div style={{marginTop:'12px',display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'8px',fontSize:'12px'}}>
            <div><span style={S.muted}>Daily Dose: </span><span style={S.mono}>{rec.daily_dose.toFixed(0)} mg/day</span></div>
            <div><span style={S.muted}>Pred. Cmax: </span><span style={{...S.mono,color:'#a78bfa'}}>{rec.Cmax.toFixed(1)} mg/L</span></div>
            <div><span style={S.muted}>Pred. Cmin: </span><span style={{...S.mono,color:'#a78bfa'}}>{rec.Cmin.toFixed(1)} mg/L</span></div>
          </div>
          {state.patient.mode==='HD'&&(
            <div style={{marginTop:'10px',padding:'8px 12px',background:'rgba(0,212,255,0.07)',borderRadius:'6px',fontSize:'12px',color:'#00d4ff'}}>
              HD monitoring: Target pre-dialysis concentration 15–20 mg/L. Dose after each HD session. Monitor weekly minimum.
            </div>
          )}
          {state.patient.mic>1&&(
            <div style={{marginTop:'10px',padding:'8px 12px',background:'rgba(255,71,87,0.08)',borderRadius:'6px',fontSize:'12px',color:'#ff4757'}}>
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
              <div style={{fontWeight:'700',color:aki.stage>=2?'#ff4757':'#f59e0b'}}>KDIGO AKI Stage {aki.stage}</div>
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
          <span>— Current</span><span style={{color:'#a78bfa'}}>- - Recommended</span><span style={{color:'#f59e0b'}}>● Observed</span>
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
                  <tr key={p} style={{borderTop:'1px solid #1e293b'}}>
                    <td style={{padding:'8px 0',color:'#94a3b8',fontFamily:'monospace'}}>{p}</td>
                    <td style={{textAlign:'right',padding:'8px 0',fontFamily:'monospace',color:'#64748b'}}>{pr.toFixed(3)}</td>
                    <td style={{textAlign:'right',padding:'8px 0',fontFamily:'monospace',color:'#00d4ff',fontWeight:'600'}}>{po.toFixed(3)}</td>
                    <td style={{textAlign:'right',padding:'8px 0',fontFamily:'monospace',color:Math.abs(delta)>15?'#f59e0b':'#64748b',fontSize:'12px'}}>{delta>0?'+':''}{delta.toFixed(0)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{fontSize:'11px',color:'#334155',textAlign:'center',padding:'8px',borderTop:'1px solid #1e293b'}}>
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
      color:'#00d4ff',
    },
    {
      name:'Linezolid',evidence:'A-I (SSTI/HAP); B-II (bacteremia)',
      dose:'600 mg IV/PO q12h (same dose — 100% oral bioavailability)',
      renal:'No renal dose adjustment needed.',
      monitor:'CBC weekly (thrombocytopenia). Screen serotonergic drugs. Lactic acid if prolonged.',
      contraindicated:p.infection_type==='endocarditis',
      contraindText:'Avoid for endocarditis — bacteriostatic, insufficient for high inoculum',
      bestFor:['pneumonia','osteomyelitis','ssti','cns'],
      color:'#00e5a0',
    },
    {
      name:'Ceftaroline (5th-gen cephalosporin)',evidence:'A-I (SSTI/CAP); B-II (salvage bacteremia)',
      dose:'600 mg q8h (serious BSI/MRSA); 600 mg q12h (SSTI/CAP)',
      renal:'CrCl 30–50: 400 mg q8h. CrCl 15–30: 300 mg q8h. HD: 200 mg q8h.',
      monitor:'Standard β-lactam safety. CBC (rare hemolytic anemia).',
      bestFor:['bacteremia','ssti'],
      color:'#a78bfa',
    },
    {
      name:'Dapto + Ceftaroline (Combination)',evidence:'B-II',
      dose:'Daptomycin 8–10 mg/kg q24h + Ceftaroline 600 mg q8h',
      renal:'Adjust each agent individually per CrCl.',
      monitor:'CPK weekly + standard ceftaroline monitoring.',
      bestFor:['bacteremia','endocarditis'],
      indication:'Persistent bacteremia ≥5 days; VISA/hVISA; vancomycin failure',
      color:'#f59e0b',
    },
  ];

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'16px'}}>
      {showTrigger&&(
        <div style={{...S.card,borderColor:'#f59e0b40',background:'rgba(245,158,11,0.05)'}}>
          <div style={{display:'flex',gap:'10px',alignItems:'center'}}>
            <span style={{fontSize:'20px'}}>⚠</span>
            <div>
              <div style={{fontWeight:'700',color:'#f59e0b'}}>Alternative Therapy Consideration Triggered</div>
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
            <div style={{padding:'6px 10px',background:'rgba(255,71,87,0.1)',borderRadius:'6px',fontSize:'12px',color:'#ff4757',marginBottom:'8px'}}>
              {a.contraindText}
            </div>
          )}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px',fontSize:'12px'}}>
            <div><span style={S.muted}>Dose: </span>{a.dose}</div>
            <div><span style={S.muted}>Renal: </span>{a.renal}</div>
            <div style={{gridColumn:'1/-1'}}><span style={S.muted}>Monitor: </span>{a.monitor}</div>
          </div>
        </div>
      ))}
      <div style={{...S.card,background:'#0d1424',fontSize:'12px',color:'#64748b'}}>
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
function HistoryPanel({state}) {
  const encs=state.encounters;
  if(!encs.length) return (
    <div style={{...S.card,textAlign:'center',padding:'48px',color:'#64748b'}}>
      No encounter history yet. Run calculations to populate.
    </div>
  );

  const chartData=encs.map((e,i)=>({
    encounter:i+1,
    auc:e.auc24?+e.auc24.toFixed(0):null,
    dose:e.doses?.[e.doses.length-1]?.dose_mg,
    aki:e.aki?.stage||0,
    ts:e.timestamp,
  })).filter(d=>d.auc);

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'16px'}}>
      {chartData.length>1&&(
        <div style={S.card}>
          <div style={{...S.h3,marginBottom:'12px'}}>AUC₂₄ Trend</div>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={chartData} margin={{top:10,right:20,left:0,bottom:0}}>
              <CartesianGrid strokeDasharray="3,3" stroke="#1e293b"/>
              <XAxis dataKey="encounter" stroke="#475569" tick={{fill:'#475569',fontSize:11}}/>
              <YAxis stroke="#475569" tick={{fill:'#475569',fontSize:11}} domain={[0,900]}/>
              <Tooltip contentStyle={{background:'#111827',border:'1px solid #334155',borderRadius:'8px',fontSize:'12px'}}/>
              <ReferenceLine y={400} stroke="#00e5a0" strokeDasharray="4,4" label={{value:'400',fill:'#00e5a080',fontSize:10}}/>
              <ReferenceLine y={600} stroke="#f59e0b" strokeDasharray="4,4" label={{value:'600',fill:'#f59e0b80',fontSize:10}}/>
              <Line type="monotone" dataKey="auc" stroke="#00d4ff" strokeWidth={2} dot={{r:4,fill:'#00d4ff'}} name="AUC₂₄"/>
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div style={S.card}>
        <div style={{...S.h3,marginBottom:'12px'}}>Encounter Log</div>
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',fontSize:'12px',borderCollapse:'collapse',whiteSpace:'nowrap'}}>
            <thead>
              <tr style={{color:'#64748b',fontSize:'11px',textTransform:'uppercase',borderBottom:'1px solid #1e293b'}}>
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
                const sc={Therapeutic:'#00e5a0',Subtherapeutic:'#ff4757',Supratherapeutic:'#f59e0b','-':'#64748b'};
                return (
                  <tr key={e.id} style={{borderBottom:'1px solid #0d1424'}}>
                    <td style={{padding:'8px',color:'#64748b'}}>{i+1}</td>
                    <td style={{padding:'8px',color:'#64748b',fontSize:'11px',fontFamily:'monospace'}}>{new Date(e.timestamp).toLocaleDateString()}</td>
                    <td style={{padding:'8px',fontFamily:'monospace',color:'#94a3b8'}}>{d?`${d.dose_mg}mg q${d.tau_h}h`:'-'}</td>
                    <td style={{padding:'8px',fontFamily:'monospace',color:sc[status]||'#64748b'}}>{auc||'-'}</td>
                    <td style={{padding:'8px',fontFamily:'monospace',color:'#a78bfa'}}>{e.pk?.ke?.toFixed(4)||'-'}</td>
                    <td style={{padding:'8px',fontFamily:'monospace',color:'#a78bfa'}}>{e.pk?.t_half?.toFixed(1)||'-'}</td>
                    <td style={{padding:'8px',color:e.aki?.stage>0?'#ff4757':'#64748b'}}>{e.aki?.stage>0?`Stage ${e.aki.stage}`:'-'}</td>
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
// MAIN APP
// ═══════════════════════════════════════════════════════════
export default function AinaDaraCalc() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const {ui, patient, alerts} = state;

  // Load fonts
  useEffect(()=>{
    const link=document.createElement('link');
    link.rel='stylesheet';
    link.href='https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700;800&family=DM+Mono:wght@400;500;600&display=swap';
    document.head.appendChild(link);
  },[]);

  const tabs=[
    {id:'patient',label:'Patient',icon:'👤'},
    {id:'dosing',label:'Dosing',icon:'💊'},
    {id:'results',label:'Results',icon:'📊'},
    {id:'history',label:'History',icon:'📋'},
    {id:'alternatives',label:'Alternatives',icon:'⚕'},
  ];

  const modeColors={standard:'#00d4ff',obese:'#f59e0b',HD:'#a78bfa',CRRT:'#00e5a0',AKI:'#ff4757',neonatal:'#f97316',pediatric:'#06b6d4',CI:'#8b5cf6'};
  const modeColor=modeColors[patient.mode]||'#00d4ff';

  return (
    <div style={S.app}>
      {/* Header */}
      <div style={{
        background:'linear-gradient(180deg,#111827 0%,#0d1424 100%)',
        borderBottom:'1px solid #1e293b',
        padding:'0 24px',
        position:'sticky',top:0,zIndex:100,
      }}>
        <div style={{maxWidth:'1200px',margin:'0 auto',display:'flex',alignItems:'center',gap:'16px',height:'56px'}}>
          <div style={{display:'flex',alignItems:'center',gap:'10px',flex:1}}>
            <div style={{
              width:'32px',height:'32px',borderRadius:'8px',
              background:`linear-gradient(135deg,${modeColor},${modeColor}80)`,
              display:'flex',alignItems:'center',justifyContent:'center',
              fontSize:'16px',fontWeight:'800',color:'#0a0f1e',
            }}>⚕</div>
            <div>
              <div style={{fontSize:'14px',fontWeight:'800',color:'#f1f5f9',letterSpacing:'-0.01em'}}>AinaDara Calc</div>
              <div style={{fontSize:'10px',color:'#475569',letterSpacing:'0.04em',textTransform:'uppercase'}}>TDM Suite</div>
            </div>
          </div>
          {/* Mode badge */}
          <div style={{
            fontSize:'11px',padding:'4px 10px',borderRadius:'20px',fontWeight:'700',
            background:`${modeColor}20`,color:modeColor,border:`1px solid ${modeColor}40`,
          }}>{patient.mode.toUpperCase()}</div>
          {patient.name&&<div style={{fontSize:'13px',color:'#64748b',maxWidth:'120px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{patient.name}</div>}
          {patient.crcl&&<div style={{fontSize:'12px',color:'#64748b',fontFamily:'monospace'}}>CrCl {patient.crcl.toFixed(0)}</div>}
          {/* Alert count */}
          {alerts.filter(a=>a.level==='DANGER').length>0&&(
            <div style={{background:'#ff4757',color:'white',fontSize:'11px',fontWeight:'700',borderRadius:'12px',padding:'2px 8px'}}>
              {alerts.filter(a=>a.level==='DANGER').length} DANGER
            </div>
          )}
        </div>
        {/* Tabs */}
        <div style={{maxWidth:'1200px',margin:'0 auto',display:'flex',gap:'0',borderTop:'1px solid #1e293b'}}>
          {tabs.map(t=>(
            <button key={t.id} onClick={()=>dispatch({type:'SET_UI',payload:{activeTab:t.id}})} style={{
              padding:'10px 20px',background:'none',border:'none',
              color:ui.activeTab===t.id?modeColor:'#64748b',
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
        {ui.activeTab==='history'&&<HistoryPanel state={state}/>}
        {ui.activeTab==='alternatives'&&<AlternativesPanel state={state}/>}
      </div>

      {/* Footer */}
      <div style={{
        borderTop:'1px solid #0d1424',
        padding:'12px 24px',
        fontSize:'11px',
        color:'#334155',
        textAlign:'center',
        marginTop:'20px',
      }}>
        AinaDara Calc | Therapeutic Drug Monitoring Suite | Based on 2020 ASHP/IDSA/PIDS/SIDP Vancomycin Consensus Guidelines
        <br/>
        <strong style={{color:'#475569'}}>FOR CLINICAL DECISION SUPPORT ONLY. All recommendations require qualified pharmacist/physician review before implementation.</strong>
      </div>
    </div>
  );
}
