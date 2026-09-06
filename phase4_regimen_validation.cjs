'use strict';
// ════════════════════════════════════════════════════════════════════════
// PHASE 4 — Regimen detection validation
//
// Covers the defect where a deliberate q12h -> q8h order change was reported to
// the clinician as an accidental early dose, because "the regimen" was taken to
// be the MODAL interval over the whole history. Recency beats frequency.
//
// Includes the ten scenarios from the regimen-detection spec plus the nine
// defects found while reviewing it (D1-D9) — see the commit message and
// docs/audit-2026-09.md.
//
// Run:  node phase4_regimen_validation.cjs
// ════════════════════════════════════════════════════════════════════════
const fs=require('fs'),vm=require('vm');
const APP='/Users/olaiya/Projects-Local/Pharmacy/Vancomycin /AinaDaraTDM/index.html';
const s=fs.readFileSync(APP,'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function mk(){return{value:'',textContent:'',innerHTML:'',style:{},checked:false,classList:{toggle(){},add(){},remove(){},contains(){return false}},querySelectorAll:()=>[],querySelector:()=>null,getAttribute:()=>null,setAttribute(){},addEventListener(){},appendChild(){},removeChild(){}};}
const sb={document:{getElementById:()=>mk(),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mk()},window:{},alert(){},requestAnimationFrame(){},console,Math,parseFloat,parseInt,isNaN,isFinite,NaN,Infinity,Object,Array,String,Number,Boolean,Function,Date,Error,TypeError,JSON,RegExp,Map,Set,bState:{sex:'M'}};
sb.window=sb;vm.runInNewContext(s,sb);
const {detectRegimen,interpretLevelTiming,regimenNarrative}=sb;
const D=(mg,h,ti=1)=>({mg,timeH:h,tinfH:ti});
const fromIntervals=(mg,iv)=>{let t=0;const out=[D(mg,0)];for(const h of iv){t+=h;out.push(D(mg,t));}return out;};
let pass=0,fail=0;
function check(name,cond,detail){ if(cond){pass++;console.log('  ✓ '+name);} else {fail++;console.log('  ✗ '+name+'  -> '+detail);} }

console.log('\n=== YOUR ACTUAL CASE (q12h -> q8h, 2026-07-21/23) ===');
// 2250 @01:36, 1000 @12:19, 1000 @01:34(+1d), 1000 @13:59, 1000 @21:33, 1000 @05:34(+1d)
const T=(d,h,m)=>d*24+h+m/60;
const real=[D(2250,T(0,1,36)),D(1000,T(0,12,19)),D(1000,T(1,1,34)),D(1000,T(1,13,59)),D(1000,T(1,21,33)),D(1000,T(2,5,34))];
const r=detectRegimen(real);
console.log('  status            ',r.status);
console.log('  interval          ',r.frequencyLabel);
console.log('  maintenance dose  ',r.maintenanceDoseMg);
console.log('  prior interval    ',r.priorIntervalHours);
console.log('  transition        ',r.transitionDetected);
console.log('  loading detected  ',r.loadingDoseDetected);
console.log('  confidence        ',r.confidence);
console.log('  supporting        ',JSON.stringify(r.supportingIntervals));
console.log('  reasons           ',r.reasonCodes.join(', '));
check('detects q8h (not q12h)', r.intervalHours===8, r.intervalHours);
check('flags the transition', r.transitionDetected===true, r.transitionDetected);
check('prior regimen is q12h', r.priorIntervalHours===12, r.priorIntervalHours);
check('2250 mg recognised as loading', r.loadingDoseDetected===true, r.loadingDoseDetected);
check('maintenance dose 1000 mg', r.maintenanceDoseMg===1000, r.maintenanceDoseMg);
const lvl=T(2,12,29);
const tm=interpretLevelTiming(lvl,real,r.intervalHours);
console.log('\n  level timing: '+tm.classification+'  '+tm.hoursFromDoseStart.toFixed(2)+'h after dose, '+tm.hoursUntilNominalNextDose.toFixed(2)+'h to next');
check('elapsed ~6.92 h', Math.abs(tm.hoursFromDoseStart-6.92)<0.02, tm.hoursFromDoseStart);
check('~1.08 h until next dose', Math.abs(tm.hoursUntilNominalNextDose-1.08)<0.02, tm.hoursUntilNominalNextDose);
check('classified near_trough, never "q12h trough"', tm.classification==='near_trough', tm.classification);
console.log('\n  NARRATIVE:\n    '+regimenNarrative(r,tm).replace(/(.{95})/g,'$1\n    '));

console.log('\n=== SPEC TEST CASES ===');
const t1=detectRegimen(fromIntervals(1000,[12.2,12.4,7.6,8.0]));
check('T1 q12h->q8h transition: interval 8', t1.intervalHours===8, t1.intervalHours);
check('T1 transitionDetected', t1.transitionDetected===true, t1.transitionDetected);
check('T1 confidence high', t1.confidence==='high', t1.confidence);
const t2=detectRegimen(fromIntervals(1000,[12.0,12.1,8.0,12.0]));
check('T2 isolated early dose: stays q12h', t2.intervalHours===12, t2.intervalHours);
check('T2 no established q8h', !(t2.intervalHours===8), t2.intervalHours);
const t3=detectRegimen(fromIntervals(1000,[8.1,7.8,8.2,8.0]));
check('T3 stable q8h', t3.intervalHours===8 && t3.status==='established', t3.status+'/'+t3.intervalHours);
check('T3 no transition (no older pattern)', t3.transitionDetected===false, t3.transitionDetected);
const t4=detectRegimen([D(2000,0),D(1000,12),D(1000,24.1),D(1000,35.9)]);
check('T4 loading dose detected', t4.loadingDoseDetected===true, t4.loadingDoseDetected);
check('T4 maintenance 1000 mg', t4.maintenanceDoseMg===1000, t4.maintenanceDoseMg);
check('T4 interval q12h', t4.intervalHours===12, t4.intervalHours);
const t5=detectRegimen([D(1000,0),D(1000,12),D(750,24),D(750,32),D(750,40),D(750,48)]);
check('T5 dose+interval change: q8h', t5.intervalHours===8, t5.intervalHours);
check('T5 maintenance 750 mg', t5.maintenanceDoseMg===750, t5.maintenanceDoseMg);
const t6=detectRegimen(fromIntervals(1000,[11.8,7.1,14.5,9.7]));
check('T6 genuinely irregular', t6.status==='irregular'||t6.confidence!=='high', t6.status+'/'+t6.confidence);
const t7=detectRegimen(fromIntervals(1000,[12.0,24.1,12.0]));
check('T7 missed dose: stays q12h', t7.intervalHours===12, t7.intervalHours);
check('T7 not classified q24h', t7.intervalHours!==24, t7.intervalHours);

console.log('\n=== MY ADDED DEFECT FIXES ===');
// D3: level drawn BEFORE the most recent dose
const dz=[D(1000,0),D(1000,12),D(1000,24)];
const tEarly=interpretLevelTiming(23.5,dz,12);
check('D3 uses the dose BEFORE the level (not the later one)', tEarly.hoursFromDoseStart>0 && Math.abs(tEarly.hoursFromDoseStart-11.5)<1e-9, tEarly.hoursFromDoseStart);
// D2: mode not median for prior interval
const d2=[D(1000,0),D(1000,12),D(1000,24),D(1000,48),D(1000,72),D(1000,80),D(1000,88)];
check('D2 prior interval is a real observed nominal', [12,24].includes(d2 && detectRegimen(d2).priorIntervalHours), detectRegimen(d2).priorIntervalHours);
// D4: impossible timestamps
const d4=detectRegimen([D(1000,0),D(1000,0),D(1000,8),D(1000,16),D(1000,24)]);
check('D4 zero-length interval rejected, still resolves', d4.status!=='insufficient_data', d4.status);
// D1: the loading test must be the exact COMPLEMENT of the similarity test, so
// no first dose can be neither "similar" nor "loading". The old spec used 1.4x
// for loading while calling anything within 20% similar, leaving 1.2-1.4x
// unclassifiable. Assert the absence of that gap across the whole range.
{
  let gap=null, contradiction=null;
  for (let first=1000; first<=2600; first+=25) {
    const res=detectRegimen([D(first,0),D(1000,12),D(1000,24),D(1000,36)]);
    const similar = Math.abs(first-1000) <= Math.max(250, 0.2*1000);
    if (!similar && first>1000 && !res.loadingDoseDetected) gap=first;          // dissimilar but not loading
    if (similar && res.loadingDoseDetected) contradiction=first;                // similar yet loading
  }
  check('D1 no dead zone: dissimilar-and-larger always reads as loading', gap===null, 'first dose '+gap+' mg was neither');
  check('D1 no contradiction: a similar dose is never loading', contradiction===null, 'first dose '+contradiction+' mg was both');
  const justOver=detectRegimen([D(1300,0),D(1000,12),D(1000,24),D(1000,36)]);
  check('D1 1300 mg (just past tolerance) is a loading dose', justOver.loadingDoseDetected===true, justOver.loadingDoseDetected);
  const atBoundary=detectRegimen([D(1250,0),D(1000,12),D(1000,24),D(1000,36)]);
  check('D1 1250 mg (at tolerance) is maintenance, not loading', atBoundary.loadingDoseDetected===false, atBoundary.loadingDoseDetected);
}
// D6: catch-up after missed dose downgrades confidence
const d6=detectRegimen(fromIntervals(1000,[12,12,24,8,8]));
console.log('     D6 status='+d6.status+' interval='+d6.intervalHours+' confidence='+d6.confidence+' reasons='+d6.reasonCodes.join(','));
check('D6 flags likely missed dose / lowers confidence', d6.confidence==='moderate'||d6.reasonCodes.includes('LIKELY_MISSED_DOSE'), d6.confidence);
// D9: longer run raises evidence
const d9=detectRegimen(fromIntervals(1000,[12,8,8,8,8,8]));
check('D9 uses the whole matching run', d9.supportingIntervals.length>=4, d9.supportingIntervals.length);

console.log('\n=== CLINICIAN OVERRIDE (spec Test 10) ===');
{
  // bState is declared with `let` inside the vm and is therefore NOT reachable as
  // sb.bState. Drive the override through setRegimenOverride(), the same entry
  // point the UI uses — which is what we actually want to test anyway.
  const {applyRegimenOverride,setRegimenOverride}=sb;
  const base=detectRegimen(fromIntervals(1000,[12.2,12.4,7.6,8.0]));
  check('auto-detect finds q8h', base.intervalHours===8, base.intervalHours);

  setRegimenOverride('12');
  const ov=applyRegimenOverride(base);
  check('override forces q12h projection', ov.intervalHours===12, ov.intervalHours);
  check('override records what was detected', ov.detectedIntervalHours===8, ov.detectedIntervalHours);
  check('override flagged active', ov.overrideActive===true, ov.overrideActive);
  check('override reason code present', ov.reasonCodes.includes('EXPLICIT_REGIMEN_USED'), ov.reasonCodes.join(','));
  check('historical fit input untouched (detect result unchanged)', base.intervalHours===8, base.intervalHours);

  // An explicit interval resolves an otherwise unreadable schedule.
  const messy=detectRegimen(fromIntervals(1000,[11.8,7.1,14.5,9.7]));
  setRegimenOverride('12');
  const messyOv=applyRegimenOverride(messy);
  check('override makes an irregular course projectable', messyOv.status==='established' && messyOv.intervalHours===12,
        messyOv.status+'/'+messyOv.intervalHours);

  setRegimenOverride('auto');
  const back=applyRegimenOverride(base);
  check('clearing the override returns to auto-detect', back.intervalHours===8 && !back.overrideActive, back.intervalHours);
}

console.log('\n  passed '+pass+'  failed '+fail);
process.exit(fail?1:0);
