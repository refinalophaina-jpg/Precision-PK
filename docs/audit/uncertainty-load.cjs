'use strict';
const fs=require('fs'), vm=require('vm');
const W=require('path').join(__dirname,'..','..');
const html=fs.readFileSync(W+'/index.html','utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
function makeEl(){return{value:'',textContent:'',innerHTML:'',style:{display:''},checked:false,
 classList:{toggle:()=>{},add:()=>{},remove:()=>{},contains:()=>false},querySelectorAll:()=>[],querySelector:()=>null,
 getAttribute:()=>null,setAttribute:()=>{},addEventListener:()=>{},appendChild:()=>{},removeChild:()=>{}};}
const sb={document:{getElementById:()=>makeEl(),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>makeEl()},
 window:{},alert:()=>{},requestAnimationFrame:()=>{},console,Math,parseFloat,parseInt,isNaN,isFinite,NaN,Infinity,
 Object,Array,String,Number,Boolean,Function,Date,Error,TypeError,JSON,RegExp,
 bState:{sex:'M',model:'buelga',dial:false,result:null,tinkCompare:[]}};
sb.window=sb; vm.runInNewContext(script,sb);
const C=require(W+'/harness_constants.cjs').extract();
const num=(n)=>{const m=html.match(new RegExp('const\\s+'+n+'\\s*=\\s*([0-9.eE+-]+)'));if(!m)throw new Error(n);return +m[1];};
['OMEGA2_CL_HUGHES','OMEGA2_VC_HUGHES','OMEGA2_VP_HUGHES','SIGMA_PROP_HUGHES','SIGMA_ADD_HUGHES'].forEach(k=>C[k]=num(k));
let seed=12345;
const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return Math.max(seed/0x7fffffff,1e-12);};
const randn=()=>Math.sqrt(-2*Math.log(rnd()))*Math.cos(2*Math.PI*rnd());
const setSeed=s=>{seed=s;};
const pct=(a,p)=>{const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.floor(p*s.length))];};
module.exports={sb,C,rnd,randn,setSeed,pct,html,W};
