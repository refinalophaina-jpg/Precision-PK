'use strict';
// Goti SCr-truncation threshold: code says age>65, Goti 2018 p.471 says age>60.
// Quantify the affected band (61-65 y with SCr<1.0).
const f=(x,d=1)=>x.toFixed(d);
const cg=(age,wt,scr,mult)=>(140-age)*wt*mult/(72*scr);
const tvcl=(crcl)=>4.5*Math.pow(Math.min(crcl,150)/120,0.8);
console.log('  Patients in the affected band: age 61-65, SCr < 1.0 mg/dL\n');
console.log('  age  sex  wt   SCr   CrCl(code)  CrCl(paper)   TVCL code  TVCL paper   dose impact');
for (const [age,sex,wt,scr] of [[62,'M',80,0.7],[64,'M',80,0.9],[61,'F',65,0.6],[65,'M',90,0.8],[63,'F',70,0.5]]) {
  const mult = sex==='M'?1:0.85;
  const cCode = Math.max(5,Math.min(150,cg(age,wt,scr,mult)));           // no truncation (age<=65)
  const cPaper= Math.max(5,Math.min(150,cg(age,wt,Math.max(scr,1.0),mult))); // truncated (age>60)
  const a=tvcl(cCode), b=tvcl(cPaper);
  console.log(`  ${age}   ${sex}   ${wt}  ${scr.toFixed(1)}   ${f(cCode).padStart(8)}   ${f(cPaper).padStart(9)}   ${f(a,2).padStart(8)}   ${f(b,2).padStart(8)}    +${f((a/b-1)*100)}%`);
}
console.log('\n  A higher prior CL means a proportionally higher recommended dose for the');
console.log('  same AUC target (dose = AUC24 x CL / (24/tau)). Age 66+ and age <=60 are');
console.log('  unaffected; the discrepancy is confined to the 61-65 band with SCr < 1.0.');
