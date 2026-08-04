// dashboard.js - Live Streaming Management v2
const UP='#ef4444',DOWN='#22c55e';

function dash(){return{
loading:false,lastUpdate:'',error:'',
toast:{show:false,msg:'',type:'info'},
_poll:null,_lastTs:0,

// Live state
isLive:false,currentAnchor:'',currentShiftLabel:'',
// Shifts
shifts:[],shiftCount:0,
// KPI
kpi:{totalSpend:0,liveSpend:0,videoSpend:0,totalLeads:0,totalConversions:0,avgCpl:0,liveCpl:0,videoCpl:0,privateMsg:0,dailyBudget:45000,aiRegionsSpend:0},
// Account cards
accountCards:[],
// Push log
pushLog:[],
// Shift data table
shiftData:[],

get todayLabel(){
  const d=new Date();
  return d.getFullYear()+'年'+(d.getMonth()+1)+'月'+d.getDate()+'日';
},
get weekdayLabel(){
  const days=['周日','周一','周二','周三','周四','周五','周六'];
  return days[new Date().getDay()];
},
get budgetPct(){
  return this.kpi.dailyBudget>0?Math.round(this.kpi.totalSpend/this.kpi.dailyBudget*100):0;
},
get aiRegionsSummary(){
  const regions=['东区','西区','中区','南区','北区'];
  return regions.join(' · ');
},

init(){
  this.loadData();
  this._poll=setInterval(()=>this.loadData(),30000);
  this._onKeydown=e=>{if(e.key==='r'&&!e.ctrlKey&&!e.metaKey&&e.target===document.body){e.preventDefault();this.loadData()}};
  document.addEventListener('keydown',this._onKeydown);
},

destroy(){if(this._poll)clearInterval(this._poll);if(this._onKeydown)document.removeEventListener('keydown',this._onKeydown)},

async loadData(){
  this.loading=true;this.error='';
  try{
    const res=await Promise.allSettled([
      fetch('/api/live-status',{cache:'no-store'}).then(r=>r.ok?r.json():null),
      fetch('/api/snapshots',{cache:'no-store'}).then(r=>r.ok?r.json():null),
    ]);
    if(res[0].status==='fulfilled'&&res[0].value){
      const d=res[0].value;
      this.isLive=d.isLive||false;
      this.currentAnchor=d.currentAnchor||'';
      this.shifts=d.shifts||[];
      this.shiftCount=this.shifts.length;
      this.shiftData=d.shiftData||[];
      this.pushLog=d.pushLog||[];
      this.accountCards=d.accounts||[];
      if(d.kpi)this.kpi={...this.kpi,...d.kpi};
      this.currentShiftLabel=this._currentShiftLabel();
    }
    if(res[1].status==='fulfilled'&&res[1].value){
      const s=res[1].value;
      if(s.summary||s.totalSpend!==undefined){
        this.kpi.totalSpend=s.totalSpend||s.summary?.totalSpend||0;
        this.kpi.totalLeads=s.totalLeads||s.summary?.totalLeads||0;
        this.kpi.avgCpl=s.avgCpl||s.summary?.avgCpa||0;
      }
    }
    this.lastUpdate=new Date().toLocaleTimeString('zh-CN');
    this._lastTs=Date.now();
  }catch(e){this.error=e.message||'加载失败'}finally{this.loading=false}
},

_currentShiftLabel(){
  const now=new Date();
  const hm=now.getHours()*60+now.getMinutes();
  for(const s of this.shifts){
    const[sh,sm]=s.start.split(':').map(Number);
    const[eh,em]=s.end.split(':').map(Number);
    const smin=sh*60+sm,emin=eh*60+em;
    if(hm>=smin&&hm<emin)return s.anchor+' 直播中 · '+s.start+'-'+s.end;
  }
  if(this.shifts.length>0){
    const last=this.shifts[this.shifts.length-1];
    const[eh,em]=last.end.split(':').map(Number);
    if(hm>=eh*60+em)return '今日直播已结束';
  }
  return '';
},

barWidth(s){
  const[sh,sm]=s.start.split(':').map(Number);
  const[eh,em]=s.end.split(':').map(Number);
  const dur=eh*60+em-sh*60-sm;
  const maxDur=this.shifts.reduce((m,x)=>{
    const[xsh,xsm]=x.start.split(':').map(Number);
    const[xeh,xem]=x.end.split(':').map(Number);
    return Math.max(m,xeh*60+xem-xsh*60-xsm);
  },120);
  return Math.round(dur/maxDur*100);
},

async manualPush(){
  this.toastShow('正在触发手动推送...','info');
  try{
    const r=await fetch('/api/manual-push',{method:'POST',headers:{'Content-Type':'application/json'}});
    const d=await r.json();
    if(d.ok)this.toastShow('推送指令已入队','success');
    else this.toastShow('推送失败: '+(d.error||''),'error');
  }catch(e){this.toastShow('推送失败: '+e.message,'error')}
},

fmtMoney(v){const n=Number(v)||0;return '\xA5'+n.toLocaleString('zh-CN',{maximumFractionDigits:2})},
fmtNum(v){const n=Number(v)||0;return n.toLocaleString('zh-CN',{maximumFractionDigits:0})},

toastShow(msg,type='info'){
  this.toast={show:true,msg,type};
  clearTimeout(this._tt);
  this._tt=setTimeout(()=>{this.toast.show=false},3000);
},
};}
window.dash=dash;
