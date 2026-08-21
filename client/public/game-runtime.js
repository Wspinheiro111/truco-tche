const SFX = window.SFX || { click(){}, card(){}, truco(){}, reveal(){}, win(){}, lose(){}, unlock(){}, deal(){}, envido(){}, flor(){} };
window.SFX = SFX;

// ═══════════════════════════════════════════════════════════════════════════════
// CONSOLIDATED SCRIPT - All game logic in one place to avoid redeclaration errors
// ═══════════════════════════════════════════════════════════════════════════════
// ── Variáveis globais (declaradas aqui para evitar ReferenceError entre scripts)
var sio = null;
var AUTH = { user: null, session: null }; // global auth state
var localUser = null; // será sobrescrito pela IIFE de auth
try { localUser = JSON.parse(localStorage.getItem('truco_local_user') || 'null'); } catch(e) {}
window.localUser = localUser;
var trpcMutation = async function(path, input) {
  const body = input !== undefined ? JSON.stringify({ json: input }) : JSON.stringify({ json: {} });
  const res = await fetch('/api/trpc/' + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
    body
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'tRPC error');
  return data.result?.data?.json ?? data.result?.data;
};
var trpcQuery = async function(path, input) {
  const q = input !== undefined ? '?input=' + encodeURIComponent(JSON.stringify({ json: input })) : '';
  const res = await fetch('/api/trpc/' + path + q, { credentials: 'include' });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'tRPC error');
  return data.result?.data?.json ?? data.result?.data;
};
var sioConnected = false;
var sioRoom = '';
var sioRole = '';
var sioOpponentName = '';
var sioMyName = '';
var sioInQueue = false;
var sioGameState = null;
var sioGameActive = false;
// ══════════ CARD IMAGES ══════════
const CARD_IMGS = window.__TRUCO_CARD_IMGS || { Ouros: {}, Bastos: {}, Espadas: {}, Copas: {} };
const TT_C = CARD_IMGS;
function cimg(c){ return CARD_IMGS[c.suit]?.[c.rank] || ''; }

// ══════════════════════════════════════════════════════════════
//  PROFILE & STATS
// ══════════════════════════════════════════════════════════════
const DEFAULT_P = {name:'Peão',wins:0,losses:0,games:0,xp:0,coins:0,unlocked:['gauchao','prenda'],streak:0,bestStreak:0,charStats:{}};
let TT_P = {...DEFAULT_P};
function loadP(){try{const s=localStorage.getItem('truco_P5');if(s)TT_P={...DEFAULT_P,...JSON.parse(s)};}catch(e){}}
function saveP(){try{localStorage.setItem('truco_P5',JSON.stringify(TT_P));}catch(e){}}
function lvlOf(xp){let l=1;while(300*l*l<=xp)l++;return l;}
function xpFor(l){return 300*l*l}
function addCharStat(charId, won){
  if(!TT_P.charStats[charId])TT_P.charStats[charId]={wins:0,losses:0};
  if(won)TT_P.charStats[charId].wins++;else TT_P.charStats[charId].losses++;
}

// ══════════════════════════════════════════════════════════════
//  THEME
// ══════════════════════════════════════════════════════════════
let darkMode = localStorage.getItem('truco_dark')==='1';
function applyTheme(){document.body.classList.toggle('dark',darkMode);}
function toggleTheme(){darkMode=!darkMode;localStorage.setItem('truco_dark',darkMode?'1':'0');applyTheme();SFX.click();}

// ══════════════════════════════════════════════════════════════
//  TIMER
// ══════════════════════════════════════════════════════════════
let timerInt=null, timerSec=0, timerMax=30;
function startTimer(){
  clearInterval(timerInt);
  timerSec=timerMax;
  updateTimer();
  timerInt=setInterval(()=>{
    timerSec--;
    updateTimer();
    if(timerSec<=0){clearInterval(timerInt);autoPlay();}
  },1000);
}
function stopTimer(){clearInterval(timerInt);document.getElementById('timer-fill').style.width='100%';document.getElementById('timer-fill').className='timer-fill';}
function updateTimer(){
  const pct=timerSec/timerMax*100;
  const el=document.getElementById('timer-fill');
  el.style.width=pct+'%';
  if(pct<20)el.className='timer-fill danger';
  else if(pct<45)el.className='timer-fill warn';
  else el.className='timer-fill';
}
function autoPlay(){
  // Auto-fold or play weakest card if timer runs out
  if(TT_G.phase==='playing'&&TT_G.turn==='hu'&&TT_G.pHand.length){
    toast('Tempo esgotado! Carta automática.','lose');
    humanPlay(0);
  }
}

// ══════════════════════════════════════════════════════════════
//  ONLINE (PeerJS)
// ══════════════════════════════════════════════════════════════

const QUICK_MSGS=['Boa mão!','Truco mesmo!','Bah!','Sorte!','Vai custar!','Mão boa!','😂','🤠','🎯'];

function applyNetMove(data){
  // Apply opponent's move in online game
  if(data.action==='play_card'){
    const card=TT_G.aiHand.find(c=>c.id===data.cardId)||TT_G.aiHand[0];
    if(card)aiPlay(card);
  }else if(data.action==='truco'){
    aiCallTruco();
  }else if(data.action==='envido'){
    const {action:act,bet}=data;
    TT_G.envChain.push(act);TT_G.envBet=bet;
    TT_G.envChal='ai';TT_G.lastEnvChal='ai';TT_G.turn='hu';TT_G.phase='envido_neg';
    showEnvidoChallenge(act,bet);
  }else if(data.action==='accept_truco'){
    closeModal('m-truco');
    const nt=TT_G.truChal;TT_G.phase='playing';TT_G.turn=nt;
    renderAll();setPh(nt==='hu'?'▶ Sua vez':'⏳ Bagual pensa...',nt==='hu'?'ph-play':'ph-wait');
    if(nt==='ai')setTimeout(()=>aiPlay(pickCard()),900);
  }else if(data.action==='refuse_truco'){
    closeModal('m-truco');
    const pts=TT_G.truLvl===2?1:TT_TP[TT_G.truLvl-1];TT_G.score.hu+=pts;
    renderScores();toast(`Adversário correu! Você +${pts} 🏆`,'win');
    if(TT_G.score.hu>=TT_G.target){endGame('hu');return;}
    setTimeout(deal,1200);
  }else if(data.action==='accept_envido'){
    resolveEnvido(true);
  }else if(data.action==='refuse_envido'){
    resolveEnvido(false);
  }
}



// ══ FUNÇÕES AUXILIARES CONSOLIDADAS ══

function aiPlay(card){
  if(!card||!TT_G.aiHand.length)return;
  // REGRA: nunca jogar 2 cartas na mesma rodada
  if(TT_G.table.some(t=>t.player==='ai'))return;
  SFX.card();
  const bks=document.getElementById('ai-bks');
  if(bks&&bks.children[0])bks.children[0].classList.add('fly');
  const idx=TT_G.aiHand.findIndex(c=>c.id===card.id);
  TT_G.aiHand.splice(idx<0?0:idx,1);
  // Replay recording
  if(!TT_G.replay)TT_G.replay=[];
  TT_G.replay.push({type:'card_played',data:{player:'ai',card,huCards:[...TT_G.pHand],aiCards:[...TT_G.aiHand]},ts:Date.now(),score:{...TT_G.score},rw:[...TT_G.rw]});
  TT_G.table.push({card,player:'ai'});TT_G.pfirst.ai=true;TT_G.turn='hu';
  renderAll();setPh('\u25b6 Sua vez','ph-play');startTimer();
  // Só resolve a rodada se o humano já jogou também
  if(TT_G.table.some(t=>t.player==='hu'))checkRound();
}

function bubbleSay(msg,thinking=false){
  const b=document.getElementById('bubble');
  if(!b)return;
  b.innerHTML=thinking
    ?'<span class="tdots"><span class="tdot"></span><span class="tdot"></span><span class="tdot"></span></span>'
    :('"'+msg+'"');
  // Voice synthesis
  if(!thinking&&msg&&TT_G.char&&CFG&&CFG.voice){
    setTimeout(()=>speak(msg.replace(/["""]/g,''),TT_G.char.id),200);
  }
}

function humanTruco(){
  if(TT_G.phase!=='playing'||TT_G.turn!=='hu')return;
  if(TT_G.lastTruChal==='hu'||TT_G.truLvl>=4)return;
  stopTimer();SFX.truco();
  trackStat('trucosCalled');
  const lvl=TT_G.truLvl+1;
  TT_G.phase='truco_neg';TT_G.truLvl=lvl;TT_G.truChal='hu';TT_G.lastTruChal='hu';TT_G.turn='ai';
  addHist('Você cantou '+TT_TN[lvl]+'!');
  setPh('🔥 '+TT_TN[lvl],'ph-truco');renderSideBtns();bubbleSay('',true);
  setTimeout(aiRespondTruco,aiDelay(1500));
}

function resolveEnvido(accept){
  closeModal('m-envido');
  // Track stats
  trackStat('envidoCalled');
  const myPts=TT_G.envPts&&TT_G.envPts.hu||0;
  if(TT_P.advStats){
    TT_P.advStats.avgEnvidoPts=((TT_P.advStats.avgEnvidoPts||0)*(TT_P.advStats.envidoCount||0)+myPts)/((TT_P.advStats.envidoCount||0)+1);
    TT_P.advStats.envidoCount=(TT_P.advStats.envidoCount||0)+1;
  }
  const nextPhase=TT_G.trucoPendEnv?'truco_neg':'playing';
  // Após envido, o mano joga primeiro (envido só é cantado antes de qualquer carta)
  const nextTurn=TT_G.trucoPendEnv?(TT_G.truChal==='hu'?'ai':'hu'):TT_G.handMano;
  if(accept){
    SFX.reveal();
    document.getElementById('pr-ai').textContent=TT_G.envPts.ai;
    document.getElementById('pr-hu').textContent=TT_G.envPts.hu;
    const winner=TT_G.envPts.hu>TT_G.envPts.ai?'hu':TT_G.envPts.ai>TT_G.envPts.hu?'ai':TT_G.handMano;
    document.getElementById('pr-hu-w').textContent=winner==='hu'?'✓ Vencedor!':'';
    document.getElementById('pr-ai-w').textContent=winner==='ai'?'✓ Vencedor!':'';
    document.getElementById('pts-reveal').classList.remove('hidden');
    setTimeout(()=>{
      document.getElementById('pts-reveal').classList.add('hidden');
      if(TT_G.phase==='game_over')return;
      TT_G.score[winner]+=TT_G.envBet;TT_G.envRes=true;
      if(winner==='hu')trackStat('envidoWins');else trackStat('envidoLosses');
      addHist((winner==='hu'?'Você':'Bagual')+' ganhou o envido ('+TT_G.envPts[winner]+'pts) +'+TT_G.envBet);
      toast(winner==='hu'?'Envido seu! +'+TT_G.envBet+' 🎯':'Bagual ganhou +'+TT_G.envBet,winner==='hu'?'win':'lose');
      renderScores();if(TT_G.score[winner]>=TT_G.target){endGame(winner);return;}
      afterEnvido(nextPhase,nextTurn);
    },2900);
  }else{
    const winner=TT_G.envChal,pts=envRefusePts();
    TT_G.score[winner]+=pts;TT_G.envRes=true;
    addHist('Envido não-querido. '+(winner==='hu'?'Você':'Bagual')+' +'+pts+'pt'+(pts>1?'s':''));
    toast(winner==='hu'?'Envido seu! +'+pts+' 🎯':'Bagual leva +'+pts,winner==='hu'?'win':'info');
    SFX.click();renderScores();if(TT_G.score[winner]>=TT_G.target){endGame(winner);return;}
    afterEnvido(nextPhase,nextTurn);
  }
}

function aiCallTruco(){
  const lvl=TT_G.truLvl+1;
  TT_G.phase='truco_neg';TT_G.truLvl=lvl;TT_G.truChal='ai';TT_G.lastTruChal='ai';TT_G.turn='hu';
  addHist(`${TT_G.char.name} cantou ${TT_TN[lvl]}!`);
  if(_coachMode){const isBluff=TT_G.char.bluff>0.4&&Math.random()<TT_G.char.bluff;showCoachTip(isBluff?"ai_truco_bluff":"ai_truco");}
  showTrucoModal();
}

function aiCallEnvido(){
  const pts=TT_G.envPts.ai;
  let action=pts>=30?'real_envido':'envido';
  let bet=action==='real_envido'?3:2;
  TT_G.envChain.push(action);TT_G.envBet=bet;
  TT_G.envChal='ai';TT_G.lastEnvChal='ai';TT_G.turn='hu';TT_G.phase='envido_neg';
  addHist(`${TT_G.char.name} cantou ${action.replace(/_/g,' ')}! (${bet}pts)`);
  showEnvidoChallenge(action,bet);
  if(_coachMode)showCoachTip("ai_envido");
}

function openSettings(){
  document.getElementById('settings-overlay').classList.remove('hidden');
  applyCfg();
  setTimeout(()=>{addSupabaseConfig();addTestBtn();},50);
}

function saveMatchHistory(entry){
  if(!entry.replay&&TT_G.replay){
    entry.replay={events:TT_G.replay.slice(-100),char:TT_G.char,finalScore:{...TT_G.score},hist:[...(TT_G.hist||[])].slice(0,20)};
  }
  const h=loadHistory();
  h.unshift(entry);
  if(h.length>30)h.splice(30);
  localStorage.setItem('truco_hist',JSON.stringify(h));
}

function renderHistory(){
  const h=loadHistory();
  const body=document.getElementById('history-body');
  if(!h.length){body.innerHTML='<p style="color:var(--txt3);font-style:italic;text-align:center;padding:2rem">Nenhuma partida jogada ainda.</p>';return;}
  body.innerHTML=h.map(e=>{
    const won=e.result==='win';
    const date=new Date(e.ts).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
    return `<div style="background:var(--surf);border:1px solid var(--bdr);border-radius:var(--r2);padding:.85rem;margin-bottom:.6rem;display:flex;align-items:center;gap:.8rem">
      <span style="font-size:1.6rem">${e.charAv}</span>
      <div style="flex:1">
        <div style="font-weight:700;font-size:.82rem">${e.charName}</div>
        <div style="font-size:.65rem;color:var(--txt3)">${date} · ${e.duration}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:.9rem;font-weight:700;color:${won?'var(--green)':'var(--red)'}">${e.score}</div>
        <div style="font-size:.6rem;font-weight:700;padding:.1rem .4rem;border-radius:999px;background:${won?'var(--green-bg)':'var(--red-bg)'};color:${won?'var(--green)':'var(--red)'};">${won?'Vitória':'Derrota'}</div>
      </div>
    </div>`;
  }).join('');
}

async function renderRanking() {
  const body = document.getElementById('ranking-body');
  
  // Filtros de estado e cidade
  const filterState = window._rankingFilterState || '';
  const filterCity = window._rankingFilterCity || '';

  body.innerHTML = `
    <div style="background:var(--surf);border:1px solid var(--bdr);border-radius:var(--r);padding:.75rem;margin-bottom:.75rem">
      <div style="font-size:.7rem;color:var(--txt3);margin-bottom:.4rem;text-transform:uppercase;letter-spacing:.08em">Filtrar por região</div>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap">
        <select id="rank-filter-state" style="flex:1;min-width:120px;padding:.4rem;border:1px solid var(--bdr);border-radius:var(--r);background:var(--bg);color:var(--txt1);font-size:.75rem">
          <option value="">Todos os estados</option>
          ${ESTADOS_BR.map(e=>`<option value="${e.uf}" ${filterState===e.uf?'selected':''}>${e.uf} - ${e.nome}</option>`).join('')}
        </select>
        <input id="rank-filter-city" type="text" placeholder="Cidade (opcional)" value="${filterCity}" style="flex:1;min-width:120px;padding:.4rem;border:1px solid var(--bdr);border-radius:var(--r);background:var(--bg);color:var(--txt1);font-size:.75rem" />
        <button onclick="applyRankingFilter()" style="padding:.4rem .8rem;background:var(--gold);color:#000;border:none;border-radius:var(--r);font-weight:700;font-size:.75rem;cursor:pointer">🔍 Filtrar</button>
      </div>
    </div>
    <div style="text-align:center;padding:2rem;color:var(--txt3)">
      <div style="font-size:1.5rem;margin-bottom:.5rem">⏳</div>
      <div>Carregando ranking...</div>
    </div>
  `;

  try {
    const params = new URLSearchParams();
    if(filterState) params.append('state', filterState);
    if(filterCity) params.append('city', filterCity);
    const ranking = await callTRPC('localAuth.ranking', params.toString() ? { state: filterState || undefined, city: filterCity || undefined } : {});

    if(!ranking || ranking.length === 0) {
      body.innerHTML += `<div style="text-align:center;padding:2rem;color:var(--txt3)">Nenhum jogador encontrado com esses filtros.</div>`;
      return;
    }

    const rows = ranking.map((r, i) => {
      const medal = i < 3 ? ['🥇', '🥈', '🥉'][i] : `${i+1}º`;
      return `<tr>
        <td style="text-align:center;font-size:1.1rem">${medal}</td>
        <td style="font-weight:600">${r.name || 'Anônimo'}</td>
        <td style="text-align:center;font-size:.75rem;color:var(--txt3)">${r.state || '--'} ${r.city ? `/ ${r.city}` : ''}</td>
        <td style="text-align:center;font-weight:700;color:var(--green)">${r.wins}</td>
        <td style="text-align:center;color:var(--red)">${r.losses}</td>
        <td style="text-align:center;color:var(--txt3)">${r.total}</td>
        <td style="text-align:center;font-weight:700;color:var(--gold-d)">${r.winRate}%</td>
      </tr>`;
    }).join('');

    const filterInfo = filterState || filterCity ? `<div style="font-size:.7rem;color:var(--txt3);margin-bottom:.5rem">Filtrado: ${filterState ? ESTADOS_BR.find(e=>e.uf===filterState)?.nome : 'Todos'} ${filterCity ? `/ ${filterCity}` : ''}</div>` : '';

    body.innerHTML = `
      <div style="background:var(--surf);border:1px solid var(--bdr);border-radius:var(--r);padding:.75rem;margin-bottom:.75rem">
        <div style="font-size:.7rem;color:var(--txt3);margin-bottom:.4rem;text-transform:uppercase;letter-spacing:.08em">Filtrar por região</div>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap">
          <select id="rank-filter-state" style="flex:1;min-width:120px;padding:.4rem;border:1px solid var(--bdr);border-radius:var(--r);background:var(--bg);color:var(--txt1);font-size:.75rem">
            <option value="">Todos os estados</option>
            ${ESTADOS_BR.map(e=>`<option value="${e.uf}" ${filterState===e.uf?'selected':''}>${e.uf} - ${e.nome}</option>`).join('')}
          </select>
          <input id="rank-filter-city" type="text" placeholder="Cidade (opcional)" value="${filterCity}" style="flex:1;min-width:120px;padding:.4rem;border:1px solid var(--bdr);border-radius:var(--r);background:var(--bg);color:var(--txt1);font-size:.75rem" />
          <button onclick="applyRankingFilter()" style="padding:.4rem .8rem;background:var(--gold);color:#000;border:none;border-radius:var(--r);font-weight:700;font-size:.75rem;cursor:pointer">🔍 Filtrar</button>
        </div>
      </div>
      ${filterInfo}
      <div style="overflow-x:auto">
        <table class="rank-table" style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="background:var(--surf);border-bottom:2px solid var(--bdr)">
              <th style="padding:.5rem;text-align:center">#</th>
              <th style="padding:.5rem;text-align:left">Jogador</th>
              <th style="padding:.5rem;text-align:center">Região</th>
              <th style="padding:.5rem;text-align:center">Vitórias</th>
              <th style="padding:.5rem;text-align:center">Derrotas</th>
              <th style="padding:.5rem;text-align:center">Total</th>
              <th style="padding:.5rem;text-align:center">% Vit.</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  } catch(err) {
    console.error('Erro ao carregar ranking:', err);
    body.innerHTML += `<div style="text-align:center;padding:2rem;color:var(--red)">Erro ao carregar ranking. Tente novamente.</div>`;
  }
}

function applyRankingFilter() {
  const state = document.getElementById('rank-filter-state').value;
  const city = document.getElementById('rank-filter-city').value.trim();
  window._rankingFilterState = state;
  window._rankingFilterCity = city;
  renderRanking();
}

function renderLegacyProfile(){
  TT_P.lv=lvlOf(TT_P.xp);
  const xc=TT_P.xp-xpFor(TT_P.lv),xn=xpFor(TT_P.lv+1)-xpFor(TT_P.lv);
  const wr=TT_P.games?Math.round(TT_P.wins/TT_P.games*100):0;
  const charRows=CHARS.map(ch=>{
    const s=TT_P.charStats[ch.id]||{wins:0,losses:0};
    const tot=s.wins+s.losses;
    const wr2=tot?Math.round(s.wins/tot*100):0;
    return '<tr><td>'+ch.av+' '+ch.name+'</td><td>'+s.wins+'</td><td>'+s.losses+'</td><td><span class="stat-bar-wrap"><span class="stat-bar-fill" style="width:'+wr2+'%"></span></span> '+(tot?wr2+'%':'--')+'</td></tr>';
  }).join('');
  document.getElementById('profile-body').innerHTML=`
    <div style="max-width:480px;margin:0 auto">
      <div style="text-align:center;padding:.75rem 0 1rem">
        <div style="font-size:3rem">${(TT_P.shopActive&&TT_P.shopActive.avatar?SHOP_ITEMS.avatars.find(a=>a.id===TT_P.shopActive.avatar)?.icon:null)||'🤠'}</div>
        <div style="font-size:1.1rem;font-weight:700;margin:.2rem 0">${TT_P.name}</div>
        <div style="font-size:.72rem;color:var(--txt3)">Nível ${TT_P.lv} · ${TT_P.xp} XP · ELO ${getMyElo()} <span class="div-badge ${getDivision(getMyElo()).cls}" style="font-size:.6rem">${getDivision(getMyElo()).name}</span></div>
        <div class="xpw" style="width:130px;height:6px;margin:.4rem auto"><span class="xpf" style="width:${Math.min(100,xc/xn*100)}%"></span></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem;margin-bottom:.9rem">
        ${[['Vitórias',TT_P.wins,'var(--green)'],['Derrotas',TT_P.losses,'var(--red)'],['Partidas',TT_P.games,'var(--blue)'],['% Vitória',wr+'%','var(--gold-d)'],['Moedas','🪙'+TT_P.coins,'var(--gold-d)'],['Melhor seq.',(TT_P.bestStreak||0)+'v','#7b2d8b']].map(([l,v,c])=>'<div style="background:var(--surf);border:1px solid var(--bdr);border-radius:var(--r);padding:.55rem;text-align:center"><div style="font-size:.57rem;color:var(--txt3);text-transform:uppercase;letter-spacing:.09em">'+l+'</div><div style="font-size:1.1rem;font-weight:700;color:'+c+'">'+v+'</div></div>').join('')}
      </div>
      <div style="margin-bottom:.9rem">
        <div style="font-size:.65rem;color:var(--txt3);text-transform:uppercase;letter-spacing:.1em;margin-bottom:.4rem">Por personagem</div>
        <table class="stats-table"><thead><tr><th>Adversário</th><th>V</th><th>D</th><th>% Vitória</th></tr></thead><tbody>${charRows}</tbody></table>
      </div>
      <div style="margin-bottom:.9rem">
        <div style="font-size:.65rem;color:var(--txt3);text-transform:uppercase;letter-spacing:.1em;margin-bottom:.4rem">Desbloqueados (${TT_P.unlocked.length}/${CHARS.length})</div>
        <div style="display:flex;flex-wrap:wrap;gap:.38rem">${CHARS.map(ch=>'<span style="font-size:1.25rem;opacity:'+(TT_P.unlocked.includes(ch.id)?1:.2)+'" title="'+ch.name+'">'+ch.av+'</span>').join('')}</div>
      </div>
      <div style="margin-bottom:.75rem;display:flex;gap:.5rem">
        <button onclick="show('stats-scr');renderAdvStats()" style="flex:1;background:var(--surf2);border:1.5px solid var(--bdr2);color:var(--txt2);padding:.5rem;border-radius:var(--r);cursor:pointer;font-family:inherit;font-size:.78rem;font-weight:500">📊 Estatísticas</button>
        <button onclick="show('achievements-scr');renderAchievements()" style="flex:1;background:var(--gold-bg);border:1.5px solid var(--gold-bdr);color:var(--gold-d);padding:.5rem;border-radius:var(--r);cursor:pointer;font-family:inherit;font-size:.78rem;font-weight:600">🏆 ${(TT_P.unlockedAch||[]).length}/${ACHIEVEMENTS.length}</button>
      </div>
      <div style="margin-bottom:.75rem;display:flex;gap:.5rem">
        <button onclick="show('history-scr');renderHistory()" style="flex:1;background:var(--surf2);border:1.5px solid var(--bdr2);color:var(--txt2);padding:.5rem;border-radius:var(--r);cursor:pointer;font-family:inherit;font-size:.78rem;font-weight:500">📋 Hist. vs IA</button>
        <button onclick="show('online-history-scr');renderOnlineHistory()" style="flex:1;background:var(--surf2);border:1.5px solid var(--bdr2);color:var(--txt2);padding:.5rem;border-radius:var(--r);cursor:pointer;font-family:inherit;font-size:.78rem;font-weight:500">🌐 Hist. Online</button>
      </div>
      <div style="margin-bottom:.75rem">
        <div style="font-size:.65rem;color:var(--txt3);margin-bottom:.3rem">Minha região:</div>
        <div style="display:flex;gap:.35rem;flex-wrap:wrap">
          ${REGIONS.slice(0,6).map(r=>{const sel=(TT_P.region||'RS')===r.id;const bg=sel?'var(--gold)':'var(--surf2)';const col=sel?'#fff':'var(--txt2)';return`<button onclick="setMyRegion('${r.id}');renderProfile()" style="background:${bg};color:${col};border:1px solid var(--bdr2);border-radius:999px;padding:.2rem .55rem;cursor:pointer;font-size:.7rem">${r.flag} ${r.sub}</button>`;}).join('')}
        </div>
      </div>
      <div>
        <div style="font-size:.68rem;color:var(--txt3);margin-bottom:.3rem">Nome de gaudério:</div>
        <div style="display:flex;gap:.45rem">
          <input id="ni" type="text" value="${TT_P.name}" maxlength="16" class="auth-input">
          <button onclick="saveName()" style="background:var(--gold);color:#fff;border:none;padding:.4rem .85rem;border-radius:var(--r);cursor:pointer;font-size:.8rem;font-weight:700;font-family:inherit">Salvar</button>
        </div>
      </div>
      <div id="google-link-section" style="margin-top:.9rem;padding:.75rem;background:var(--surf);border:1px solid var(--bdr);border-radius:var(--r)">
        <div style="font-size:.65rem;color:var(--txt3);text-transform:uppercase;letter-spacing:.1em;margin-bottom:.5rem">Conta Google</div>
        <div id="google-link-status" style="display:flex;align-items:center;gap:.5rem;margin-bottom:.5rem">
          <span style="font-size:.8rem">Carregando...</span>
        </div>
        <div id="google-link-actions"></div>
      </div>
    </div>`;
  // Carrega status de vinculação Google de forma assíncrona
  loadGoogleLinkStatus();
}

function escapeProfileText(value) {
  return String(value == null ? '' : value).replace(/[&<>'"]/g, function(char) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char];
  });
}

function formatProfileDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Data indisponível' : date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatProfileDuration(seconds) {
  if (!seconds || seconds < 60) return seconds ? `${seconds}s` : '—';
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes} min`;
}

function renderProfileMatch(match) {
  const won = match.result === 'win';
  const accent = won ? 'var(--green)' : 'var(--red)';
  const result = won ? 'Vitória' : 'Derrota';
  const source = match.source === 'online' ? 'Partida online' : 'Desafio contra IA';
  const walkover = match.isWalkover ? ' · W.O.' : '';
  return `<article style="display:flex;align-items:center;gap:.65rem;padding:.7rem 0;border-bottom:1px solid var(--bdr)">
    <div style="width:2.2rem;height:2.2rem;display:grid;place-items:center;border-radius:50%;background:var(--surf2);font-size:1.1rem">${escapeProfileText(match.opponentAvatar)}</div>
    <div style="min-width:0;flex:1">
      <div style="display:flex;align-items:center;gap:.4rem;min-width:0"><strong style="font-size:.83rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeProfileText(match.opponent)}</strong><span style="font-size:.58rem;color:var(--txt3);white-space:nowrap">${source}${walkover}</span></div>
      <div style="font-size:.67rem;color:var(--txt3);margin-top:.12rem">${formatProfileDate(match.playedAt)} · ${formatProfileDuration(match.durationSeconds)}</div>
    </div>
    <div style="text-align:right"><div style="font-weight:800;font-size:.78rem;color:${accent}">${result}</div><div style="font-size:.82rem;color:var(--txt);margin-top:.1rem">${escapeProfileText(match.scoreLabel)}</div></div>
  </article>`;
}

async function renderProfile() {
  const body = document.getElementById('profile-body');
  if (!body) return;
  body.innerHTML = `<div style="max-width:720px;margin:0 auto;padding:1rem 0"><div style="padding:1.5rem;text-align:center;color:var(--txt3)">Carregando seu desempenho...</div></div>`;
  try {
    const data = await trpcQuery('localAuth.profileDashboard');
    const profile = data.profile;
    const stats = data.stats;
    const displayName = escapeProfileText(profile.name || 'Gaudério');
    const location = [profile.city, profile.state].filter(Boolean).map(escapeProfileText).join(' · ') || 'Região não informada';
    const history = data.recentMatches || [];
    const championTournaments = data.championTournaments || [];
    const winRateWidth = Math.max(0, Math.min(100, stats.winRate || 0));
    const statCard = (label, value, color, hint) => `<div style="background:var(--surf);border:1px solid var(--bdr);border-radius:var(--r);padding:.75rem;min-width:0"><div style="font-size:.6rem;color:var(--txt3);text-transform:uppercase;letter-spacing:.09em">${label}</div><div style="font-size:1.25rem;font-weight:800;color:${color};margin-top:.18rem">${value}</div>${hint ? `<div style="font-size:.62rem;color:var(--txt3);margin-top:.15rem">${hint}</div>` : ''}</div>`;
    body.innerHTML = `<div style="max-width:720px;margin:0 auto;padding-bottom:1.25rem">
      <section style="background:linear-gradient(135deg,var(--surf),var(--surf2));border:1px solid var(--gold-bdr);border-radius:calc(var(--r) + 4px);padding:1rem;margin-bottom:.85rem;display:flex;gap:.85rem;align-items:center">
        <div style="width:3.5rem;height:3.5rem;border-radius:50%;display:grid;place-items:center;background:var(--gold-bg);border:1px solid var(--gold-bdr);font-size:1.75rem">🤠</div>
        <div style="min-width:0;flex:1"><h2 style="margin:0;color:var(--txt);font-size:1.1rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${displayName}</h2><p style="margin:.18rem 0 0;color:var(--txt3);font-size:.72rem">${location}</p><p style="margin:.18rem 0 0;color:var(--txt3);font-size:.62rem">Na cancha desde ${formatProfileDate(profile.createdAt)}</p></div>
        <button onclick="openModal('m-auth');renderAuthModal()" style="background:transparent;border:1px solid var(--bdr2);color:var(--txt2);border-radius:var(--r);padding:.45rem .55rem;cursor:pointer;font-family:inherit;font-size:.7rem">Conta</button>
      </section>
      <section style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.55rem;margin-bottom:.85rem">
        ${statCard('Vitórias', stats.wins, 'var(--green)', `${stats.total} partidas`)}
        ${statCard('Taxa de vitória', `${stats.winRate}%`, 'var(--gold-d)', `${stats.losses} derrotas`)}
        ${statCard('Partidas online', stats.onlineMatches, 'var(--blue)', 'contra outros jogadores')}
        ${statCard('Pontos por partida', stats.averageScore == null ? '—' : stats.averageScore, 'var(--txt)', stats.averageOpponentScore == null ? 'Sem placar registrado' : `adversário: ${stats.averageOpponentScore}`)}
      </section>
      <section style="background:var(--surf);border:1px solid var(--bdr);border-radius:var(--r);padding:.8rem;margin-bottom:.85rem">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:.75rem"><div><div style="font-size:.7rem;color:var(--txt3);text-transform:uppercase;letter-spacing:.1em">Aproveitamento</div><strong style="font-size:1rem;color:var(--txt)">${stats.wins} vitórias em ${stats.total} partidas</strong></div><span style="font-size:.8rem;font-weight:800;color:var(--gold-d)">${stats.winRate}%</span></div>
        <div style="height:.5rem;background:var(--surf2);border-radius:999px;overflow:hidden;margin-top:.6rem"><div style="height:100%;width:${winRateWidth}%;background:linear-gradient(90deg,var(--gold),var(--green));border-radius:inherit;transition:width .2s ease-out"></div></div>
      </section>
      <section style="background:linear-gradient(135deg,rgba(200,168,75,.15),var(--surf));border:1px solid rgba(200,168,75,.42);border-radius:var(--r);padding:.8rem;margin-bottom:.85rem">
        <div style="font-size:.7rem;color:var(--tg-gold,#c8a84b);text-transform:uppercase;letter-spacing:.1em">Títulos na cancha</div>
        <strong style="font-size:.92rem;color:var(--txt)">${championTournaments.length ? `${championTournaments.length} campeonato(s) vencido(s)` : 'Ainda não há títulos registrados'}</strong>
        <div style="margin-top:.5rem">${championTournaments.length ? championTournaments.map(t => `<div style="display:flex;justify-content:space-between;align-items:center;gap:.6rem;padding:.5rem 0;border-top:1px solid rgba(200,168,75,.18)"><div style="min-width:0"><div style="font-size:.76rem;font-weight:700">🏆 ${escapeProfileText(t.name)}</div><div style="font-size:.62rem;color:var(--txt3)">${t.prize ? `Prêmio: ${escapeProfileText(t.prize)} · ` : ''}${t.completedAt ? new Date(t.completedAt).toLocaleDateString('pt-BR') : 'Data não informada'}</div></div><a href="${escapeProfileText(t.certificateUrl)}" target="_blank" rel="noopener" style="font-size:.62rem;color:var(--tg-gold,#c8a84b);border:1px solid rgba(200,168,75,.5);padding:.32rem .45rem;border-radius:var(--r);text-decoration:none;white-space:nowrap">📜 Certificado</a></div>`).join('') : '<div style="font-size:.7rem;color:var(--txt3);margin-top:.35rem">Vença um campeonato mano a mano para receber teu certificado gauchesco.</div>'}</div>
      </section>
      <section style="background:var(--surf);border:1px solid var(--bdr);border-radius:var(--r);padding:.8rem">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:.75rem"><div><div style="font-size:.7rem;color:var(--txt3);text-transform:uppercase;letter-spacing:.1em">Histórico de partidas</div><strong style="font-size:.92rem;color:var(--txt)">Últimas ${Math.min(history.length, 25)} partidas</strong></div><button onclick="renderProfile()" style="background:transparent;border:1px solid var(--bdr2);color:var(--txt2);border-radius:var(--r);padding:.35rem .5rem;cursor:pointer;font-family:inherit;font-size:.68rem">Atualizar</button></div>
        <div style="margin-top:.45rem">${history.length ? history.map(renderProfileMatch).join('') : `<div style="text-align:center;padding:1.5rem .5rem;color:var(--txt3)"><div style="font-size:1.4rem">🃏</div><strong style="display:block;color:var(--txt2);margin:.35rem 0">Ainda não há partidas registradas</strong><span style="font-size:.72rem">Jogue contra a IA ou entre em uma sala online para construir seu histórico.</span></div>`}</div>
      </section>
    </div>`;
  } catch (error) {
    console.error('Erro ao carregar perfil:', error);
    body.innerHTML = `<div style="max-width:520px;margin:2rem auto;text-align:center;padding:1.25rem;background:var(--surf);border:1px solid var(--red);border-radius:var(--r)"><div style="font-size:1.5rem">⚠️</div><strong style="display:block;margin:.45rem 0;color:var(--txt)">Não foi possível carregar o perfil</strong><p style="font-size:.75rem;color:var(--txt3);margin:0 0 .8rem">Verifique sua conexão e tente novamente.</p><button onclick="renderProfile()" style="background:var(--gold);border:0;color:#fff;border-radius:var(--r);padding:.5rem .8rem;cursor:pointer;font-family:inherit;font-weight:700">Tentar novamente</button></div>`;
  }
}
// ══ FUNÇÕES UNIFICADAS (deal/humanPlay/startGame/checkRound/endGame) ══

function startGame(ch){
  // Guard: exige login para jogar
  const _lu = JSON.parse(localStorage.getItem('truco_local_user') || 'null');
  if (!_lu) {
    // Salva o personagem para iniciar após login
    window._pendingGameChar = ch;
    openModal('m-auth');
    laShowScreen('la-login');
    // Exibe mensagem informativa
    const infoEl = document.getElementById('la-login-info');
    if (infoEl) {
      infoEl.textContent = 'Faça login para começar a jogar e registrar suas partidas!';
      infoEl.classList.remove('hidden');
    }
    return;
  }
  window._pendingGameChar = null;
  _gameStart=Date.now();
  clearGameSave();stopTimer();
  TT_G={
    char:ch,target:TARGET_1v1,
    score:{ai:0,hu:0},
    phase:'playing',turn:'hu',mano:'hu',handMano:'hu',
    pHand:[],aiHand:[],table:[],rw:[],
    truLvl:1,truChal:null,lastTruChal:null,
    envChain:[],envBet:0,envChal:null,lastEnvChal:null,envRes:false,
    envPts:{ai:0,hu:0},
    florChain:[],flBet:0,florChal:null,
    trucoPendEnv:false,hFlor:{ai:false,hu:false},
    pfirst:{ai:false,hu:false},
    bluffing:false,hist:[],replay:[],isOnline:false,
  };
  document.getElementById('g-ai-lbl').textContent=ch.name;
  document.getElementById('pr-ai-lbl').textContent=ch.name;
  document.getElementById('fz-ai-lbl').textContent=ch.name;
  document.getElementById('opp-av').textContent=ch.av;
  document.getElementById('opp-name').textContent=ch.name;
  document.getElementById('opp-sb').textContent=(ch.loc?ch.loc+' · ':'')+ch.style;
  bubbleSay(ch.catch||'Boa sorte!');
  // Remove variant badge se existir
  const vb=document.getElementById('variant-badge');if(vb)vb.remove();
  show('game');SFX.deal();
  // Coach mode
  if(CFG&&CFG.coachMode){
    const ov=document.getElementById('coach-overlay');if(ov)ov.classList.remove('hidden');
    showCoachTip('welcome');
  }
  // Onboarding para novos jogadores
  if(!localStorage.getItem('truco_ob_done')&&TT_P.games===0){
    setTimeout(startOnboarding,2200);
  }
  deal();
}

function deal(){
  if(TT_G.phase==='game_over')return;
  stopTimer();
  // Apply variant target
  const target=(CFG&&CFG.variant15)?15:TARGET_1v1;
  const deck=makeDeck();
  const ph=deck.splice(0,3),ah=deck.splice(0,3);
  const pc=calcEnvido(ph),ac=calcEnvido(ah);
  const thisMano=TT_G.mano;
  TT_G.handMano=thisMano;TT_G.mano=TT_G.mano==='hu'?'ai':'hu';
  Object.assign(TT_G,{
    target,pHand:ph,aiHand:ah,table:[],rw:[],
    turn:thisMano,phase:'playing',truLvl:1,
    truChal:null,lastTruChal:null,
    envChain:[],envBet:0,envChal:null,lastEnvChal:null,envRes:false,
    envPts:{ai:ac.pts,hu:pc.pts},
    hFlor:{ai:ac.hasFlor,hu:pc.hasFlor},
    florChain:[],flBet:0,florChal:null,
    trucoPendEnv:false,pfirst:{ai:false,hu:false},
    bluffing:Math.random()<TT_G.char.bluff,
    replay:TT_G.replay||[],
  });
  if(CFG&&CFG.variant15&&!document.getElementById('variant-badge')){
    const b=document.createElement('span');b.id='variant-badge';b.className='variant-badge';b.textContent='a 15';
    const ph_el=document.getElementById('g-ph');if(ph_el&&ph_el.parentNode)ph_el.parentNode.insertBefore(b,ph_el.nextSibling);
  }
  SFX.deal();
  renderAll();updateManoIndicator();
  setPh(thisMano==='hu'?'▶ Sua vez':'⏳ Bagual pensa...',thisMano==='hu'?'ph-play':'ph-wait');
  if(thisMano==='hu')startTimer();
  // Card deal animation then trigger AI if needed
  setTimeout(()=>{
    if(document.getElementById('game').classList.contains('on')){
      animateDeal(()=>{renderHand();renderAICards();});
    }
    if(thisMano==='ai')setTimeout(aiTurn,aiDelay(1100));
  },100);
  // Save state + coach
  setTimeout(saveGameState,200);
  setTimeout(analyzeAndCoach,1800);
}

function humanPlay(idx){
  if(TT_G.phase!=='playing'||TT_G.turn!=='hu')return;
  // REGRA: nunca jogar 2 cartas na mesma rodada
  if(TT_G.table.some(t=>t.player==='hu'))return;
  stopTimer();SFX.card();
  const card=TT_G.pHand.splice(idx,1)[0];
  // Replay recording
  if(!TT_G.replay)TT_G.replay=[];
  TT_G.replay.push({type:'card_played',data:{player:'hu',card,huCards:[...TT_G.pHand],aiCards:TT_G.aiHand.map(c=>({...c}))},ts:Date.now(),score:{...TT_G.score},rw:[...TT_G.rw]});
  TT_G.table.push({card,player:'hu'});TT_G.pfirst.hu=true;
  // Online mode: send move to opponent
  if(TT_G.isOnline){
    if(conn&&conn.open)conn.send({type:'online_move',action:'play',cardId:card.id});
    const aiAlready=TT_G.table.some(t=>t.player==='ai');
    if(!aiAlready)TT_G.turn='ai';
    renderAll();
    if(aiAlready){checkRound();}
    else setPh('⏳ Adversário...','ph-wait');
  }else{
    const aiAlready=TT_G.table.some(t=>t.player==='ai');
    if(!aiAlready)TT_G.turn='ai';
    renderAll();
    if(aiAlready){checkRound();}
    else{setPh('⏳ Bagual pensa...','ph-wait');setTimeout(aiTurn,aiDelay(900));}
  }
  // Save game state after move
  setTimeout(saveGameState,100);
  // Coach analysis
  setTimeout(analyzeAndCoach,1200);
}

function checkRound(){
  const aiC=TT_G.table.find(t=>t.player==='ai'),huC=TT_G.table.find(t=>t.player==='hu');
  if(!aiC||!huC)return;
  // Coach: frase contextual antes de resolver
  if(aiC.card.tv>=11)setTimeout(()=>bubbleSay(ctxSlang('manilha')),200);
  else if(aiC.card.tv>huC.card.tv)setTimeout(()=>bubbleSay(ctxSlang('round_win')),600);
  else if(huC.card.tv>aiC.card.tv)setTimeout(()=>bubbleSay(ctxSlang('round_lose')),600);
  // Track stats
  if(huC&&isMan(huC.card.rank,huC.card.suit))trackStat('manilhaWins');
  trackStat('roundsPlayed');
  setTimeout(()=>{
    if(TT_G.phase==='game_over')return;
    let winner;
    if(aiC.card.tv>huC.card.tv)winner='ai';
    else if(huC.card.tv>aiC.card.tv)winner='hu';
    else winner='draw';
    TT_G.rw.push(winner);
    const roundMessage=winner==='draw'?'Empate na rodada.':(winner==='hu'?'Você ganhou a rodada!':'Bagual ganhou a rodada.');
    addHist(roundMessage);
    setPh(winner==='draw'?'⚖ Empate na vaza':(winner==='hu'?'🏆 Você ganhou a vaza!':'🏆 Bagual ganhou a vaza.'),winner==='hu'?'ph-play':'ph-wait');
    if(winner==='hu')SFX.win();else if(winner==='ai')SFX.lose();
    if(winner==='draw')showCoachTip('round_draw');
    renderPips();
    // Record round end for replay
    if(!TT_G.replay)TT_G.replay=[];
    TT_G.replay.push({type:'round_end',data:{winner,rw:[...TT_G.rw]},ts:Date.now(),score:{...TT_G.score},rw:[...TT_G.rw]});
    const hw=handWinner();
    if(hw){
      const pts=TT_TP[TT_G.truLvl];TT_G.score[hw]+=pts;
      // Record hand end
      TT_G.replay.push({type:'hand_end',data:{winner:hw,pts},ts:Date.now(),score:{...TT_G.score},rw:[...TT_G.rw]});
      addHist((hw==='hu'?'Você':'Bagual')+' ganhou a mão! +'+pts+'pt');
      toast(hw==='hu'?'Mão sua! +'+pts+' 🏆':'Bagual ganhou +'+pts,hw==='hu'?'win':'lose');
      if(hw==='hu')SFX.win();else SFX.lose();
      renderScores();
      if(TT_G.score[hw]>=TT_G.target){endGame(hw);return;}
      setTimeout(TT_G.isOnline?dealOnline:deal,1900);
    }else{
      // Segurança: após 3 rodadas handWinner sempre retorna um vencedor.
      // Se por algum motivo retornou null com 3 rodadas, forçar nova mão.
      if(TT_G.rw.length>=3){setTimeout(TT_G.isOnline?dealOnline:deal,1200);return;}
      const nt=winner==='draw'?TT_G.handMano:winner;
      TT_G.table=[];TT_G.turn=nt;
      renderAll();
      setPh(nt==='hu'?'\u25b6 Sua vez':'\u23f3 Bagual pensa...',nt==='hu'?'ph-play':'ph-wait');
      if(nt==='hu')startTimer();else setTimeout(aiTurn,aiDelay(900));
    }
  },1850);
}

function endGame(winner){
  if(TT_G.phase==='game_over')return;
  TT_G.phase='game_over';stopTimer();
  try{ initAdvStats(); }catch(e){ console.error('endGame initAdvStats error',e); }
  // --- Base: XP, coins, profile ---
  const hw=winner==='hu';
  let xpG=hw?120+(TT_P.hasPass?60:0):30, coinsG=hw?50+(TT_P.hasPass?50:0):10;
  let myElo=1000, newElo=1000;
  TT_P.games++;
  if(hw){TT_P.wins++;TT_P.streak++;TT_P.bestStreak=Math.max(TT_P.bestStreak||0,TT_P.streak);}
  else{TT_P.losses++;TT_P.streak=0;}
  TT_P.xp+=xpG;TT_P.coins+=coinsG;TT_P.lv=lvlOf(TT_P.xp);
  // Unlock characters
  CHARS.forEach(ch=>{
    if(TT_P.wins>=ch.need&&!TT_P.unlocked.includes(ch.id)){
      TT_P.unlocked.push(ch.id);
      setTimeout(()=>{toast('🔓 '+ch.name+' desbloqueado!','unlock',4000);SFX.unlock&&SFX.unlock();},1200);
    }
  });
  // Per-char stats
  addCharStat(TT_G.char.id,hw);
  // --- Tournament hook (AI) ---
  if (TOURNEY.active) {
    if (!TOURNEY.results) TOURNEY.results = [];
    if (!TOURNEY.scores) TOURNEY.scores = [];
    const won = winner === 'hu';
    const scoreStr = TT_G.score.hu + '×' + TT_G.score.ai;
    TOURNEY.results[TOURNEY.round] = won ? 'win' : 'lose';
    TOURNEY.scores[TOURNEY.round] = scoreStr;
    if (won) TOURNEY.wins = (TOURNEY.wins || 0) + 1;
    else TOURNEY.losses = (TOURNEY.losses || 0) + 1;
    const roundIdx = TOURNEY.round;
    TOURNEY.round++;
    const isOver = TOURNEY.round >= TOURNEY.opponents.length;
    // Persist match result to server
    if (TOURNEY.dbId) {
      const dur = _gameStart ? Math.round((Date.now() - _gameStart) / 1000) : undefined;
      trpcMutation('tournament.recordMatchResult', {
        tournamentId: TOURNEY.dbId,
        result: won ? 'win' : 'lose',
        score: scoreStr,
        scorePlayer: TT_G.score.hu,
        scoreOpponent: TT_G.score.ai,
        opponentName: TT_G.char.name,
        opponentAvatar: TT_G.char.av,
        durationSeconds: dur,
        roundIndex: roundIdx,
        matchIndex: 0,
      }).then(res => {
        if (res && res.coinsAwarded) {
          TT_P.coins = (TT_P.coins || 0) + res.coinsAwarded;
          saveP();
          setTimeout(() => toast('Torneio finalizado! 🪙 +' + res.coinsAwarded + ' moedas', 'unlock', 4000), 600);
        }
      }).catch(e => console.warn('Tournament record error:', e));
    } else if (isOver) {
      const bonus = TOURNEY.wins === TOURNEY.opponents.length ? TOURNEY.prizeCoins : Math.floor(TOURNEY.prizeCoins * TOURNEY.wins / TOURNEY.opponents.length);
      TT_P.coins = (TT_P.coins || 0) + bonus;
      saveP();
      setTimeout(() => toast('Torneio finalizado! 🪙 +' + bonus + ' moedas', 'unlock', 4000), 600);
    }
  }
  // --- Bracket hook ---
  if (BRACKET.currentMatch) {
    const { roundIdx, matchIdx, p1, p2 } = BRACKET.currentMatch;
    const match = BRACKET.rounds[roundIdx].matches[matchIdx];
    const isHuWin = winner === 'hu';
    const humanPlayer = p1.id === 0 ? p1 : p2;
    const aiPlayer = p1.id === 0 ? p2 : p1;
    const winnerPlayer = isHuWin ? humanPlayer : aiPlayer;
    match.winner = winnerPlayer;
    match.score = TT_G.score.hu + '×' + TT_G.score.ai;
    BRACKET.currentMatch = null;
    if (TT_P.advStats) TT_P.advStats.tourneyWins = (TT_P.advStats.tourneyWins || 0) + (isHuWin ? 1 : 0);
    // Persist bracket match result
    if (BRACKET.dbId) {
      const dur = _gameStart ? Math.round((Date.now() - _gameStart) / 1000) : undefined;
      trpcMutation('tournament.recordMatchResult', {
        tournamentId: BRACKET.dbId,
        result: isHuWin ? 'win' : 'lose',
        score: match.score,
        scorePlayer: TT_G.score.hu,
        scoreOpponent: TT_G.score.ai,
        opponentName: aiPlayer.name,
        opponentAvatar: aiPlayer.avatar || '🌄',
        durationSeconds: dur,
        roundIndex: roundIdx,
        matchIndex: matchIdx,
        winnerPlayer: { id: winnerPlayer.id, name: winnerPlayer.name, avatar: winnerPlayer.avatar || winnerPlayer.av || '🌄', seed: winnerPlayer.seed || 0 },
      }).then(res => {
        if (res && res.bracketData) {
          // Sync local bracket with server state
          BRACKET.rounds = res.bracketData.rounds.map(r => ({
            ...r,
            matches: r.matches.map(m => ({
              ...m,
              p1: { ...m.p1, av: m.p1.avatar },
              p2: { ...m.p2, av: m.p2.avatar },
              winner: m.winner ? { ...m.winner, av: m.winner.avatar } : null,
            }))
          }));
          if (res.status === 'completed' && res.champion) {
            toast(res.champion.name === TT_P.name ? '🏆 Você é o Campeão!' : '🎖️ Torneio finalizado!', 'unlock', 4000);
          }
        }
      }).catch(e => console.warn('Bracket persist error:', e));
    }
    setTimeout(() => { closeModal('m-go'); show('tournament-scr'); switchTourneyTab('bracket'); renderBracketInner(); }, 4000);
  }
  // --- Stats + ELO ---
  try{
    TT_P.advStats.handsPlayed=(TT_P.advStats.handsPlayed||0)+1;
    if(winner==='hu'&&TT_G.score.ai>=8&&TT_G.score.hu===0)TT_P.advStats.comebacks=(TT_P.advStats.comebacks||0)+1;
    myElo=getMyElo();
    const oppElo=800+(TT_G.char.diff||1)*200;
    newElo=calcElo(myElo,oppElo,winner==='hu');
    setMyElo(newElo);updateLeaderboard(newElo);
    // --- Match history ---
    const duration=_gameStart?Math.round((Date.now()-_gameStart)/1000)+'s':'--';
    saveMatchHistory({
      ts:Date.now(),charName:TT_G.char.name,charAv:TT_G.char.av,
      score:TT_G.score.hu+'×'+TT_G.score.ai,result:winner==='hu'?'win':'lose',duration,
      replay:TT_G.replay?{events:TT_G.replay.slice(-100),char:TT_G.char,finalScore:{...TT_G.score},hist:[...(TT_G.hist||[])].slice(0,20)}:null
    });
  }catch(e){ console.error('endGame stats error',e); }
  clearGameSave();
  saveP();
  // Sounds
  try{ if(winner==='hu')SFX.win();else SFX.lose(); }catch(e){}
  // Game over modal — personalizado por resultado
  const modal=document.getElementById('m-go');
  if(!modal){ console.error('endGame: modal m-go not found!'); return; }
  const confetti=document.getElementById('go-confetti');
  const banner=document.getElementById('go-banner');
  const ico=document.getElementById('go-ico');
  const ttl=document.getElementById('go-ttl');
  const sub=document.getElementById('go-sub');
  const score=document.getElementById('go-score');
  
  // Limpar classes anteriores
  modal.classList.remove('win-bg','lose-bg');
  banner.classList.remove('win','lose');
  confetti.innerHTML='';
  
  if(hw){
    // VITÓRIA: fundo gradiente verde/azul, confete animado, mensagem comemorativa
    modal.classList.add('win-bg');
    banner.classList.add('win');
    banner.textContent='🎆 VITÓRIA!';
    ico.textContent='🏆';
    ttl.textContent='Barbaridade, tchê!';
    sub.textContent=`Você dominou ${TT_G.char.name} e levou a partida!`;
    // Gerar confete
    const colors=['#b8860b','#d4a018','#1a6a1a','#2a9a2a','#1a3878','#2448a8'];
    for(let i=0;i<50;i++){
      const piece=document.createElement('div');
      piece.className='go-confetti-piece';
      piece.style.left=Math.random()*100+'%';
      piece.style.background=colors[Math.floor(Math.random()*colors.length)];
      piece.style.animationDuration=(Math.random()*2+3)+'s';
      piece.style.animationDelay=Math.random()*2+'s';
      confetti.appendChild(piece);
    }
  }else{
    // DERROTA: fundo vermelho escuro, sem confete, mensagem de derrota
    modal.classList.add('lose-bg');
    banner.classList.add('lose');
    banner.textContent='❌ Derrota';
    ico.textContent='🐴';
    ttl.textContent='Que pena, tchê...';
    sub.textContent=`${TT_G.char.name} levou a melhor desta vez. Quer revanche?`;
  }
  
  score.textContent=TT_G.score.hu+' × '+TT_G.score.ai;
  // Save match to server DB
  try{
    const dur=_gameStart?Math.round((Date.now()-_gameStart)/1000):undefined;
    if(typeof saveMatchToServer==='function')saveMatchToServer(hw?'win':'lose',TT_G.score.hu+'×'+TT_G.score.ai,TT_G.char.name,TT_G.char.av,dur,TT_G.score.hu,TT_G.score.ai);
  }catch(e){console.warn('saveMatchToServer error',e);}
  document.getElementById('go-rws').innerHTML=
    '<div class="go-rw"><div class="go-rv">+'+xpG+'</div><div class="go-rl">XP</div></div>'+
    '<div class="go-rw"><div class="go-rv">🪙+'+coinsG+'</div><div class="go-rl">Moedas</div></div>'+
    '<div class="go-rw"><div class="go-rv">'+TT_P.streak+'v</div><div class="go-rl">Sequência</div></div>'+
    '<div class="go-rw"><div class="go-rv">'+newElo+'</div><div class="go-rl">ELO '+(newElo-myElo>=0?'+':'')+(newElo-myElo)+'</div></div>';
  setTimeout(()=>modal.classList.remove('hidden'),500);
  // Achievements check
  setTimeout(()=>checkAchievements(),800);
  // Supabase sync
  setTimeout(()=>sbSavePlayer(),1200);
}
// ══════════════════════════════════════════════════════════════
//  GAME STATE
// ══════════════════════════════════════════════════════════════
let TT_G={};
let _tt=null;

/* ──── ENVIDO SCORING RULES ────
  Chain: envido → real_envido → falta_envido

  Refuse points (to CHALLENGER):
    envido direct            → 1pt
    real_envido direct       → 1pt
    real_envido after envido → 2pts
    falta after real         → 5pts
    falta direct             → 1pt
    envido_envido            → 2pts

  Accept bet (accumulated):
    envido                   → 2pts
    real_envido direct       → 3pts
    envido+real              → 5pts
    falta_envido             → target - max(score)
*/
function envRefusePts(){
  const chain=TT_G.envChain;
  if(!chain||!chain.length)return 1;
  const last=chain[chain.length-1];
  if(last==='falta_envido') return chain.length>=2?5:1;
  if(last==='real_envido')  return chain.length>=2?2:1;
  if(last==='envido_envido')return 2;
  return 1; // envido direct
}
function florRefusePts(){
  const last=TT_G.florChain[TT_G.florChain.length-1];
  if(last==='contra_flor_resto') return 6;
  if(last==='contra_flor')       return 3;
  return 3;
}

// ══════════════════════════════════════════════════════════════
//  UI HELPERS
// ══════════════════════════════════════════════════════════════
function show(id){
  document.querySelectorAll('.scr').forEach(s=>{s.classList.remove('on');s.style.removeProperty('display');});
  var _showEl=document.getElementById(id);
  if(!_showEl){console.warn('show(): screen not found:',id);return;}
  _showEl.style.removeProperty('display');
  _showEl.classList.add('on');
  if(id!=='game'){const t=document.getElementById('first-tip');if(t)t.classList.add('hidden');}
  if(id==='home')renderHome();
  if(id==='profile-scr')renderProfile();
  if(id==='online-lobby'){const _onm=document.getElementById('online-nm');if(_onm)_onm.value=TT_P.name;}
  SFX.click();
}

function toggleAISection(){
  // Guard: exige login para jogar
  const _lu = JSON.parse(localStorage.getItem('truco_local_user') || 'null');
  if (!_lu) {
    window._pendingGameChar = 'ai-section';
    openModal('m-auth');
    laShowScreen('la-login');
    const infoEl = document.getElementById('la-login-info');
    if (infoEl) { infoEl.textContent = 'Faça login para começar a jogar e registrar suas partidas!'; infoEl.classList.remove('hidden'); }
    return;
  }
  const s=document.getElementById('ai-section');
  s.style.display=s.style.display==='none'?'block':'none';
  if(s.style.display==='block')renderChars();
  SFX.click();
}

function toast(msg,type='info',dur=3200){
  const t=document.getElementById('toast');
  t.textContent=msg;t.className='toast '+type;
  if(_tt)clearTimeout(_tt);_tt=setTimeout(()=>t.classList.add('hidden'),dur);
}

// ── Notificação de Desafio Online ──
function playTrucoChallengeSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    // Sequência de notas: "Tru-co!" (3 beeps rápidos)
    const notes = [440, 554, 659]; // Lá, Dó#, Mi
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.12);
      gain.gain.setValueAtTime(0.35, ctx.currentTime + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.18);
      osc.start(ctx.currentTime + i * 0.12);
      osc.stop(ctx.currentTime + i * 0.12 + 0.2);
    });
    // Nota final mais longa
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.connect(gain2); gain2.connect(ctx.destination);
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(880, ctx.currentTime + 0.42);
    gain2.gain.setValueAtTime(0.4, ctx.currentTime + 0.42);
    gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.85);
    osc2.start(ctx.currentTime + 0.42);
    osc2.stop(ctx.currentTime + 0.9);
  } catch(e) { /* som não suportado */ }
}
function showChallengeNotification(msg) {
  // Criar banner animado
  const existing = document.getElementById('challenge-notif');
  if (existing) existing.remove();
  const notif = document.createElement('div');
  notif.id = 'challenge-notif';
  notif.innerHTML = `<span style="font-size:1.3rem">&#x1F91C;</span> <span style="font-weight:700">${msg}</span>`;
  notif.style.cssText = [
    'position:fixed', 'top:60px', 'left:50%', 'transform:translateX(-50%) translateY(-20px)',
    'background:linear-gradient(135deg,#7c3f00,#b8860b)', 'color:#ffe082',
    'padding:.6rem 1.4rem', 'border-radius:2rem', 'font-size:.8rem',
    'box-shadow:0 4px 20px rgba(0,0,0,.5)', 'z-index:9999',
    'transition:transform .35s cubic-bezier(.34,1.56,.64,1), opacity .35s',
    'opacity:0', 'pointer-events:none', 'text-align:center', 'white-space:nowrap'
  ].join(';');
  document.body.appendChild(notif);
  requestAnimationFrame(() => {
    notif.style.opacity = '1';
    notif.style.transform = 'translateX(-50%) translateY(0)';
  });
  setTimeout(() => {
    notif.style.opacity = '0';
    notif.style.transform = 'translateX(-50%) translateY(-20px)';
    setTimeout(() => notif.remove(), 400);
  }, 3500);
}
function addHist(msg){
  if(!TT_G.hist)TT_G.hist=[];TT_G.hist.unshift(msg);
  const el=document.getElementById('hist');
  el.innerHTML=TT_G.hist.slice(0,20).map(h=>`<div class="hi"><div class="hd"></div>${h}</div>`).join('');
}

function toggleHist(){
  const w=document.getElementById('hist-wrap');
  const expanded=w.classList.toggle('expanded');
  document.getElementById('hist-toggle').textContent=expanded?'▼':'▲';
}

function setPh(txt,cls){const el=document.getElementById('g-ph');el.textContent=txt;el.className='g-ph '+cls;}

function openModal(id){
  var el=document.getElementById(id);
  if(!el){console.warn('openModal: element not found:',id);return;}
  el.classList.remove('hidden');
  if(SFX&&SFX.click)SFX.click();
}
function closeModal(id){
  var el=document.getElementById(id);
  if(el)el.classList.add('hidden');
}

function updateManoIndicator(){
  const hu=TT_G.handMano==='hu';
  // Badge adversário (com glow quando é a mão)
  const mAi=document.getElementById('mano-ai');
  if(mAi){
    mAi.classList.toggle('hidden',hu);
    mAi.classList.toggle('glow',!hu);
  }
  // Crown header humano (com pulso quando é a mão)
  const mHu=document.getElementById('mano-hu-hdr');
  if(mHu){
    mHu.classList.toggle('hidden',!hu);
    mHu.classList.toggle('pulse',hu);
  }
  // Pill área do jogador
  const lbl=document.getElementById('mano-hu-label');
  if(lbl){lbl.style.display=hu?'inline-block':'none';lbl.textContent='👑 Você é a mão';}
  // Avatar mini no header
  const av=document.getElementById('opp-av-hdr');
  if(av&&TT_G.char)av.textContent=TT_G.char.av;
}

// ══════════════════════════════════════════════════════════════
//  HOME
// ══════════════════════════════════════════════════════════════
function renderHome(){
  TT_P.lv=lvlOf(TT_P.xp);
  document.getElementById('pb-name').textContent=TT_P.name;
  document.getElementById('pb-lv').textContent=TT_P.lv;
  document.getElementById('pb-wins').textContent=TT_P.wins+'v';
  document.getElementById('pb-coins').textContent='🪙'+TT_P.coins;
  const xc=TT_P.xp-xpFor(TT_P.lv), xn=xpFor(TT_P.lv+1)-xpFor(TT_P.lv);
  document.getElementById('pb-xp').style.width=Math.min(100,xc/xn*100)+'%';
  refreshHomeActiveRooms();
  refreshNotificationBadge();
}

const STYLE_TAGS={agressivo:'tag-agr',blefador:'tag-blf',conservador:'tag-con',malandro:'tag-mal',gauchesco:'tag-gau',online:'tag-gau'};

function renderChars(){
  const row=document.getElementById('char-row');row.innerHTML='';
  CHARS.forEach(ch=>{
    const ok=TT_P.unlocked.includes(ch.id);
    const stat=TT_P.charStats[ch.id]||{wins:0,losses:0};
    const dots=[1,2,3].map(i=>`<div class="dp${i<=ch.diff?' on':''}"></div>`).join('');
    const btn=document.createElement('div');
    btn.className='cc'+(ok?'':' lk');
    btn.innerHTML=`${!ok?`<span class="cc-lock">🔒${ch.need}v</span>`:''}
      <span class="cc-av">${ch.av}</span>
      <div class="cc-name">${ch.name}</div>
      <div class="cc-loc">${ch.loc}</div>
      <div class="cc-diff">${dots}</div>
      <span class="cc-tag ${STYLE_TAGS[ch.style]||''}">${ch.style}</span>
      ${ok&&(stat.wins+stat.losses)>0?`<span class="cc-stats">${stat.wins}v/${stat.losses}d</span>`:''}`;
    if(ok)btn.onclick=()=>{SFX.click();startGame(ch);};
    row.appendChild(btn);
  });
}

function saveName(){const v=document.getElementById('ni').value.trim();if(v){TT_P.name=v;saveP();renderProfile();renderHome();}}

// ══ Vinculação de Conta Google ══
async function loadGoogleLinkStatus() {
  const statusEl = document.getElementById('google-link-status');
  const actionsEl = document.getElementById('google-link-actions');
  if (!statusEl || !actionsEl) return;

  // Só mostra para usuários logados
  const user = window.localUser || (typeof AUTH !== 'undefined' ? AUTH.user : null);
  if (!user) {
    statusEl.innerHTML = '<span style="font-size:.75rem;color:var(--txt3)">Faça login para gerenciar vinculação</span>';
    return;
  }

  try {
    const status = await trpcQuery('auth.linkStatus');
    const googleSvg = `<svg width="16" height="16" viewBox="0 0 24 24" style="flex-shrink:0"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>`;

    if (status.googleLinked) {
      statusEl.innerHTML = `${googleSvg}<span style="font-size:.8rem;color:var(--green);font-weight:600">✓ Google vinculado</span><span style="font-size:.7rem;color:var(--txt3)">(${status.email || ''})</span>`;
      // Só mostra botão de desvincular se tiver PIN (método local)
      const localUser = window.localUser;
      const hasPin = localUser && localUser.loginMethod === 'local';
      if (hasPin) {
        actionsEl.innerHTML = `<button onclick="confirmUnlinkGoogle()" style="width:100%;background:transparent;border:1px solid var(--red);color:var(--red);padding:.4rem .75rem;border-radius:var(--r);cursor:pointer;font-size:.75rem;font-family:inherit">Desvincular Google</button>`;
      } else {
        actionsEl.innerHTML = `<div style="font-size:.7rem;color:var(--txt3)">Para desvincular, configure um PIN primeiro.</div>`;
      }
    } else {
      statusEl.innerHTML = `${googleSvg}<span style="font-size:.8rem;color:var(--txt2)">Google não vinculado</span>`;
      actionsEl.innerHTML = `<button onclick="linkWithGoogle()" style="width:100%;display:flex;align-items:center;justify-content:center;gap:.5rem;background:var(--surf2);border:1.5px solid var(--bdr2);color:var(--txt2);padding:.45rem .75rem;border-radius:var(--r);cursor:pointer;font-size:.78rem;font-weight:600;font-family:inherit">${googleSvg} Vincular com Google</button>`;
    }
  } catch (e) {
    statusEl.innerHTML = '<span style="font-size:.75rem;color:var(--txt3)">Não foi possível carregar status</span>';
  }
}

async function linkWithGoogle() {
  try {
    const res = await trpcQuery('auth.loginUrl', { origin: window.location.origin });
    if (res && res.url) window.location.href = res.url;
  } catch (e) {
    toast('Erro ao iniciar vinculação. Tente novamente.', 'error');
  }
}

async function confirmUnlinkGoogle() {
  if (!confirm('Bah tchê, tem certeza que quer desvincular o Google? Você precisará do seu PIN para entrar.')) return;
  const btn = document.querySelector('#google-link-actions button');
  if (btn) { btn.disabled = true; btn.textContent = 'Desvinculando...'; }
  try {
    await trpcMutation('auth.unlinkGoogle', {});
    toast('Google desvinculado com sucesso!', 'success');
    loadGoogleLinkStatus();
  } catch (e) {
    toast(e.message || 'Erro ao desvincular. Tente novamente.', 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Desvincular Google'; }
  }
}

// ══════════════════════════════════════════════════════════════
//  START GAME
// ══════════════════════════════════════════════════════════════
function restartGame(){
  // Limpar confete ao reiniciar
  const confetti=document.getElementById('go-confetti');
  if(confetti)confetti.innerHTML='';
  closeModal('m-go');
  startGame(TT_G.char);
}
function goToLobby(){
  // Limpar confete e ir ao lobby
  const confetti=document.getElementById('go-confetti');
  if(confetti)confetti.innerHTML='';
  const modal=document.getElementById('m-go');
  if(modal)modal.classList.add('hidden');
  show('home');
}

// ══════════════════════════════════════════════════════════════
//  RENDER
// ══════════════════════════════════════════════════════════════
function renderScores(){
  ['ai','hu'].forEach(p=>{
    const el=document.getElementById('s-'+p);
    const prev=parseInt(el.textContent)||0;
    el.textContent=TT_G.score[p];
    if(TT_G.score[p]>prev){el.classList.remove('bump');void el.offsetWidth;el.classList.add('bump');}
  });
}
function renderPips(){
  ['pip0','pip1','pip2'].forEach((id,i)=>{
    const el=document.getElementById(id);const w=TT_G.rw[i];
    el.className='pip '+(w==='hu'?'hu':w==='ai'?'ai':w==='draw'?'dr':'');
  });
}
function renderAICards(){
  const row=document.getElementById('ai-bks');row.innerHTML='';
  for(let i=0;i<TT_G.aiHand.length;i++){
    const d=document.createElement('div');d.className='ai-bk';
    const img=document.createElement('img');img.src=CARD_BACK;img.alt='';
    d.appendChild(img);row.appendChild(d);
  }
}
function renderTable(){
  const at=document.getElementById('ai-tbl'), ht=document.getElementById('hu-tbl');
  at.innerHTML='';ht.innerHTML='';
  TT_G.table.forEach(({card,player})=>{
    const d=document.createElement('div');d.className='tc';
    const img=document.createElement('img');img.src=cimg(card);img.alt='';
    d.appendChild(img);(player==='ai'?at:ht).appendChild(d);
  });
}
function renderHand(){
  const hand=document.getElementById('p-hand');hand.innerHTML='';
  const can=TT_G.phase==='playing'&&TT_G.turn==='hu';
  TT_G.pHand.forEach((card,idx)=>{
    const d=document.createElement('div');
    d.className='hc'+(can?'':' dis')+(isMan(card.rank,card.suit)?' man':'');
    const valTxt=CFG&&CFG.showVals?` · valor de truco: ${card.tv}`:'';
    d.title=`${card.rank} de ${card.suit}${valTxt}`;
    d.setAttribute('aria-label',`${card.rank} de ${card.suit}${isMan(card.rank,card.suit)?' (manilha)':''}${valTxt}`);
    d.setAttribute('role','button'); 
    const img=document.createElement('img');img.src=cimg(card);img.alt='';
    d.appendChild(img);
    if(can)d.onclick=()=>humanPlay(idx);
    hand.appendChild(d);
  });
  document.getElementById('hhint').textContent=can?'Toque para jogar':'';
}
function renderSideBtns(){
  const sa=document.getElementById('sbtns');sa.innerHTML='';
  if(TT_G.phase!=='playing'||TT_G.turn!=='hu')return;
  const btns=[];
  if(TT_G.lastTruChal!=='hu'&&TT_G.truLvl<4){
    const nm={2:'Truco',3:'Retruco',4:'Vale 4'}[TT_G.truLvl+1];
    btns.push(`<button class="sb sb-truco" onclick="humanTruco()">🔥 ${nm}</button>`);
  }
  // REGRA: Envido e Flor SÓ na 1ª rodada
  // No truco gaúcho, a flor SUBSTITUI o envido. Se qualquer jogador tem flor,
  // o envido é bloqueado para ambos (anyoneHasFlor).
  const isFirstRound=TT_G.rw.length===0;
  const anyoneHasFlor=TT_G.hFlor.hu||TT_G.hFlor.ai;
  const canEnv=isFirstRound&&!TT_G.pfirst.hu&&!TT_G.envRes&&!anyoneHasFlor&&TT_G.florChal===null&&TT_G.lastEnvChal!=='hu';
  if(canEnv)btns.push(`<button class="sb sb-envido" onclick="openEnvidoPick()">🎯 Envido</button>`);
  // Flor: só o jogador que tem flor pode pedir, e apenas se ainda não foi chamada
  if(isFirstRound&&TT_G.hFlor.hu&&!TT_G.envRes&&TT_G.florChal===null)btns.push(`<button class="sb sb-flor" onclick="humanFlor('flor')">🌸 Flor!</button>`);
  btns.push(`<button class="sb sb-fold" onclick="humanFold()">🏳 Correr</button>`);
  sa.innerHTML=btns.join('');
}
function renderAll(){renderScores();renderPips();renderAICards();renderHand();renderTable();renderSideBtns();}

// ══════════════════════════════════════════════════════════════
//  HUMAN ACTIONS
// ══════════════════════════════════════════════════════════════
function openEnvidoPick(){
  stopTimer();SFX.envido();
  document.getElementById('mep-pts').textContent=TT_G.envPts.hu;
  const target=TT_G.target,maxSc=Math.max(TT_G.score.ai,TT_G.score.hu);
  const falta=Math.max(1,target-maxSc), prev=TT_G.envBet;
  const last=TT_G.envChain[TT_G.envChain.length-1];
  const btn=(action,label,apts,rpts)=>
    `<button class="mb mb-raise" onclick="humanEnvido('${action}');closeModal('m-env-pick')">
      ${label}<span class="mb-note">Aceito: ${apts}pts · Recusado: ${rpts}pt${rpts>1?'s':''} para você</span>
    </button>`;
  let html='';
  if(!last){
    html+=btn('envido','Envido',2,1);
    html+=btn('real_envido','Real Envido',3,1);
    html+=btn('falta_envido',`Falta Envido (${falta}pts)`,falta,1);
  }else if(last==='envido'){
    html+=btn('real_envido','Real Envido',prev+3,2);
    html+=btn('falta_envido',`Falta Envido (${falta}pts)`,falta,2);
  }else if(last==='real_envido'){
    html+=btn('falta_envido',`Falta Envido (${falta}pts)`,falta,5);
  }
  html+=`<button class="mb mb-sec" onclick="closeModal('m-env-pick')">Cancelar</button>`;
  document.getElementById('mep-btns').innerHTML=html;
  openModal('m-env-pick');
}

function humanEnvido(action){
  if(TT_G.lastEnvChal==='hu')return;
  closeModal('m-env-pick');
  const pending=TT_G.phase==='truco_neg';
  const target=TT_G.target,maxSc=Math.max(TT_G.score.ai,TT_G.score.hu);
  const prev=TT_G.envBet;
  let newBet=action==='envido'?(prev===0?2:prev+2):action==='real_envido'?(prev===0?3:prev+3):Math.max(1,target-maxSc);
  TT_G.envChain.push(action);TT_G.envBet=newBet;
  TT_G.envChal='hu';TT_G.lastEnvChal='hu';TT_G.trucoPendEnv=pending;TT_G.turn='ai';TT_G.phase='envido_neg';
  addHist(`Você cantou ${action.replace(/_/g,' ')}! (${newBet}pts)`);
  showEnvidoReceived(action,newBet);
  setTimeout(aiRespondEnvido,1700);
}

function humanEnvidoFromTruco(action){closeModal('m-truco');TT_G.trucoPendEnv=true;humanEnvido(action);}

function humanFlor(action){
  if(TT_G.envRes)return;
  const pending=TT_G.phase==='truco_neg';
  const target=TT_G.target,maxSc=Math.max(TT_G.score.ai,TT_G.score.hu);
  let bet=action==='flor'?3:action==='contra_flor'?6:Math.max(1,target-maxSc);
  TT_G.florChain=[action];TT_G.flBet=bet;TT_G.florChal='hu';TT_G.trucoPendEnv=pending;TT_G.turn='ai';TT_G.phase='flor_neg';
  addHist(`Você cantou Flor!`);SFX.flor();
  renderSideBtns();bubbleSay('',true);setTimeout(aiRespondFlor,1500);
}

function humanFold(){
  if(TT_G.phase!=='playing'||TT_G.turn!=='hu')return;
  if(!confirm('Correr da mão? O bagual leva 1 ponto.'))return;
  stopTimer();SFX.lose();
  TT_G.score.ai=Math.min(TT_G.target,TT_G.score.ai+1);
  addHist('Você correu. Bagual +1pt.');toast('Você correu! Bagual +1 🏳','lose');
  renderScores();if(TT_G.score.ai>=TT_G.target){endGame('ai');return;}
  setTimeout(deal,1200);
}

// ══════════════════════════════════════════════════════════════
//  TRUCO MODAL (human receives)
// ══════════════════════════════════════════════════════════════
function showTrucoModal(){
  SFX.truco();
  const lvl=TT_G.truLvl;
  document.getElementById('mt-ttl').textContent=TT_TN[lvl]+'!';
  const fuga=lvl===2?1:TT_TP[lvl-1];
  document.getElementById('mt-stakes').innerHTML=`<strong>${TT_TP[lvl]} pontos</strong> em jogo · Recusar custa ${fuga}pt`;
  const target=TT_G.target,maxSc=Math.max(TT_G.score.ai,TT_G.score.hu);
  const falta=Math.max(1,target-maxSc);
  const canRaise=TT_G.truChal==='ai'&&lvl<4;
  // No truco gaúcho, flor substitui envido — bloquear se qualquer jogador tem flor
  const anyoneHasFlor2=TT_G.hFlor.hu||TT_G.hFlor.ai;
  const canEnv=TT_G.rw.length===0&&!TT_G.envRes&&!TT_G.pfirst.hu&&!anyoneHasFlor2&&TT_G.florChal===null;
  let html=`<div class="mb-row">
    <button class="mb mb-yes" onclick="acceptTruco()">Quero!</button>
    <button class="mb mb-no" onclick="refuseTruco()">Correr (${fuga}pt)</button>
  </div>`;
  if(canRaise)html+=`<button class="mb mb-raise" onclick="humanRaiseTruco(${lvl+1})">⬆ ${TT_TN[lvl+1]}!</button>`;
  if(canEnv){
    html+=`<hr class="divider"><div class="sec-mini">Pedir Envido antes de responder:</div>
    <div class="mb-row">
      <button class="mb mb-sec" style="font-size:.7rem" onclick="humanEnvidoFromTruco('envido')">Envido<span class="mb-note">2pts aceito · 1pt recusado</span></button>
      <button class="mb mb-sec" style="font-size:.7rem" onclick="humanEnvidoFromTruco('real_envido')">Real Env.<span class="mb-note">3pts aceito · 1pt recusado</span></button>
      <button class="mb mb-sec" style="font-size:.7rem" onclick="humanEnvidoFromTruco('falta_envido')">Falta Env.<span class="mb-note">${falta}pts aceito · 1pt recusado</span></button>
    </div>`;
  }
  document.getElementById('mt-btns').innerHTML=html;
  openModal('m-truco');setPh('🔥 '+TT_TN[lvl],'ph-truco');
}

function acceptTruco(){
  closeModal('m-truco');SFX.click();
  addHist(`Você aceitou o ${TT_TN[TT_G.truLvl]}!`);toast(`${TT_TN[TT_G.truLvl]} aceito! 🔥`,'info');
  let nt=TT_G.truChal;
  // Se turno iria para IA mas ela já jogou nesta rodada, passa para humano
  if(nt==='ai'&&TT_G.pfirst&&TT_G.pfirst.ai&&TT_G.table&&TT_G.table.some(t=>t.player==='ai'))nt='hu';
  TT_G.phase='playing';TT_G.turn=nt;
  renderAll();setPh(nt==='hu'?'▶ Sua vez':'⏳ Bagual pensa...',nt==='hu'?'ph-play':'ph-wait');
  if(nt==='hu')startTimer();else setTimeout(aiTurn,aiDelay(900));
}

function refuseTruco(){
  closeModal('m-truco');SFX.lose();
  const winner=TT_G.truChal,pts=TT_G.truLvl===2?1:TT_TP[TT_G.truLvl-1];
  TT_G.score[winner]+=pts;
  addHist(`Você correu do ${TT_TN[TT_G.truLvl]}. ${winner==='hu'?'Você':'Bagual'} +${pts}pt`);
  toast(winner==='hu'?`Truco seu! +${pts} 🏆`:`Bagual leva ${pts}pt 🏳`,winner==='hu'?'win':'lose');
  renderScores();if(TT_G.score[winner]>=TT_G.target){endGame(winner);return;}
  setTimeout(deal,1200);
}

function humanRaiseTruco(lvl){
  closeModal('m-truco');SFX.truco();
  TT_G.truLvl=lvl;TT_G.truChal='hu';TT_G.lastTruChal='hu';TT_G.turn='ai';
  addHist(`Você subiu para ${TT_TN[lvl]}!`);bubbleSay('',true);setTimeout(aiRespondTruco,1500);
}

// ══════════════════════════════════════════════════════════════
//  ENVIDO MODALS
// ══════════════════════════════════════════════════════════════
function showEnvidoReceived(action,bet){
  const titles={envido:'Envido!',real_envido:'Real Envido!',falta_envido:'Falta Envido!'};
  document.getElementById('me-ttl').textContent=titles[action]||'Envido!';
  document.getElementById('me-sub').textContent=`Você cantou — ${TT_G.char.name} decide...`;
  document.getElementById('me-mypts').style.display='none';
  document.getElementById('me-stakes').innerHTML=`<strong>${bet}pts</strong> em jogo · aguardando resposta`;
  document.getElementById('me-btns').innerHTML=`
    <div style="text-align:center;padding:.8rem;color:var(--txt3);font-style:italic;font-size:.88rem">
      <span style="font-size:1.4rem">🤔</span><br>
      ${TT_G.char.name} está pensando<span class="tdots"><span class="tdot"></span><span class="tdot"></span><span class="tdot"></span></span>
    </div>`;
  openModal('m-envido');
}

function showEnvidoChallenge(action,bet){
  SFX.envido();
  const titles={envido:'Envido!',real_envido:'Real Envido!',falta_envido:'Falta Envido!',envido_envido:'Envido-Envido!'};
  document.getElementById('me-ttl').textContent=titles[action]||'Envido!';
  const refPts=envRefusePts();
  const target=TT_G.target,maxSc=Math.max(TT_G.score.ai,TT_G.score.hu),falta=Math.max(1,target-maxSc);
  const lastCall=TT_G.envChain[TT_G.envChain.length-1];
  const chainLen=TT_G.envChain.length;

  // Sub-título: indica se é pedido inicial ou aumento
  const isRaise=chainLen>1&&TT_G.lastEnvChal==='ai';
  document.getElementById('me-sub').textContent=isRaise
    ?`${TT_G.char.name} subiu — sua vez de responder`
    :`${TT_G.char.name} cantou`;

  // Mostrar pontos do jogador
  const myPtsEl=document.getElementById('me-mypts');
  myPtsEl.style.display='block';
  myPtsEl.innerHTML=`Seus pontos de envido: <strong>${TT_G.envPts.hu}</strong>`;

  // Stakes
  document.getElementById('me-stakes').innerHTML=`<strong>${bet}pts</strong> em jogo · Recusar = ${refPts}pt${refPts>1?'s':''} pro ${TT_G.char.name}`;

  // Botões: aceitar / recusar sempre disponíveis
  let html=`<div class="mb-row">
    <button class="mb mb-yes" onclick="resolveEnvido(true);closeModal('m-envido')">✅ Quero!</button>
    <button class="mb mb-no" onclick="resolveEnvido(false);closeModal('m-envido')">Correr (-${refPts}pt${refPts>1?'s':''})</button>
  </div>`;

  // Opções de aumento (só quando é a IA que cantou / subiu)
  if(TT_G.lastEnvChal==='ai'){
    if(lastCall==='envido'){
      // Pode subir para Real Envido ou Falta Envido
      html+=`<hr class="divider"><div class="sec-mini">⬆️ Aumentar:</div>
        <button class="mb mb-raise" onclick="humanCounter('real_envido');closeModal('m-envido')">
          Real Envido!
          <span class="mb-note">${bet+3}pts em jogo · se recusado = 2pts para você</span>
        </button>
        <button class="mb mb-raise" onclick="humanCounter('falta_envido');closeModal('m-envido')">
          Falta Envido!
          <span class="mb-note">${falta}pts em jogo · se recusado = 2pts para você</span>
        </button>`;
    }else if(lastCall==='real_envido'){
      // Só pode subir para Falta Envido
      html+=`<hr class="divider"><div class="sec-mini">⬆️ Aumentar:</div>
        <button class="mb mb-raise" onclick="humanCounter('falta_envido');closeModal('m-envido')">
          Falta Envido!
          <span class="mb-note">${falta}pts em jogo · se recusado = 5pts para você</span>
        </button>`;
    }
    // Se já é Falta Envido, não há mais como aumentar
  }

  document.getElementById('me-btns').innerHTML=html;
  openModal('m-envido');
}

function humanCounter(action){
  // Jogador aumenta o envido da IA
  TT_G.lastEnvChal='hu';TT_G.envChal='hu';
  const target=TT_G.target,maxSc=Math.max(TT_G.score.ai,TT_G.score.hu);
  const falta=Math.max(1,target-maxSc);
  const newBet=action==='real_envido'?TT_G.envBet+3:action==='falta_envido'?falta:TT_G.envBet+2;
  TT_G.envChain.push(action);TT_G.envBet=newBet;TT_G.turn='ai';
  addHist(`Você subiu para ${action.replace(/_/g,' ')}! (${newBet}pts)`);
  SFX.envido();
  // Mostrar modal de espera enquanto a IA decide
  showEnvidoReceived(action,newBet);
  setTimeout(aiRespondEnvido,1700);
}

// ══════════════════════════════════════════════════════════════
//  ENVIDO RESOLVE
// ══════════════════════════════════════════════════════════════
function afterEnvido(nextPhase,nextTurn){
  if(nextPhase==='truco_neg'){
    TT_G.phase='truco_neg';TT_G.turn=nextTurn;
    if(nextTurn==='hu'){showTrucoModal();}
    else{bubbleSay('',true);setTimeout(aiRespondTruco,1100);}
  }else{
    // Correção: se o nextTurn já jogou carta nesta rodada, passa para o outro
    // Isso acontece quando o envido é cantado DEPOIS que a mão já jogou sua carta
    const aiAlreadyPlayed=TT_G.table.some(t=>t.player==='ai');
    const huAlreadyPlayed=TT_G.table.some(t=>t.player==='hu');
    if(nextTurn==='ai'&&aiAlreadyPlayed) nextTurn='hu';
    else if(nextTurn==='hu'&&huAlreadyPlayed) nextTurn='ai';
    TT_G.phase='playing';TT_G.turn=nextTurn;
    renderAll();setPh(nextTurn==='hu'?'▶ Sua vez':'⏳ Bagual pensa...',nextTurn==='hu'?'ph-play':'ph-wait');
    if(nextTurn==='hu')startTimer();else setTimeout(aiTurn,aiDelay(900));
  }
}

// ══════════════════════════════════════════════════════════════
//  FLOR
// ══════════════════════════════════════════════════════════════
function showFlorChallenge(){
  SFX.flor();
  const target=TT_G.target,maxSc=Math.max(TT_G.score.ai,TT_G.score.hu),resto=Math.max(1,target-maxSc);
  document.getElementById('mf-ttl').textContent='Flor!';
  document.getElementById('mf-sub').textContent=`${TT_G.char.name} cantou Flor!`;
  document.getElementById('mf-stakes').innerHTML=`<strong>${TT_G.flBet}pts</strong> em jogo · Recusar = ${florRefusePts()}pts pro bagual`;
  let html=`<div class="mb-row">
    <button class="mb mb-yes" onclick="resolveFlor(true);closeModal('m-flor')">Quero!</button>
    <button class="mb mb-no" onclick="resolveFlor(false);closeModal('m-flor')">Não quero (−${florRefusePts()}pts)</button>
  </div>`;
  if(TT_G.hFlor.hu){
    html+=`<hr class="divider"><div class="sec-mini">Você também tem Flor!</div>
      <button class="mb mb-raise" onclick="humanFlor('contra_flor');closeModal('m-flor')">Contra-Flor!<span class="mb-note">6pts em jogo · recusado = 3pts para você</span></button>
      <button class="mb mb-raise" onclick="humanFlor('contra_flor_resto');closeModal('m-flor')">Contra-Flor e o Resto!<span class="mb-note">${resto}pts em jogo · recusado = 6pts para você</span></button>`;
  }
  document.getElementById('mf-btns').innerHTML=html;
  openModal('m-flor');
}

function resolveFlor(accept){
  closeModal('m-flor');
  const nextPhase=TT_G.trucoPendEnv?'truco_neg':'playing';
  const nextTurn=TT_G.trucoPendEnv?(TT_G.truChal==='hu'?'ai':'hu'):TT_G.handMano;
  if(accept){
    SFX.reveal();
    const winner=TT_G.envPts.hu>TT_G.envPts.ai?'hu':TT_G.envPts.ai>TT_G.envPts.hu?'ai':TT_G.handMano;
    TT_G.score[winner]+=TT_G.flBet;TT_G.envRes=true;
    addHist(`${winner==='hu'?'Você':'Bagual'} ganhou a Flor! +${TT_G.flBet}pts`);
    toast(winner==='hu'?`Flor sua! +${TT_G.flBet} 🌸`:`Bagual ganhou a Flor +${TT_G.flBet}`,winner==='hu'?'win':'lose');
    renderScores();if(TT_G.score[winner]>=TT_G.target){endGame(winner);return;}
  }else{
    const winner=TT_G.florChal,pts=florRefusePts();
    TT_G.score[winner]+=pts;TT_G.envRes=true;
    addHist(`Flor não-querida. ${winner==='hu'?'Você':'Bagual'} +${pts}pts`);
    toast(winner==='hu'?`Flor sua! +${pts} 🌸`:`Bagual leva Flor +${pts}`,winner==='hu'?'win':'lose');
    SFX.click();renderScores();if(TT_G.score[winner]>=TT_G.target){endGame(winner);return;}
  }
  // Se turno iria para IA mas ela já jogou nesta rodada, passa para humano
  if(nextTurn==='ai'&&TT_G.pfirst&&TT_G.pfirst.ai&&TT_G.table&&TT_G.table.some(t=>t.player==='ai'))nextTurn='hu';
  TT_G.phase=nextPhase==='truco_neg'?'truco_neg':'playing';TT_G.turn=nextTurn;
  renderAll();setPh(nextTurn==='hu'?'▶ Sua vez':'⏳ Bagual pensa...',nextTurn==='hu'?'ph-play':'ph-wait');
  if(nextTurn==='hu')startTimer();else setTimeout(aiTurn,aiDelay(900));
}

// ══════════════════════════════════════════════════════════════
//  ROUND / HAND
// ══════════════════════════════════════════════════════════════
function handWinner(){
  // Regras de desempate do Truco Gaúcho
  // Ganha quem vencer 2 rodadas. Em caso de empate, mano vence.
  const rw=TT_G.rw,m=TT_G.handMano;
  const w={hu:0,ai:0,draw:0};rw.forEach(r=>w[r]++);const n=rw.length;
  if(w.hu>=2&&w.hu>w.ai)return'hu';
  if(w.ai>=2&&w.ai>w.hu)return'ai';
  if(n===2){
    if(rw[0]==='draw'&&rw[1]!=='draw')return rw[1];  // empate 1ª → vence 2ª
    if(rw[0]!=='draw'&&rw[1]==='draw')return rw[0];  // venceu 1ª, empate 2ª → vence 1ª
    return null; // draw,draw → joga 3ª
  }
  if(n===3){
    if(rw.every(r=>r==='draw'))return m;              // tudo empatado → mano
    if(rw[0]==='draw'&&rw[1]==='draw')return rw[2]!=='draw'?rw[2]:m;
    if(rw[2]==='draw'){
      // 3ª empatada: vence o primeiro resultado não-empatado
      const first=rw.find(r=>r!=='draw');
      return first||m;
    }
    if(rw[0]==='draw')return rw[1]!=='draw'?rw[1]:rw[2];
    return w.hu>w.ai?'hu':'ai';
  }
  return null;
}

// ══════════════════════════════════════════════════════════════
//  AI LOGIC — with card memory
// ══════════════════════════════════════════════════════════════
function slang(){return TT_G.char.slangs[Math.floor(Math.random()*TT_G.char.slangs.length)];}

/**
 * Sugestão 8: Cálculo adaptativo de agressividade da IA.
 * Combina personalidade fixa do personagem com ajustes dinâmicos baseados em:
 * - Diferença de placar (mais agressivo quando perde)
 * - Proximidade do fim (mais agressivo perto de 12 tentos)
 * - Rodada atual (mais agressivo na 3ª rodada)
 * - Histórico de blefes na mão atual
 */
function aiAdaptiveAggression(){
  const ch=TT_G.char;
  const scoreDiff=TT_G.score.ai-TT_G.score.hu;  // positive = AI winning
  const aiNearWin=TT_G.score.ai>=TT_G.target-3;
  const huNearWin=TT_G.score.hu>=TT_G.target-3;
  const rnd=TT_G.rw.length; // 0=1ª rodada, 1=2ª, 2=3ª
  const aiWins=TT_G.rw.filter(r=>r==='ai').length;
  const huWins=TT_G.rw.filter(r=>r==='hu').length;

  // Base aggression from character personality
  let aggression=ch.bluff||0.3;

  // Losing badly: more aggressive (desperation)
  if(scoreDiff<=-4) aggression+=0.20;
  else if(scoreDiff<=-2) aggression+=0.10;

  // Winning comfortably: slightly more conservative
  if(scoreDiff>=4) aggression-=0.10;

  // Near win: push harder
  if(aiNearWin) aggression+=0.15;

  // Opponent near win: must act aggressively or accept loss
  if(huNearWin) aggression+=0.25;

  // 3rd round: all-in mentality
  if(rnd===2) aggression+=0.20;

  // Already winning this hand: can be conservative
  if(aiWins>huWins&&rnd>0) aggression-=0.10;

  // Already losing this hand: must fight back
  if(huWins>aiWins&&rnd>0) aggression+=0.15;

  // Clamp between 0.05 and 0.95
  return Math.min(0.95, Math.max(0.05, aggression));
}

function aiTurn(){
  if(TT_G.phase!=='playing'||TT_G.turn!=='ai')return;
  // Segurança: se a IA não tem cartas, a mão já deveria ter terminado
  if(!TT_G.aiHand||TT_G.aiHand.length===0)return;
  // Segurança: se a IA já jogou nesta rodada, passar turno para humano
  if(TT_G.table&&TT_G.table.some(t=>t.player==='ai')){
    TT_G.turn='hu';renderAll();setPh('▶ Sua vez','ph-play');startTimer();return;
  }
  bubbleSay('',true);
  setTimeout(()=>{
    if(TT_G.phase!=='playing'||TT_G.turn!=='ai')return;
    const ch=TT_G.char;
    // REGRA: Se o jogador já jogou carta nesta rodada, IA DEVE jogar também (sem cantar)
    const huAlreadyPlayed=TT_G.table.some(t=>t.player==='hu');
    if(huAlreadyPlayed){
      bubbleSay(slang());aiPlay(pickCard());return;
    }
    // IA é mano (joga primeiro) — pode cantar antes de jogar
    // REGRA: Envido e Flor SÓ na 1ª rodada
    if(TT_G.rw.length===0){
      if(TT_G.hFlor.ai&&!TT_G.envRes&&TT_G.florChal===null){bubbleSay(slang());aiCallFlor();return;}
      if(!TT_G.pfirst.ai&&!TT_G.envRes&&!TT_G.hFlor.ai&&TT_G.florChal===null&&TT_G.lastEnvChal!=='ai'){
        if(TT_G.envPts.ai>=ch.eThr){bubbleSay(slang());aiCallEnvido();return;}
      }
    }
    const canTru=TT_G.lastTruChal!=='ai'&&TT_G.truLvl<4;
    const strong=TT_G.aiHand.filter(c=>c.tv>=ch.tThr).length;
    const hasMan=TT_G.aiHand.some(c=>c.tv>=11);
    // Sugestão 8: Use adaptive aggression instead of static bluff probability
    const adaptiveAgg=aiAdaptiveAggression();
    const shouldTru=hasMan||(strong>=2)||(Math.random()<adaptiveAgg);
    // Truco call probability also scales with aggression
    const trucoCallProb=0.30+adaptiveAgg*0.25;  // range: ~0.32 to ~0.54
    if(canTru&&shouldTru&&Math.random()<trucoCallProb){bubbleSay(slang());aiCallTruco();return;}
    bubbleSay(slang());aiPlay(pickCard());
  },1100);
}

function pickCard(){
  const hand=TT_G.aiHand;
  const huCard=TT_G.table.find(t=>t.player==='hu');
  const aiWins=TT_G.rw.filter(r=>r==='ai').length;
  const huWins=TT_G.rw.filter(r=>r==='hu').length;
  const rnd=TT_G.rw.length;

  if(huCard){
    // Beat if possible with weakest winning card
    const winners=[...hand].filter(c=>c.tv>huCard.card.tv).sort((a,b)=>a.tv-b.tv);
    if(winners.length)return winners[0];
    // Can't beat — lose with weakest
    return [...hand].sort((a,b)=>a.tv-b.tv)[0];
  }

  // AI goes first — use context
  if(rnd===0){
    // First round: play medium card, save manilhas
    const noMan=[...hand].filter(c=>c.tv<11).sort((a,b)=>a.tv-b.tv);
    return noMan.length?noMan[Math.floor(noMan.length/2)]:hand[0];
  }
  if(huWins>aiWins||rnd===2){
    // Need to win — play strongest
    return [...hand].sort((a,b)=>b.tv-a.tv)[0];
  }
  // Safe to play weak
  return [...hand].sort((a,b)=>a.tv-b.tv)[0];
}

function aiRespondTruco(){
  if(TT_G.phase!=='truco_neg'&&TT_G.phase!=='envido_neg')return;
  // IA só responde quando o humano cantou (truChal='hu'). Se a IA cantou, não faz nada.
  if(TT_G.truChal==='ai')return;
  const ch=TT_G.char;
  const strong=TT_G.aiHand.filter(c=>c.tv>=ch.tThr).length;
  const hasMan=TT_G.aiHand.some(c=>c.tv>=11);
  const aiWins=TT_G.rw.filter(r=>r==='ai').length;
  const accept=hasMan||(strong>=2)||(aiWins>=1&&strong>=1)||TT_G.bluffing;
  bubbleSay(slang());
  // Sugestão 8: adaptive raise probability
  const raiseProb=0.15+aiAdaptiveAggression()*0.20;
  if(accept&&TT_G.truLvl<4&&TT_G.truChal==='hu'&&Math.random()<raiseProb&&!TT_G.bluffing){
    const lvl=TT_G.truLvl+1;TT_G.truLvl=lvl;TT_G.truChal='ai';TT_G.lastTruChal='ai';TT_G.turn='hu';
    addHist(`${TT_G.char.name} subiu para ${TT_TN[lvl]}!`);SFX.truco();showTrucoModal();return;
  }
  closeModal('m-truco');
  if(accept){
    addHist(`${TT_G.char.name} aceitou o ${TT_TN[TT_G.truLvl]}!`);toast(`${TT_G.char.name} aceitou! 🔥`,'info');SFX.click();
    const nt=TT_G.truChal;TT_G.phase='playing';TT_G.turn=nt;
    renderAll();setPh(nt==='hu'?'▶ Sua vez':'⏳ Bagual pensa...',nt==='hu'?'ph-play':'ph-wait');
    if(nt==='hu')startTimer();else setTimeout(aiTurn,aiDelay(900));
  }else{
    const pts=TT_G.truLvl===2?1:TT_TP[TT_G.truLvl-1];TT_G.score.hu+=pts;
    addHist(`${TT_G.char.name} correu. Você +${pts}pt`);toast(`${TT_G.char.name} correu! Você +${pts} 🏆`,'win');SFX.win();
    renderScores();if(TT_G.score.hu>=TT_G.target){endGame('hu');return;}
    setTimeout(deal,1200);
  }
}

function aiRespondEnvido(){
  if(TT_G.phase==='game_over')return;
  // Só responde se ainda estiver em negociação de envido
  if(TT_G.phase!=='envido_neg')return;
  const pts=TT_G.envPts.ai,ch=TT_G.char;
  const last=TT_G.envChain[TT_G.envChain.length-1];
  const target=TT_G.target,maxSc=Math.max(TT_G.score.ai,TT_G.score.hu);
  const falta=Math.max(1,target-maxSc);

  // IA sobe de Envido para Real Envido se tiver pontos bons
  if(TT_G.lastEnvChal==='hu'&&last==='envido'&&pts>=28&&Math.random()<(ch.bluff||0.35)){
    const newBet=TT_G.envBet+3;
    TT_G.envChain.push('real_envido');TT_G.envBet=newBet;
    TT_G.envChal='ai';TT_G.lastEnvChal='ai';TT_G.turn='hu';
    addHist(`${TT_G.char.name} subiu para Real Envido! (${newBet}pts)`);
    bubbleSay(slang());
    showEnvidoChallenge('real_envido',newBet);
    return;
  }

  // IA sobe de Real Envido para Falta Envido se tiver pontos muito bons
  if(TT_G.lastEnvChal==='hu'&&last==='real_envido'&&pts>=30&&Math.random()<(ch.bluff||0.25)){
    TT_G.envChain.push('falta_envido');TT_G.envBet=falta;
    TT_G.envChal='ai';TT_G.lastEnvChal='ai';TT_G.turn='hu';
    addHist(`${TT_G.char.name} jogou Falta Envido! (${falta}pts)`);
    bubbleSay(slang());
    showEnvidoChallenge('falta_envido',falta);
    return;
  }

  // IA aceita ou recusa baseado nos pontos
  bubbleSay(slang());closeModal('m-envido');
  if(pts>=ch.eThr){resolveEnvido(true);}else{resolveEnvido(false);}
}

function aiCallFlor(){
  const target=TT_G.target,maxSc=Math.max(TT_G.score.ai,TT_G.score.hu),resto=Math.max(1,target-maxSc);
  TT_G.florChain=['flor'];TT_G.flBet=3;TT_G.florChal='ai';TT_G.turn='hu';TT_G.phase='flor_neg';
  addHist(`${TT_G.char.name} cantou Flor!`);
  showFlorChallenge();
}

function aiRespondFlor(){
  bubbleSay(slang());closeModal('m-flor');
  if(TT_G.hFlor.ai){
    if(TT_G.envPts.ai>34&&Math.random()<.4){
      TT_G.florChain.push('contra_flor');TT_G.flBet=6;TT_G.florChal='ai';TT_G.turn='hu';
      addHist(`${TT_G.char.name} chamou Contra-Flor!`);SFX.flor();showFlorChallenge();
    }else{resolveFlor(true);}
  }else{resolveFlor(false);}
}

// ══════════════════════════════════════════════════════════════
//  GAME OVER
// ══════════════════════════════════════════════════════════════
function shareResult(){
  const hw=TT_G.score.hu>=TT_G.target;
  const msg=`${hw?'Ganhei':'Perdi'} no Truco Tchê! ${TT_G.score.hu}×${TT_G.score.ai} contra ${TT_G.char.name} | Nível ${TT_P.lv} | ${TT_P.wins} vitórias 🤠🃏`;
  try{
    if(navigator.share)navigator.share({title:'Truco Tchê',text:msg}).catch(()=>copyText(msg));
    else copyText(msg);
  }catch(e){copyText(msg);}
}
function copyText(t){
  try{navigator.clipboard.writeText(t).then(()=>toast('Resultado copiado!','info'));}
  catch(e){prompt('Copie:',t);}
}

// ══════════════════════════════════════════════════════════════
//  SETTINGS & CONFIG
// ══════════════════════════════════════════════════════════════
const DEFAULT_CFG={sfx:true,ambient:false,dark:false,timer:30,showVals:true,speed:2,kbd:true};
let CFG={...DEFAULT_CFG};
function loadCfg(){try{const s=localStorage.getItem('truco_cfg');if(s)CFG={...DEFAULT_CFG,...JSON.parse(s)};}catch(e){}}
function saveCfg(){
  CFG.sfx=document.getElementById('cfg-sfx').checked;
  CFG.ambient=document.getElementById('cfg-amb').checked;
  CFG.timer=parseInt(document.getElementById('cfg-timer').value)||30;
  CFG.showVals=document.getElementById('cfg-vals').checked;
  CFG.speed=parseInt(document.getElementById('cfg-speed').value)||2;
  CFG.kbd=document.getElementById('cfg-kbd').checked;
  timerMax=CFG.timer;
  localStorage.setItem('truco_cfg',JSON.stringify(CFG));
}
function applyCfg(){
  const s=(id)=>document.getElementById(id);
  const set=(id,val)=>{const el=s(id);if(el)el.checked=val;};
  const setV=(id,val)=>{const el=s(id);if(el)el.value=val;};
  const setT=(id,val)=>{const el=s(id);if(el)el.textContent=val;};
  set('cfg-sfx',CFG.sfx);
  set('cfg-amb',CFG.ambient);
  set('cfg-dark',darkMode);
  setV('cfg-timer',CFG.timer);setT('cfg-timer-val',CFG.timer+'s');
  set('cfg-vals',CFG.showVals);
  setV('cfg-speed',CFG.speed);setT('cfg-speed-val',['Rápida','Normal','Lenta'][CFG.speed-1]);
  set('cfg-kbd',CFG.kbd);
  set('cfg-coach',CFG.coachMode||false);
  set('cfg-15',CFG.variant15||false);
  set('cfg-voice',CFG.voice||false);
  timerMax=CFG.timer;
}
function closeSettings(){document.getElementById('settings-overlay').classList.add('hidden');}

// Override SFX to respect cfg
const _sfx_orig={...SFX};
function sfx(fn){if(CFG.sfx&&_sfx_orig[fn])_sfx_orig[fn]();}
// Patch all SFX calls via proxy
Object.keys(SFX).forEach(k=>SFX[k]=(...a)=>{if(CFG.sfx)_sfx_orig[k](...a);});

// AI speed multiplier
function aiDelay(base){const spd=(CFG&&CFG.speed)||2;return base*[0.5,1,1.6][spd-1];}

// ══════════════════════════════════════════════════════════════
//  AMBIENT SOUND
// ══════════════════════════════════════════════════════════════
let ambCtx=null,ambNodes=[];
function startAmbient(){
  if(ambCtx)return;
  try{
    ambCtx=new (window.AudioContext||window.webkitAudioContext)();
    // Wind: filtered noise
    const buf=ambCtx.createBuffer(1,ambCtx.sampleRate*4,ambCtx.sampleRate);
    const d=buf.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;
    const src=ambCtx.createBufferSource();src.buffer=buf;src.loop=true;
    const filt=ambCtx.createBiquadFilter();filt.type='lowpass';filt.frequency.value=400;
    const gain=ambCtx.createGain();gain.gain.value=.04;
    src.connect(filt);filt.connect(gain);gain.connect(ambCtx.destination);
    src.start();ambNodes.push(src,gain);
    // Birds: occasional high chirps
    function bird(){
      if(!CFG.ambient){return;}
      const o=ambCtx.createOscillator(),g=ambCtx.createGain();
      o.connect(g);g.connect(ambCtx.destination);
      o.frequency.value=2400+Math.random()*800;o.type='sine';
      const t=ambCtx.currentTime;
      g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.06,t+.05);
      g.gain.exponentialRampToValueAtTime(.001,t+.3);
      o.start(t);o.stop(t+.35);
      setTimeout(bird,2000+Math.random()*5000);
    }
    setTimeout(bird,1500);
  }catch(e){}
}
function stopAmbient(){
  ambNodes.forEach(n=>{try{n.stop?n.stop():n.gain.setValueAtTime(0,ambCtx.currentTime);}catch(e){}});
  ambNodes=[];if(ambCtx){ambCtx.close();ambCtx=null;}
}
function toggleAmbient(){
  CFG.ambient=document.getElementById('cfg-amb').checked;
  if(CFG.ambient)startAmbient();else stopAmbient();
  saveCfg();
}

// ══════════════════════════════════════════════════════════════
//  KEYBOARD SHORTCUTS
// ══════════════════════════════════════════════════════════════
let kbdShown=false;
document.addEventListener('keydown',e=>{
  if(!CFG.kbd)return;
  const tag=document.activeElement.tagName;
  if(tag==='INPUT'||tag==='TEXTAREA')return;
  const scr=document.querySelector('.scr.on');
  if(!scr||scr.id!=='game')return;

  switch(e.key){
    case '1': if(TT_G.pHand[0]&&TT_G.phase==='playing'&&TT_G.turn==='hu')humanPlay(0);break;
    case '2': if(TT_G.pHand[1]&&TT_G.phase==='playing'&&TT_G.turn==='hu')humanPlay(1);break;
    case '3': if(TT_G.pHand[2]&&TT_G.phase==='playing'&&TT_G.turn==='hu')humanPlay(2);break;
    case 't': case 'T': if(TT_G.phase==='playing'&&TT_G.turn==='hu')humanTruco();break;
    case 'e': case 'E':
      if(TT_G.rw.length===0&&TT_G.phase==='playing'&&TT_G.turn==='hu'&&!TT_G.pfirst.hu&&!TT_G.envRes)openEnvidoPick();break;
    case 'f': case 'F':
      if(TT_G.rw.length===0&&TT_G.hFlor.hu&&!TT_G.envRes&&TT_G.florChal===null)humanFlor('flor');break;
    case 'Enter':
      // Accept current negotiation
      if(TT_G.phase==='truco_neg'&&TT_G.turn==='hu')acceptTruco();
      else if(TT_G.phase==='envido_neg'&&TT_G.turn==='hu'){resolveEnvido(true);closeModal('m-envido');}
      else if(TT_G.phase==='flor_neg'&&TT_G.turn==='hu'){resolveFlor(true);closeModal('m-flor');}
      break;
    case 'Escape':
      if(TT_G.phase==='truco_neg'&&TT_G.turn==='hu')refuseTruco();
      else if(TT_G.phase==='envido_neg'&&TT_G.turn==='hu'){resolveEnvido(false);closeModal('m-envido');}
      else if(TT_G.phase==='flor_neg'&&TT_G.turn==='hu'){resolveFlor(false);closeModal('m-flor');}
      break;
    case '?':
      toggleKbdHint();break;
  }
});

function toggleKbdHint(){
  let el=document.getElementById('kbd-hint');
  if(!el){
    el=document.createElement('div');el.id='kbd-hint';el.className='kbd-hint';
    el.innerHTML=`<strong>Atalhos:</strong><br>
      <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> Jogar carta &nbsp;
      <kbd>T</kbd> Truco &nbsp; <kbd>E</kbd> Envido &nbsp; <kbd>F</kbd> Flor<br>
      <kbd>Enter</kbd> Quero &nbsp; <kbd>Esc</kbd> Não quero &nbsp; <kbd>?</kbd> Fechar`;
    el.onclick=()=>el.remove();
    document.body.appendChild(el);
  }else{el.remove();}
}

// ══════════════════════════════════════════════════════════════
//  FIRST-PLAY TOOLTIP SYSTEM
// ══════════════════════════════════════════════════════════════
const TIPS=[
  {title:'Suas cartas 🃏',body:'Toque para jogar. As marcadas com ★ são as manilhas — as mais fortes!',target:'p-hand'},
  {title:'Truco! 🔥',body:'Clique aqui para gritar Truco e aumentar os pontos em jogo.',target:'sbtns'},
  {title:'Envido 🎯',body:'Antes da 1ª carta, peça Envido para disputar pontos extras.',target:'sbtns'},
  {title:'Placar 🏆',body:'Primeiro a 12 pontos vence! Acompanhe as rodadas pelos bolinhas acima.',target:'g-mid'},
];
let tipIdx=0;
function showTips(){
  if(TT_P.games>0||localStorage.getItem('truco_tips_done'))return;
  setTimeout(()=>showTip(0),1500);
}
function showTip(idx){
  // Só mostra na tela de jogo
  const gameScr=document.getElementById('game');
  if(!gameScr||!gameScr.classList.contains('on')){hideTips();return;}
  if(idx>=TIPS.length){hideTips();return;}
  tipIdx=idx;
  const tip=TIPS[idx];
  const cont=document.getElementById('first-tip');
  const box=document.getElementById('tip-box');
  if(!cont||!box)return;
  document.getElementById('tip-title').textContent=tip.title;
  document.getElementById('tip-body').textContent=tip.body;
  cont.classList.remove('hidden');
  const target=tip.target?document.getElementById(tip.target):null;
  if(target&&target.offsetWidth>0){
    const rect=target.getBoundingClientRect();
    let top=rect.top-120,left=rect.left;
    if(top<10)top=rect.bottom+12;
    if(top+110>window.innerHeight-10)top=window.innerHeight-120;
    left=Math.max(8,Math.min(left,window.innerWidth-218));
    box.style.cssText='top:'+top+'px;left:'+left+'px;position:fixed;transform:none;pointer-events:all';
    const arrow=document.getElementById('tip-arrow');
    if(arrow){
      arrow.style.top=(top>rect.top?rect.bottom+3:rect.top-17)+'px';
      arrow.style.left=(rect.left+rect.width/2-7)+'px';
      arrow.style.borderTopColor=top<rect.top?'transparent':'var(--gold-bdr)';
      arrow.style.borderBottomColor=top<rect.top?'var(--gold-bdr)':'transparent';
    }
  }else{
    box.style.cssText='top:50%;left:50%;position:fixed;transform:translate(-50%,-50%);pointer-events:all';
  }
}
function nextTip(){tipIdx++;if(tipIdx>=TIPS.length){const el=document.getElementById('first-tip');if(el){el.classList.add('hidden');el.style.display='none';}localStorage.setItem('truco_tips_done','1');return;}showTip(tipIdx);}
function hideTips(){
  const el=document.getElementById('first-tip');
  if(el){el.classList.add('hidden');const b=document.getElementById('tip-box');if(b)b.style.transform='';}
  localStorage.setItem('truco_tips_done','1');
}

// ══════════════════════════════════════════════════════════════
//  MATCH HISTORY
// ══════════════════════════════════════════════════════════════
function loadHistory(){try{return JSON.parse(localStorage.getItem('truco_hist')||'[]');}catch(e){return[];}}
// ══════════════════════════════════════════════════════════════
//  GAME SAVE / RESTORE
// ══════════════════════════════════════════════════════════════
let _gameStart=0;
function saveGameState(){
  if(TT_G.phase==='game_over'||!TT_G.char)return;
  try{localStorage.setItem('truco_save',JSON.stringify({G,ts:Date.now()}));}catch(e){}
}
function clearGameSave(){try{localStorage.removeItem('truco_save');}catch(e){}}
function checkSavedGame(){
  try{
    const s=localStorage.getItem('truco_save');
    if(!s)return false;
    const {G:savedG,ts}=JSON.parse(s);
    if(Date.now()-ts>3600000){clearGameSave();return false;} // expire after 1h
    if(confirm(`Partida inacabada encontrada contra ${savedG.char?.name||'adversário'}. Continuar?`)){
      Object.assign(TT_G,savedG);
      // Reload char from CHARS array
      const ch=CHARS.find(c=>c.id===TT_G.char.id)||TT_G.char;
      TT_G.char=ch;
      document.getElementById('g-ai-lbl').textContent=ch.name;
      document.getElementById('pr-ai-lbl').textContent=ch.name;
      document.getElementById('fz-ai-lbl').textContent=ch.name;
      document.getElementById('opp-av').textContent=ch.av;
      document.getElementById('opp-name').textContent=ch.name;
      document.getElementById('opp-sb').textContent=`${ch.loc} · ${ch.style}`;
      show('game');
      renderAll();updateManoIndicator();
      setPh(TT_G.turn==='hu'?'▶ Sua vez':'⏳ Bagual pensa...',TT_G.turn==='hu'?'ph-play':'ph-wait');
      if(TT_G.turn==='hu')startTimer();else setTimeout(aiTurn,aiDelay(1100));
      return true;
    }
    clearGameSave();
  }catch(e){clearGameSave();}
  return false;
}

// ══════════════════════════════════════════════════════════════
//  CONTEXTUAL AI PHRASES
// ══════════════════════════════════════════════════════════════
function ctxSlang(ctx){
  const ch=TT_G.char;
  const phrases={
    bluff:     ['Tô muito bem aqui...','Essa mão tá boa demais.','Não me testá!','Tenho carta boa, viu?','Confia no bagual...'],
    truco_win: ['Truco, marreco!','Aceita esse truco!','Tô confiante!','Vem que eu tô te esperando!'],
    round_win: ['Assim é fácil!','Boa rodada!','Era pra ser!','Sabia que ia ganhar!','Tô quente!'],
    round_lose:['Bah, que sorte...','Essa não era pra entrar.','Tô de olho em você.','Na próxima é minha.'],
    hand_win:  ['A mão é minha!','Bah, que mão boa!','Isso é truco de gaudério!','Glória ao bagual!'],
    hand_lose: ['Você foi bem...','Essa mão foi sua.','A sorte te ajudou hoje.','Vamos ver a próxima.'],
    envido_call:['Cantar envido é fácil quando se tem carta boa!','Envido no escuro!','Seus pontos não chegam nos meus.'],
    fold:      ['Correu? Fraco!','Isso não é jeito de gaudério.','Boa escolha, vivente...','Já vi que não aguenta.'],
    manilha:   ['★ Manilha na mesa!','Essa é minha maior!','Toma essa, chimango!','Viu a força do bagual?'],
  };
  const pool=phrases[ctx]||ch.slangs;
  // Mix with char slangs
  const combined=[...pool,...ch.slangs];
  return combined[Math.floor(Math.random()*combined.length)];
}

// ══════════════════════════════════════════════════════════════
//  TOURNAMENT MODE
// ══════════════════════════════════════════════════════════════
//  TOURNAMENT SYSTEM — with tRPC persistence
// ══════════════════════════════════════════════════════════════
let TOURNEY = { active: false, round: 0, opponents: [], coins: 0, dbId: null };
let _currentTourneyTab = 'piquetes';

// ── Tab switching ──
function switchTourneyTab(tab) {
  _currentTourneyTab = tab;
  ['piquetes','bracket','online','history'].forEach(t => {
    document.getElementById('tourney-panel-' + t).style.display = t === tab ? 'flex' : 'none';
    document.getElementById('tab-' + t).classList.toggle('active', t === tab);
  });
  document.getElementById('tourney-panel-piquetes').style.flexDirection = 'column';
  if (tab === 'history') loadTourneyHistory();
  if (tab === 'bracket') renderBracketInner();
  if (tab === 'online') loadOnlineTournaments();
}

// ── Start AI Tournament (Torneio dos Piquetes) ──
function startTournament() {
  const _lu = JSON.parse(localStorage.getItem('truco_local_user') || 'null');
  if (!_lu) {
    window._pendingGameChar = 'tournament';
    openModal('m-auth');
    laShowScreen('la-login');
    const infoEl = document.getElementById('la-login-info');
    if (infoEl) { infoEl.textContent = 'Faça login para participar do torneio!'; infoEl.classList.remove('hidden'); }
    return;
  }
  const pool = CHARS.filter(c => TT_P.unlocked.includes(c.id)).sort((a, b) => a.diff - b.diff);
  if (pool.length < 2) { toast('Desbloqueie mais personagens para o torneio!', 'info'); return; }
  const prizeCoins = pool.length * 100;
  TOURNEY = { active: true, round: 0, opponents: pool, prizeCoins, wins: 0, losses: 0, results: [], dbId: null };

  // Persist to server
  trpcMutation('tournament.startAI', {
    name: 'Torneio dos Piquetes',
    opponentIds: pool.map(c => c.id),
    prizeCoins,
  }).then(res => {
    if (res && res.tournamentId) TOURNEY.dbId = res.tournamentId;
  }).catch(e => console.warn('Tournament persist error:', e));

  renderTournament();
  show('tournament-scr');
  switchTourneyTab('piquetes');
}

function renderTournament() {
  const body = document.getElementById('tourney-body');
  const t = TOURNEY;
  if (!t.active) {
    body.innerHTML = '<p style="color:var(--txt3);padding:2rem;text-align:center">Nenhum torneio ativo.</p>' +
      '<button class="mb mb-yes" onclick="startTournament()" style="margin:.5rem auto;display:block">🏆 Iniciar Torneio</button>';
    return;
  }
  const rounds = t.opponents.map((ch, i) => {
    const done = i < t.round;
    const current = i === t.round;
    const won = t.results && t.results[i] === 'win';
    const score = t.scores && t.scores[i];
    return `<div style="display:flex;align-items:center;gap:.75rem;padding:.75rem;background:var(--surf);border:1.5px solid ${current ? 'var(--gold-bdr)' : done ? won ? 'var(--green-bdr)' : 'var(--red-bdr)' : 'var(--bdr)'};border-radius:var(--r2);margin-bottom:.5rem;opacity:${i > t.round ? .5 : 1}">
      <span style="font-size:1.6rem">${ch.av}</span>
      <div style="flex:1">
        <div style="font-weight:700;font-size:.85rem">${ch.name}</div>
        <div style="font-size:.62rem;color:var(--txt3)">${ch.loc} · ${'★'.repeat(ch.diff)}</div>
      </div>
      <div style="text-align:right">
        ${done ? `<div style="font-size:.75rem;font-weight:700;color:${won ? 'var(--green)' : 'var(--red)'}">${won ? 'Vitória ✓' : 'Derrota ✗'}</div>${score ? `<div style="font-size:.65rem;color:var(--txt3)">${score}</div>` : ''}` : ''}
        ${current ? `<button onclick="playTourneyRound()" style="background:var(--gold);color:#fff;border:none;padding:.4rem .9rem;border-radius:999px;cursor:pointer;font-size:.78rem;font-weight:700">Jogar</button>` : ''}
      </div>
    </div>`;
  }).join('');

  const pct = Math.round(t.round / t.opponents.length * 100);
  const isOver = t.round >= t.opponents.length;
  body.innerHTML = `
    <div style="background:var(--gold-bg);border:1px solid var(--gold-bdr);border-radius:var(--r2);padding:.85rem;margin-bottom:.9rem">
      <div style="font-size:.65rem;color:var(--txt3);letter-spacing:.1em;text-transform:uppercase;text-align:center">Torneio dos Piquetes</div>
      <div style="font-size:1.5rem;font-weight:900;color:var(--gold);font-family:Georgia,serif;margin:.2rem 0;text-align:center">${t.round}/${t.opponents.length} rodadas</div>
      <div style="background:var(--bdr);border-radius:999px;height:6px;margin:.4rem 0">
        <div style="background:var(--gold);height:6px;border-radius:999px;width:${pct}%;transition:width .4s"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:.7rem;color:var(--txt2)">
        <span>✅ ${t.wins} vitórias</span>
        <span>🪙 Prêmio: ${t.prizeCoins} moedas</span>
        <span>❌ ${t.losses || 0} derrotas</span>
      </div>
    </div>
    ${rounds}
    ${isOver ? `<div style="text-align:center;padding:1rem;background:var(--surf);border-radius:var(--r2);border:1.5px solid ${t.wins === t.opponents.length ? 'var(--gold-bdr)' : 'var(--bdr)'}">
      <div style="font-size:3rem">${t.wins === t.opponents.length ? '🏆' : '🎖️'}</div>
      <div style="font-size:1.1rem;font-weight:700;margin:.3rem 0">${t.wins === t.opponents.length ? 'Campeão do Pago!' : 'Torneio finalizado'}</div>
      <div style="color:var(--txt2);font-size:.8rem">${t.wins} vitórias de ${t.opponents.length}</div>
      <button onclick="startTournament()" class="mb mb-yes" style="margin-top:.8rem">🔄 Novo Torneio</button>
    </div>` : ''}`;
}

function playTourneyRound() {
  if (!TOURNEY.active || TOURNEY.round >= TOURNEY.opponents.length) return;
  const ch = TOURNEY.opponents[TOURNEY.round];
  TOURNEY.startScore = { ...P };
  startGame(ch);
  show('game');
}

// Hook into endGame for tournament
// ══════════════════════════════════════════════════════════════
//  OVERRIDE startGame TO TRACK TIME + SAVE + TIPS
// ══════════════════════════════════════════════════════════════
// Auto-save game state every move
const _origAiPlay=aiPlay;
// ══════════════════════════════════════════════════════════════
//  ENHANCED AI PHRASES — contextual
// ══════════════════════════════════════════════════════════════
// Override bubbleSay to use context in key moments

// Patch aiPlay to use contextual phrases
// Patch checkRound to give contextual feedback
// ══════════════════════════════════════════════════════════════
//  ENHANCED ONLINE — real state sync
// ══════════════════════════════════════════════════════════════
// Deterministic deck from seed
function seededRandom(seed){
  let s=seed;
  return ()=>{s=(s*1664525+1013904223)&0xffffffff;return(s>>>0)/0xffffffff;};
}
function makeDeckSeeded(seed){
  const rng=seededRandom(seed);
  const d=[];
  for(const s of SUITS)for(const r of RANKS)d.push({id:`${r}-${s}`,rank:r,suit:s,tv:tv(r,s),ev:ev(r)});
  // Fisher-Yates with seeded rng
  for(let i=d.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[d[i],d[j]]=[d[j],d[i]];}
  return d;
}


// Enhanced handleNet for real game sync
// Override humanPlay for online to also send move
// Send chat message


// ══════════════════════════════════════════════════════════════
//  PWA SERVICE WORKER REGISTRATION
// ══════════════════════════════════════════════════════════════
function registerSW(){
  if('serviceWorker' in navigator){
    // Inline SW via blob URL since we're a single HTML file
    const swCode=`
const CACHE='truco-v6';
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.add(location.href)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request))));`;
    try{
      const blob=new Blob([swCode],{type:'application/javascript'});
      const url=URL.createObjectURL(blob);
      navigator.serviceWorker.register(url).catch(()=>{});
    }catch(e){}
  }
}

// ══════════════════════════════════════════════════════════════
//  ACCESSIBILITY — aria labels
// ══════════════════════════════════════════════════════════════
function applyA11y(){
  // Add aria-labels to key elements
  const hand=document.getElementById('p-hand');
  if(hand)hand.setAttribute('aria-label','Suas cartas');
  const aiTbl=document.getElementById('ai-tbl');
  if(aiTbl)aiTbl.setAttribute('aria-label','Cartas do adversário na mesa');
  const huTbl=document.getElementById('hu-tbl');
  if(huTbl)huTbl.setAttribute('aria-label','Suas cartas na mesa');
}

// ══════════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════════
loadP();loadCfg();applyTheme();applyCfg();renderHome();registerSW();
// Check for saved game
window.addEventListener('load',()=>{
  applyA11y();
  if(!checkSavedGame()){
    // Normal init
  }
});


// ─── BLOCK 2 ───
// ══════════════════════════════════════════════════════════════════════
//  INTERNACIONALIZAÇÃO (i18n)
// ══════════════════════════════════════════════════════════════════════
const LANGS = {
  'pt-BR': {
    ranking:'Ranking Global', achievements:'Conquistas', settings:'Configurações',
    yourTurn:'▶ Sua vez', aiThinking:'⏳ Bagual pensa...', draw:'Empate na rodada.',
    youWonRound:'Você ganhou a rodada.', aiWonRound:'Bagual ganhou a rodada.',
    youWonHand:'Você ganhou a mão!', aiWonHand:'Bagual ganhou a mão!',
    wantIt:'Quero!', dontWant:'Não quero', run:'Correr',
    envido:'Envido', realEnvido:'Real Envido', faltaEnvido:'Falta Envido',
    flor:'Flor!', contraFlor:'Contra-Flor!',
    truco:'Truco!', retruco:'Retruco!', vale4:'Vale Quatro!',
    youWon:'Ganhou!', youLost:'Perdeu...', revenge:'Revanche!', lobby:'Lobby',
    mano:'MÃO', youAreMano:'👑 Você é a mão',
    timeUp:'Tempo esgotado! Carta automática.',
    welcome:'Buenas, vivente!',
  },
  'es': {
    ranking:'Ranking Global', achievements:'Logros', settings:'Configuración',
    yourTurn:'▶ Tu turno', aiThinking:'⏳ Pensando...', draw:'Empate en la ronda.',
    youWonRound:'Ganaste la ronda.', aiWonRound:'El rival ganó la ronda.',
    youWonHand:'¡Ganaste la mano!', aiWonHand:'¡El rival ganó la mano!',
    wantIt:'¡Quiero!', dontWant:'No quiero', run:'Huir',
    envido:'Envido', realEnvido:'Real Envido', faltaEnvido:'Falta Envido',
    flor:'¡Flor!', contraFlor:'¡Contraflor!',
    truco:'¡Truco!', retruco:'¡Retruco!', vale4:'¡Vale Cuatro!',
    youWon:'¡Ganaste!', youLost:'Perdiste...', revenge:'¡Revancha!', lobby:'Lobby',
    mano:'MANO', youAreMano:'👑 Eres el mano',
    timeUp:'¡Tiempo! Carta automática.',
    welcome:'¡Buenas, viviente!',
  },
  'en': {
    ranking:'Global Ranking', achievements:'Achievements', settings:'Settings',
    yourTurn:'▶ Your turn', aiThinking:'⏳ Thinking...', draw:'Round draw.',
    youWonRound:'You won the round.', aiWonRound:'Opponent won the round.',
    youWonHand:'You won the hand!', aiWonHand:'Opponent won the hand!',
    wantIt:"I'm in!", dontWant:'Pass', run:'Fold',
    envido:'Envido', realEnvido:'Real Envido', faltaEnvido:'Final Envido',
    flor:'Flor!', contraFlor:'Contra-Flor!',
    truco:'Truco!', retruco:'Retruco!', vale4:'Vale Four!',
    youWon:'You won!', youLost:'You lost...', revenge:'Rematch!', lobby:'Lobby',
    mano:'FIRST', youAreMano:'👑 You go first',
    timeUp:'Time up! Auto play.',
    welcome:'Good game!',
  }
};
const LANG_ORDER = ['pt-BR','es','en'];
let currentLang = localStorage.getItem('truco_lang') || 'pt-BR';

function t(key) { return (LANGS[currentLang]||LANGS['pt-BR'])[key] || key; }

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if(LANGS[currentLang]&&LANGS[currentLang][key]) el.textContent = LANGS[currentLang][key];
  });
}

function cycleLang() {
  const idx = LANG_ORDER.indexOf(currentLang);
  currentLang = LANG_ORDER[(idx+1) % LANG_ORDER.length];
  localStorage.setItem('truco_lang', currentLang);
  applyI18n();
  const labels = {'pt-BR':'🇧🇷','es':'🇦🇷','en':'🇺🇸'};
  toast(`Idioma: ${labels[currentLang]} ${currentLang}`, 'info');
}

// ══════════════════════════════════════════════════════════════════════
//  ELO RANKING SYSTEM
// ══════════════════════════════════════════════════════════════════════
const ELO_K = 32;
const DIVISIONS = [
  {name:'Peão',      min:0,    max:999,  cls:'div-peao',    icon:'🤠'},
  {name:'Tropeiro',  min:1000, max:1199, cls:'div-tropeiro', icon:'🐎'},
  {name:'Gaúcho',    min:1200, max:1399, cls:'div-gaucho',   icon:'⭐'},
  {name:'Gaudério',  min:1400, max:1599, cls:'div-gaudério', icon:'🌟'},
  {name:'Lenda do Pago', min:1600, max:9999, cls:'div-lenda',icon:'🏆'},
];

function getDivision(elo) {
  return DIVISIONS.slice().reverse().find(d => elo >= d.min) || DIVISIONS[0];
}

function calcElo(myElo, oppElo, won) {
  const expected = 1 / (1 + Math.pow(10, (oppElo - myElo) / 400));
  const score = won ? 1 : 0;
  return Math.round(myElo + ELO_K * (score - expected));
}

function getMyElo() { return parseInt(localStorage.getItem('truco_elo') || '1000'); }
function setMyElo(elo) { localStorage.setItem('truco_elo', String(Math.max(0, elo))); }

// Simulated leaderboard (real one would come from Supabase)
function getLeaderboard() {
  const stored = localStorage.getItem('truco_leaderboard');
  if(stored) return JSON.parse(stored);
  // Seed with AI character "players"
  return [
    {name:'Gauchão', elo:1050, wins:142, div:'Tropeiro'},
    {name:'Serrana', elo:1380, wins:289, div:'Gaúcho'},
    {name:'Farroupilha', elo:1155, wins:201, div:'Tropeiro'},
    {name:'Pampeano', elo:1520, wins:445, div:'Gaudério'},
    {name:'Curupira', elo:1680, wins:612, div:'Lenda do Pago'},
    {name:'Prenda', elo:1240, wins:178, div:'Gaúcho'},
    {name:'Missioneiro', elo:1310, wins:234, div:'Gaúcho'},
    {name:'Peão Duro', elo:1090, wins:156, div:'Tropeiro'},
  ];
}

function updateLeaderboard(myElo) {
  const board = getLeaderboard();
  const myName = TT_P.name;
  const existing = board.find(e => e.name === myName);
  const div = getDivision(myElo);
  if(existing) { existing.elo = myElo; existing.wins = TT_P.wins; existing.div = div.name; }
  else board.push({name:myName, elo:myElo, wins:TT_P.wins, div:div.name});
  board.sort((a,b) => b.elo - a.elo);
  localStorage.setItem('truco_leaderboard', JSON.stringify(board));
}

// ══════════════════════════════════════════════════════════════════════
//  ACHIEVEMENTS SYSTEM
// ══════════════════════════════════════════════════════════════════════
const ACHIEVEMENTS = [
  {id:'first_win',     ico:'🎉', name:'Primeira Vitória',      desc:'Vença sua primeira partida',              check:()=>TT_P.wins>=1},
  {id:'streak3',       ico:'🔥', name:'Toque de Mida',          desc:'Vença 3 partidas seguidas',               check:()=>TT_P.streak>=3||TT_P.bestStreak>=3},
  {id:'streak5',       ico:'⚡', name:'Invencível',             desc:'Vença 5 partidas seguidas',               check:()=>TT_P.streak>=5||TT_P.bestStreak>=5},
  {id:'streak10',      ico:'👑', name:'Lenda Viva',             desc:'Vença 10 partidas seguidas',              check:()=>TT_P.bestStreak>=10},
  {id:'wins10',        ico:'🌟', name:'Truqueiro de Lei',       desc:'Vença 10 partidas',                       check:()=>TT_P.wins>=10},
  {id:'wins50',        ico:'🏆', name:'Mestre do Pago',         desc:'Vença 50 partidas',                       check:()=>TT_P.wins>=50},
  {id:'wins100',       ico:'💎', name:'Lenda do Pago',          desc:'Vença 100 partidas',                      check:()=>TT_P.wins>=100},
  {id:'beat_curupira', ico:'🌿', name:'Dono do Mato',           desc:'Derrote o Curupira',                      check:()=>(TT_P.charStats.curupira?.wins||0)>=1},
  {id:'all_chars',     ico:'🎭', name:'Conhece Todos',          desc:'Jogue contra todos os personagens',       check:()=>Object.keys(TT_P.charStats).length>=8},
  {id:'unlock_all',    ico:'🔓', name:'Desbloqueou Tudo',       desc:'Desbloqueie todos os personagens',        check:()=>TT_P.unlocked.length>=8},
  {id:'truco_bluff',   ico:'🃏', name:'Malandragem',            desc:'Ganhe 10 partidas com personagem blefador',check:()=>(TT_P.charStats.farroupilha?.wins||0)+(TT_P.charStats.curupira?.wins||0)>=10},
  {id:'coins100',      ico:'🪙', name:'Poupador',               desc:'Acumule 100 moedas',                      check:()=>TT_P.coins>=100},
  {id:'coins500',      ico:'💰', name:'Rico do Pago',           desc:'Acumule 500 moedas',                      check:()=>TT_P.coins>=500},
  {id:'level5',        ico:'⭐', name:'Experiente',             desc:'Alcance o nível 5',                       check:()=>lvlOf(TT_P.xp)>=5},
  {id:'level10',       ico:'🌠', name:'Veterano',               desc:'Alcance o nível 10',                      check:()=>lvlOf(TT_P.xp)>=10},
  {id:'first_flor',    ico:'🌸', name:'Florzinha',              desc:'Vença uma partida com Flor',              check:()=>(TT_P.advStats?.florWins||0)>=1},
  {id:'perfect_env',   ico:'🎯', name:'Envideiro',              desc:'Vença 20 rodadas de Envido',              check:()=>(TT_P.advStats?.envidoWins||0)>=20},
  {id:'manilha_win',   ico:'★',  name:'A Carta Mais Forte',    desc:'Ganhe uma rodada com manilha máxima (v14)',check:()=>(TT_P.advStats?.manilhaWins||0)>=1},
  {id:'tourney_win',   ico:'🏟️', name:'Campeão do Pago',       desc:'Vença um torneio completo',               check:()=>(TT_P.advStats?.tourneyWins||0)>=1},
  {id:'comeback',      ico:'⚔️', name:'Virada Épica',           desc:'Vença uma partida estando 0×8',           check:()=>(TT_P.advStats?.comebacks||0)>=1},
];

function checkAchievements(ctx={}) {
  const unlocked = TT_P.unlockedAch || [];
  let newOnes = [];
  ACHIEVEMENTS.forEach(ach => {
    if(!unlocked.includes(ach.id) && ach.check()) {
      unlocked.push(ach.id);
      newOnes.push(ach);
    }
  });
  TT_P.unlockedAch = unlocked;
  saveP();
  if(newOnes.length) {
    newOnes.forEach((ach,i) => setTimeout(() => showAchToast(ach), i*2000));
  }
}

function showAchToast(ach) {
  const el = document.getElementById('ach-toast');
  document.getElementById('ach-toast-ico').textContent = ach.ico;
  document.getElementById('ach-toast-name').textContent = ach.name;
  document.getElementById('ach-toast-desc').textContent = ach.desc;
  el.classList.remove('hidden');
  SFX.unlock && SFX.unlock();
  setTimeout(() => el.classList.add('hidden'), 4000);
}

function renderAchievements() {
  const body = document.getElementById('ach-body');
  const unlocked = TT_P.unlockedAch || [];
  const total = ACHIEVEMENTS.length;
  const done = ACHIEVEMENTS.filter(a => unlocked.includes(a.id)).length;

  const cards = ACHIEVEMENTS.map(ach => {
    const isUnlocked = unlocked.includes(ach.id);
    return `<div class="ach-card ${isUnlocked?'unlocked':'locked'}">
      ${isUnlocked?'<span class="ach-badge">✓</span>':''}
      <span class="ach-ico">${ach.ico}</span>
      <div class="ach-name">${ach.name}</div>
      <div class="ach-desc">${ach.desc}</div>
    </div>`;
  }).join('');

  body.innerHTML = `
    <div style="background:var(--gold-bg);border:1px solid var(--gold-bdr);border-radius:var(--r2);padding:.85rem;text-align:center;margin-bottom:.9rem">
      <div style="font-size:.65rem;color:var(--txt3);text-transform:uppercase;letter-spacing:.1em">Progresso</div>
      <div style="font-size:2rem;font-weight:900;color:var(--gold-d);font-family:Georgia,serif">${done}<span style="font-size:1rem;color:var(--txt3)">/${total}</span></div>
      <div style="height:6px;background:var(--bdr);border-radius:3px;margin:.5rem 0;overflow:hidden"><div style="height:100%;width:${Math.round(done/total*100)}%;background:var(--gold-l);border-radius:3px;transition:width .8s"></div></div>
    </div>
    <div class="ach-grid">${cards}</div>`;
}

// ══════════════════════════════════════════════════════════════════════
//  ADVANCED STATISTICS
// ══════════════════════════════════════════════════════════════════════
function initAdvStats() {
  if(!TT_P.advStats) TT_P.advStats = {
    trucosCalled:0, trucosWon:0, trucosLost:0,
    envidoCalled:0, envidoWins:0, envidoLosses:0,
    florWins:0, manilhaWins:0, manoWins:0, manoLosses:0,
    comebacks:0, tourneyWins:0,
    avgEnvidoPts:0, envidoCount:0,
    roundsPlayed:0, handsPlayed:0,
    ptsByChar:{},
  };
}

function trackStat(key, val=1) {
  initAdvStats();
  if(typeof TT_P.advStats[key] === 'number') TT_P.advStats[key] += val;
  else TT_P.advStats[key] = val;
  saveP();
}

function renderAdvStats() {
  initAdvStats();
  const s = TT_P.advStats;
  const body = document.getElementById('stats-body');
  const wr = TT_P.games ? Math.round(TT_P.wins/TT_P.games*100) : 0;
  const trucoAcc = s.trucosCalled ? Math.round(s.trucosWon/s.trucosCalled*100) : 0;
  const envAcc = s.envidoCalled ? Math.round(s.envidoWins/s.envidoCalled*100) : 0;
  const manoWR = (s.manoWins+s.manoLosses) ? Math.round(s.manoWins/(s.manoWins+s.manoLosses)*100) : 0;
  const avgEnv = s.envidoCount ? Math.round(s.avgEnvidoPts/s.envidoCount) : 0;
  const myElo = getMyElo();
  const myDiv = getDivision(myElo);

  body.innerHTML = `
    <div class="mini-stats-row">
      ${[['ELO',myElo,'var(--gold-d)'],['Nível',lvlOf(TT_P.xp),'var(--blue)'],['Conquistas',(TT_P.unlockedAch||[]).length+'/'+ACHIEVEMENTS.length,'var(--green)']].map(([l,v,c])=>`<div class="mini-stat"><div class="mini-stat-val" style="color:${c}">${v}</div><div class="mini-stat-lbl">${l}</div></div>`).join('')}
    </div>
    <div class="stat-chart">
      <div class="stat-chart-title">Desempenho Geral</div>
      <div class="bar-chart">
        ${[['% Vitória',wr,'var(--green)'],['Truco Aceito',trucoAcc,'var(--red)'],['Envido Ganho',envAcc,'var(--gold-l)'],['Vitória como Mano',manoWR,'var(--blue)']].map(([l,v,c])=>`
          <div class="bar-row">
            <span class="bar-lbl">${l}</span>
            <div class="bar-track"><div class="bar-fill" style="width:${v}%;background:${c}"></div></div>
            <span class="bar-val">${v}%</span>
          </div>`).join('')}
      </div>
    </div>
    <div class="stat-chart">
      <div class="stat-chart-title">Detalhes de Jogo</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem">
        ${[['Mãos jogadas',s.handsPlayed||0],['Rodadas',s.roundsPlayed||0],['Trucos chamados',s.trucosCalled||0],['Flores cantadas',s.florWins||0],['Manilhas jogadas',s.manilhaWins||0],['Média Envido',avgEnv+'pts']].map(([l,v])=>`<div style="background:var(--surf);border:1px solid var(--bdr);border-radius:var(--r);padding:.5rem;text-align:center"><div style="font-size:1rem;font-weight:700;color:var(--txt)">${v}</div><div style="font-size:.6rem;color:var(--txt3)">${l}</div></div>`).join('')}
      </div>
    </div>
    <div class="stat-chart">
      <div class="stat-chart-title">Por personagem (top 5)</div>
      ${Object.entries(TT_P.charStats||{}).sort((a,b)=>(b[1].wins||0)-(a[1].wins||0)).slice(0,5).map(([id,s])=>{
        const ch=CHARS.find(c=>c.id===id);if(!ch)return'';
        const tot=(s.wins||0)+(s.losses||0);
        const pct=tot?Math.round((s.wins||0)/tot*100):0;
        return `<div class="bar-row"><span class="bar-lbl">${ch.av} ${ch.name}</span><div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:var(--green)"></div></div><span class="bar-val">${s.wins||0}v ${pct}%</span></div>`;
      }).join('')}
    </div>
    <button class="mb mb-sec" onclick="show('profile-scr')">← Voltar ao Perfil</button>`;
}

// ══════════════════════════════════════════════════════════════════════
//  SUPABASE INTEGRATION (config & stubs — works with any Supabase project)
// ══════════════════════════════════════════════════════════════════════
const SUPABASE_CFG = {
  url: localStorage.getItem('sb_url') || '',
  key: localStorage.getItem('sb_key') || '',
};
let TT_SB = null; // Supabase client

async function initSupabase() {
  if(!SUPABASE_CFG.url || !SUPABASE_CFG.key) return false;
  try {
    // Dynamic import of Supabase client
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    TT_SB = createClient(SUPABASE_CFG.url, SUPABASE_CFG.key);
    return true;
  } catch(e) { return false; }
}

async function sbSavePlayer() {
  if(!TT_SB) return;
  try {
    await TT_SB.from('players').upsert({
      id: TT_P.name + '_' + (TT_P.deviceId||''),
      name: TT_P.name,
      elo: getMyElo(),
      wins: TT_P.wins,
      losses: TT_P.losses,
      xp: TT_P.xp,
      updated_at: new Date().toISOString(),
    }, {onConflict:'id'});
  } catch(e) {}
}

async function sbLoadRanking() {
  if(!TT_SB) return null;
  try {
    const { data } = await TT_SB.from('players').select('name,elo,wins').order('elo',{ascending:false}).limit(50);
    return data;
  } catch(e) { return null; }
}


async function sbGetLiveRooms() {
  if(!TT_SB) return [];
  try {
    const { data } = await TT_SB.from('rooms').select('*').eq('status','playing').order('created_at',{ascending:false}).limit(20);
    return data||[];
  } catch(e) { return []; }
}

function configureSupabase() {
  const url = prompt('URL do seu projeto Supabase (ex: https://xxx.supabase.co):', SUPABASE_CFG.url);
  if(!url) return;
  const key = prompt('Chave anônima (anon key):', SUPABASE_CFG.key);
  if(!key) return;
  localStorage.setItem('sb_url', url);
  localStorage.setItem('sb_key', key);
  SUPABASE_CFG.url = url;
  SUPABASE_CFG.key = key;
  initSupabase().then(ok => toast(ok ? '✅ Supabase conectado!' : '❌ Erro na conexão', ok?'win':'lose'));
}

// ══════════════════════════════════════════════════════════════════════
//  SPECTATOR MODE
// ══════════════════════════════════════════════════════════════════════
let spectatingConn = null;

async function loadLiveRooms() {
  const body = document.getElementById('live-rooms');
  body.innerHTML = '<div style="color:var(--txt3);font-style:italic;text-align:center;padding:1rem">Procurando partidas...</div>';
  
  // Try Supabase first
  const sbRooms = await sbGetLiveRooms();
  
  // Also check local PeerJS broadcast (rooms announced via localStorage)
  const localRooms = JSON.parse(localStorage.getItem('truco_live_rooms') || '[]')
    .filter(r => Date.now() - r.ts < 300000); // 5 min timeout
  
  const allRooms = [...sbRooms, ...localRooms];
  
  if(!allRooms.length) {
    body.innerHTML = `<div style="color:var(--txt3);font-style:italic;font-size:.78rem;text-align:center;padding:1.5rem">
      Nenhuma partida ao vivo no momento.<br><br>
      <strong>Para aparecer aqui:</strong> crie uma sala no modo online e marque como "pública".
      ${SUPABASE_CFG.url?'':'<br><br><button class="mb mb-sec" onclick="configureSupabase()" style="margin-top:.5rem;font-size:.75rem">Conectar Supabase para ranking global</button>'}
    </div>`;
    return;
  }
  
  body.innerHTML = allRooms.map(r => `
    <div class="live-room" onclick="joinAsSpectator('${r.code||r.id}')">
      <div style="font-size:1.4rem">${r.mode==='2v2'?'🤝':r.mode==='3v3'?'👥':'⚔️'}</div>
      <div class="live-room-info">
        <div class="live-room-players"><span class="live-dot"></span>${r.host_name||'Jogador'} vs ${r.guest_name||'Adversário'}</div>
        <div class="live-room-score">Código: ${r.code||r.id} · ${r.mode||'1v1'}</div>
        <div class="live-room-specs">${r.spectators||0} assistindo</div>
      </div>
      <div style="font-size:.75rem;color:var(--blue);font-weight:600">Assistir →</div>
    </div>`).join('');
}

function joinAsSpectator(roomCode) {
  if(spectatingConn) { try{spectatingConn.close();}catch(e){} }
  toast('Conectando como espectador...', 'info');
  
  if(!peer) { if (typeof window.Peer !== 'function') { toast('Chamadas locais não estão disponíveis nesta versão.', 'warn'); return; } const p=new window.Peer(null,{debug:0}); peer=p; }
  spectatingConn = peer.connect(roomCode + '_spec');
  spectatingConn.on('open', () => {
    spectatingConn.send({type:'spectator_join', name:TT_P.name});
    show('game');
    // Mark as spectator mode
    TT_G.spectating = true;
    TT_G.char = {name:'Espectador',av:'👁️',loc:'',style:'',slangs:[]};
    document.getElementById('g-ai-lbl').textContent = 'Jogo ao vivo';
    toast('Assistindo ao vivo 👁️', 'info');
  });
  spectatingConn.on('data', data => {
    if(data.type === 'game_state') {
      // Apply received state to display
      Object.assign(TT_G, data.state);
      renderAll();
    }
  });
  spectatingConn.on('error', () => toast('Sala não encontrada', 'lose'));
}

// Broadcast game state to spectators when online
// Announce room as live
// ══════════════════════════════════════════════════════════════════════
//  CARD DEAL ANIMATION
// ══════════════════════════════════════════════════════════════════════
function animateDeal(callback) {
  const handEl = document.getElementById('p-hand');
  const aiEl = document.getElementById('ai-bks');
  if(!handEl || !TT_G.pHand) { callback(); return; }
  
  // Show deck pile in center of felt
  const felt = document.querySelector('.felt');
  if(!felt) { callback(); return; }
  const feltRect = felt.getBoundingClientRect();
  
  const pile = document.createElement('div');
  pile.className = 'deck-pile';
  felt.appendChild(pile);
  
  let dealCount = 0;
  const totalCards = TT_G.pHand.length + TT_G.aiHand.length;
  const dealOrder = [];
  
  // Interleave: ai,hu,ai,hu,ai,hu
  for(let i=0;i<3;i++) {
    dealOrder.push({target:'ai', idx:i});
    dealOrder.push({target:'hu', idx:i});
  }
  
  function dealNext() {
    if(dealCount >= dealOrder.length) {
      pile.remove();
      renderHand();
      renderAICards();
      callback();
      return;
    }
    const {target, idx} = dealOrder[dealCount];
    dealCount++;
    
    // Create flying card
    const fly = document.createElement('div');
    fly.className = 'card-flying';
    fly.style.cssText = `width:var(--cw);height:var(--ch);left:${feltRect.left+feltRect.width/2-36}px;top:${feltRect.top+feltRect.height/2-57}px;`;
    
    const img = document.createElement('img');
    img.src = CARD_BACK;
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:6px;';
    fly.appendChild(img);
    document.body.appendChild(fly);
    
    // Target position
    let targetEl = target === 'hu' ? handEl : aiEl;
    const targetRect = targetEl.getBoundingClientRect();
    const targetX = targetRect.left + (idx * 80) - feltRect.left - feltRect.width/2 + 36;
    const targetY = targetRect.top - feltRect.top - feltRect.height/2 + 57;
    
    fly.style.setProperty('--fx', '0px');
    fly.style.setProperty('--fy', '0px');
    fly.style.setProperty('--fr', `${(Math.random()-0.5)*10}deg`);
    
    fly.animate([
      {transform:'translate(0,0) rotate(0) scale(1)', opacity:0.9},
      {transform:`translate(${targetX}px,${targetY}px) rotate(${(Math.random()-0.5)*15}deg) scale(0.85)`, opacity:1},
    ], {duration:280, easing:'cubic-bezier(0.34,1.2,0.64,1)', fill:'forwards'}).onfinish = () => {
      fly.remove();
      SFX.card();
      setTimeout(dealNext, 80);
    };
  }
  
  // Start dealing after brief pause
  setTimeout(dealNext, 200);
}

// ══════════════════════════════════════════════════════════════════════
//  GAME LOGIC TESTS
// ══════════════════════════════════════════════════════════════════════
function runTests() {
  const results = document.getElementById('test-results');
  results.innerHTML = '';
  let pass = 0, fail = 0;

  function test(name, fn) {
    try {
      const ok = fn();
      const div = document.createElement('div');
      div.className = ok ? 'test-pass' : 'test-fail';
      div.innerHTML = `<span>${ok?'✅':'❌'}</span><span>${name}</span>`;
      results.appendChild(div);
      if(ok) pass++; else fail++;
    } catch(e) {
      const div = document.createElement('div');
      div.className = 'test-fail';
      div.innerHTML = `<span>❌</span><span>${name} — ERRO: ${e.message}</span>`;
      results.appendChild(div);
      fail++;
    }
  }

  function section(name) {
    const d = document.createElement('div');
    d.className = 'test-section';
    d.textContent = name;
    results.appendChild(d);
  }

  // ── Card values ──
  section('Valores das cartas');
  test('Ás de Espadas vale 14 (manilha máxima)', () => tv(1,'Espadas') === 14);
  test('Ás de Bastos vale 13', () => tv(1,'Bastos') === 13);
  test('7 de Espadas vale 12', () => tv(7,'Espadas') === 12);
  test('7 de Ouros vale 11', () => tv(7,'Ouros') === 11);
  test('3 vale 10', () => tv(3,'Copas') === 10);
  test('2 vale 9', () => tv(2,'Ouros') === 9);
  test('Ás de Copas vale 8', () => tv(1,'Copas') === 8);
  test('Ás de Ouros vale 8', () => tv(1,'Ouros') === 8);
  test('Rei vale 7', () => tv(12,'Espadas') === 7);
  test('Cavalo vale 6', () => tv(11,'Bastos') === 6);
  test('Sota vale 5', () => tv(10,'Ouros') === 5);
  test('7 de Copas vale 4', () => tv(7,'Copas') === 4);
  test('7 de Bastos vale 4', () => tv(7,'Bastos') === 4);
  test('4 vale 1 (mais fraca)', () => tv(4,'Copas') === 1);
  test('isManilha: Ás Espadas', () => isMan(1,'Espadas'));
  test('isManilha: 7 Ouros', () => isMan(7,'Ouros'));
  test('não é manilha: 3', () => !isMan(3,'Copas'));

  // ── Envido values ──
  section('Valores de envido');
  test('Envido: Ás vale 1', () => ev(1) === 1);
  test('Envido: 7 vale 7', () => ev(7) === 7);
  test('Envido: Sota vale 0', () => ev(10) === 0);
  test('Envido: Cavalo vale 0', () => ev(11) === 0);
  test('Envido: Rei vale 0', () => ev(12) === 0);

  // ── Envido calculation ──
  section('Cálculo de Envido');
  const hand2suit = [{rank:3,suit:'Ouros',ev:3},{rank:6,suit:'Ouros',ev:6},{rank:1,suit:'Copas',ev:1}];
  const calc2 = calcEnvido(hand2suit);
  test('Duas cartas mesmo naipe = 20 + valores', () => calc2.pts === 29); // 20+3+6
  test('Duas cartas mesmo naipe não é Flor', () => !calc2.hasFlor);
  
  const handFlor = [{rank:1,suit:'Espadas',ev:1},{rank:7,suit:'Espadas',ev:7},{rank:3,suit:'Espadas',ev:3}];
  const calcF = calcEnvido(handFlor);
  test('Três cartas mesmo naipe = Flor', () => calcF.hasFlor);
  test('Flor: pts = 20 + soma', () => calcF.pts === 31); // 20+1+7+3

  const handMixed = [{rank:1,suit:'Espadas',ev:1},{rank:7,suit:'Ouros',ev:7},{rank:3,suit:'Copas',ev:3}];
  const calcM = calcEnvido(handMixed);
  test('Todas naipes diferentes: maior carta', () => calcM.pts === 7);
  test('Todas naipes diferentes: sem Flor', () => !calcM.hasFlor);

  // ── Hand winner logic ──
  section('Vencedor da mão');
  function simHand(rw, mano='hu') {
    const savedG = {...G};
    TT_G.rw = rw; TT_G.handMano = mano;
    const result = handWinner();
    TT_G.rw = savedG.rw; TT_G.handMano = savedG.handMano;
    return result;
  }
  test('[hu,hu]: vence humano', () => simHand(['hu','hu']) === 'hu');
  test('[ai,ai]: vence AI', () => simHand(['ai','ai']) === 'ai');
  test('[hu,ai,hu]: vence humano (2v1)', () => simHand(['hu','ai','hu']) === 'hu');
  test('[draw,hu]: vence humano (empate 1ª, ganhou 2ª)', () => simHand(['draw','hu']) === 'hu');
  test('[hu,draw]: vence humano (ganhou 1ª, empate 2ª)', () => simHand(['hu','draw']) === 'hu');
  test('[draw,ai]: vence AI (empate 1ª, AI ganhou 2ª)', () => simHand(['draw','ai']) === 'ai');
  test('[draw,draw]: continua (null)', () => simHand(['draw','draw']) === null);
  test('[draw,draw,hu]: vence humano', () => simHand(['draw','draw','hu']) === 'hu');
  test('[draw,draw,draw]: mano vence (hu)', () => simHand(['draw','draw','draw'],'hu') === 'hu');
  test('[draw,draw,draw]: mano vence (ai)', () => simHand(['draw','draw','draw'],'ai') === 'ai');
  test('[hu,ai,draw]: vence humano (1ª ganhou, 3ª empate)', () => simHand(['hu','ai','draw']) === 'hu');
  test('[draw,hu,draw]: vence humano', () => simHand(['draw','hu','draw']) === 'hu');

  // ── Envido refuse points ──
  section('Pontos recusados no Envido');
  function simEnvidoRefuse(chain) {
    const savedChain = TT_G.envChain;
    TT_G.envChain = chain;
    const result = envRefusePts();
    TT_G.envChain = savedChain;
    return result;
  }
  test('Envido direto recusado = 1pt', () => simEnvidoRefuse(['envido']) === 1);
  test('Real Envido direto recusado = 1pt', () => simEnvidoRefuse(['real_envido']) === 1);
  test('Envido→Real recusado = 2pts', () => simEnvidoRefuse(['envido','real_envido']) === 2);
  test('Real→Falta recusado = 5pts', () => simEnvidoRefuse(['real_envido','falta_envido']) === 5);
  test('Falta direta recusada = 1pt', () => simEnvidoRefuse(['falta_envido']) === 1);
  test('Envido-Envido recusado = 2pts', () => simEnvidoRefuse(['envido_envido']) === 2);

  // ── ELO System ──
  section('Sistema ELO');
  test('ELO igual: vitória = +16', () => calcElo(1000,1000,true) === 1016);
  test('ELO igual: derrota = -16', () => calcElo(1000,1000,false) === 984);
  test('Favorito perde mais pontos', () => calcElo(1200,1000,false) < 1200-16);
  test('Underdog ganha mais pontos', () => calcElo(800,1200,true) > 800+16);
  test('Divisão Peão: 0-999', () => getDivision(999).name === 'Peão');
  test('Divisão Tropeiro: 1000+', () => getDivision(1000).name === 'Tropeiro');
  test('Divisão Lenda: 1600+', () => getDivision(1600).name === 'Lenda do Pago');

  // ── Deck ──
  section('Baralho');
  const deck = makeDeck();
  test('Baralho tem 40 cartas', () => deck.length === 40);
  test('Sem cartas repetidas', () => new Set(deck.map(c=>c.id)).size === 40);
  test('Sem 8 e 9', () => !deck.some(c=>c.rank===8||c.rank===9));
  const seeded = makeDeckSeeded(42);
  const seeded2 = makeDeckSeeded(42);
  test('Deck com mesmo seed é igual', () => seeded.map(c=>c.id).join() === seeded2.map(c=>c.id).join());
  const seeded3 = makeDeckSeeded(43);
  test('Deck com seed diferente é diferente', () => seeded.map(c=>c.id).join() !== seeded3.map(c=>c.id).join());

  // ── Summary ──
  const total = pass + fail;
  const summary = document.createElement('div');
  summary.style.cssText = `margin-top:1rem;padding:.7rem;border-radius:var(--r);text-align:center;font-weight:700;background:${fail===0?'var(--green-bg)':'var(--red-bg)'};color:${fail===0?'var(--green)':'var(--red)'}`;
  summary.textContent = `${pass}/${total} testes passaram${fail>0?` · ${fail} falhou`:''}`;
  results.appendChild(summary);
}

// ══════════════════════════════════════════════════════════════════════
//  PATCH endGame for ELO + achievements + stats tracking
// ══════════════════════════════════════════════════════════════════════
const __baseEndGame = typeof endGame === 'function' ? endGame : null;
// ══════════════════════════════════════════════════════════════════════
//  PATCH deal() for animated deal
// ══════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════
//  PATCH ai functions for stats tracking
// ══════════════════════════════════════════════════════════════════════
const __baseHumanTruco = humanTruco;
const __baseResolveEnvido = resolveEnvido;
// Track manilha wins
// ══════════════════════════════════════════════════════════════════════
//  SETTINGS: add Supabase config button
// ══════════════════════════════════════════════════════════════════════
function addSupabaseConfig() {
  const sheet = document.querySelector('.settings-sheet');
  if(!sheet) return;
  const div = document.createElement('div');
  div.className = 'set-row';
  div.innerHTML = `<div><div class="set-lbl">Backend Supabase</div><div class="set-sub">${SUPABASE_CFG.url?'✅ Conectado':'Não configurado — ranking local apenas'}</div></div><button onclick="configureSupabase()" style="background:var(--surf2);border:1px solid var(--bdr2);border-radius:999px;padding:.25rem .75rem;cursor:pointer;font-size:.72rem;color:var(--txt2)">Configurar</button>`;
  sheet.appendChild(div);
}

// ══════════════════════════════════════════════════════════════════════
//  ADVANCED PROFILE — add stats button
// ══════════════════════════════════════════════════════════════════════
const __baseRenderProfile = renderProfile;
// ══════════════════════════════════════════════════════════════════════
//  FINAL INIT PATCHES
// ══════════════════════════════════════════════════════════════════════
// Apply i18n on load
document.addEventListener('DOMContentLoaded', () => {
  applyI18n();
  addSupabaseConfig();
  initSupabase();
  // Add device ID for Supabase
  if(!TT_P.deviceId) { TT_P.deviceId = Math.random().toString(36).substring(2,10); saveP(); }
  // Init advanced stats
  initAdvStats();
  // Check achievements on load (in case earned offline)
  setTimeout(checkAchievements, 500);
});

// Add test runner button to settings
function addTestBtn() {
  const sheet = document.querySelector('.settings-sheet');
  if(!sheet) return;
  const div = document.createElement('div');
  div.className = 'set-row';
  div.innerHTML = `<div><div class="set-lbl">Motor do jogo</div><div class="set-sub">Verificar integridade das regras</div></div><button onclick="show('test-scr')" style="background:var(--blue-bg);border:1px solid var(--blue-bdr);color:var(--blue);border-radius:999px;padding:.25rem .75rem;cursor:pointer;font-size:.72rem">Testar</button>`;
  sheet.appendChild(div);
}

const __baseOpenSettings = openSettings;

// ─── BLOCK 3 ───
// ╔════════════════════════════════════════════════════════════╗
//  SUPABASE AUTH — email + Google
// ╚══════════════════════════════════════════════════════════════╝
AUTH = { user: null, session: null };

function loadAuth() {
  try { AUTH = JSON.parse(localStorage.getItem('truco_auth') || '{}'); } catch(e) {}
}
function saveAuth() {
  try { localStorage.setItem('truco_auth', JSON.stringify(AUTH)); } catch(e) {}
}

let _authMode = 'login'; // 'login' | 'register'
function toggleAuthMode() {
  _authMode = _authMode === 'login' ? 'register' : 'login';
  document.getElementById('auth-toggle-lbl').textContent = _authMode === 'login' ? 'Cadastrar' : 'Entrar';
  document.getElementById('auth-ttl').textContent = _authMode === 'login' ? 'Entrar no Pago' : 'Cadastrar Conta';
  document.getElementById('auth-sub').textContent = _authMode === 'login' ? 'Entre com sua conta' : 'Crie sua conta gaúcha';
}

async function authSubmit() {
  const name  = document.getElementById('auth-name').value.trim();
  const email = document.getElementById('auth-email').value.trim();
  const pass  = document.getElementById('auth-pass').value;

  if (!email || !pass) { toast('Preencha e-mail e senha', 'info'); return; }
  if (_authMode === 'register' && !name) { toast('Escolha um nome', 'info'); return; }

  if (TT_SB) {
    try {
      let result;
      if (_authMode === 'register') {
        result = await TT_SB.auth.signUp({ email, password: pass, options: { data: { name } } });
      } else {
        result = await TT_SB.auth.signInWithPassword({ email, password: pass });
      }
      if (result.error) throw result.error;
      AUTH.user = result.data.user;
      AUTH.session = result.data.session;
      if (name) TT_P.name = name;
      saveAuth(); saveP();
      renderAuthModal();
      toast(_authMode === 'register' ? '✅ Conta criada!' : '✅ Bem-vindo de volta!', 'win');
      return;
    } catch(e) {
      toast('Erro: ' + (e.message || 'Tente novamente'), 'lose');
      return;
    }
  }
  // Offline fallback — local account
  AUTH.user = { email, name: name || TT_P.name, id: btoa(email) };
  if (name) TT_P.name = name;
  saveAuth(); saveP();
  renderAuthModal();
  toast('✅ Conta local criada! (sem backend)', 'info');
}

async function authGoogle() {
  if (TT_SB) {
    try {
      const { error } = await TT_SB.auth.signInWithOAuth({ provider: 'google' });
      if (error) throw error;
    } catch(e) { toast('Erro Google: ' + e.message, 'lose'); }
  } else {
    toast('Configure o Supabase nas configurações para login com Google', 'info');
  }
}

async function authLogout() {
  if (TT_SB) await TT_SB.auth.signOut().catch(() => {});
  AUTH = {};
  saveAuth();
  renderAuthModal();
  toast('Saiu da conta', 'info');
}

function renderAuthModal() {
  const isLogged = AUTH.user;
  document.getElementById('auth-form').style.display = isLogged ? 'none' : 'flex';
  document.getElementById('auth-logged').style.display = isLogged ? 'block' : 'none';
  if (isLogged) {
    document.getElementById('auth-logged-name').textContent = AUTH.user.name || AUTH.user.email || TT_P.name;
    document.getElementById('auth-logged-elo').textContent = 'ELO ' + getMyElo();
  }
}

// ╔══════════════════════════════════════════════════════════════╗
//  FRIENDS SYSTEM
// ╚══════════════════════════════════════════════════════════════╝
var _friendsData = { friends: [], incoming: [], invites: [] };

function openFriendsScreen() {
  var user = window.localUser || (typeof AUTH !== 'undefined' ? AUTH.user : null);
  if (!user) { showLoginRequiredModal(); return; }
  show('friends-scr');
  loadFriendsData();
}

async function loadFriendsData() {
  try {
    _friendsData = await trpcQuery('friends.overview');
    renderFriends();
  } catch (error) {
    toast('Não foi possível carregar seus amigos.', 'warn');
  }
}

async function searchFriends() {
  var input = document.getElementById('friend-search');
  var target = document.getElementById('friend-search-results');
  var query = (input && input.value || '').trim();
  if (query.length < 2) { toast('Digite ao menos 2 letras para buscar.', 'info'); return; }
  target.innerHTML = '<div style="font-size:.68rem;color:rgba(255,255,255,.55)">Buscando jogadores...</div>';
  try {
    var users = await trpcQuery('friends.search', { query: query });
    target.innerHTML = users.length ? users.map(function(friend) {
      return '<div class="friend-row"><span class="friend-av">🤠</span><div class="friend-info"><div class="friend-name">' + escapeRoomText(friend.name) + '</div><div class="friend-status offline">' + escapeRoomText([friend.city, friend.state].filter(Boolean).join(' · ') || 'Jogador do Truco Tchê') + '</div></div><button onclick="sendFriendRequest(' + Number(friend.id) + ')" style="background:#3675ba;border:0;border-radius:7px;color:#fff;padding:.32rem .48rem;font-weight:800;font-size:.62rem;cursor:pointer">Adicionar</button></div>';
    }).join('') : '<div style="font-size:.68rem;color:rgba(255,255,255,.55);padding:.25rem">Nenhum jogador encontrado.</div>';
  } catch (error) { target.innerHTML = '<div style="font-size:.68rem;color:#f7a0a0">Busca indisponível. Tente novamente.</div>'; }
}

async function sendFriendRequest(userId) {
  try {
    var result = await trpcMutation('friends.sendRequest', { userId: Number(userId) });
    if (sio && sioAuthenticated) sio.emit('friendship_event', { targetUserId: Number(userId), kind: result.status === 'accepted' ? 'accepted' : 'request' });
    toast(result.status === 'accepted' ? 'Amizade confirmada!' : 'Solicitação enviada!', 'win');
    loadFriendsData();
  } catch (error) { toast('Não foi possível enviar a solicitação.', 'warn'); }
}

async function respondFriendRequest(friendshipId, requesterId, accept) {
  try {
    await trpcMutation('friends.respond', { friendshipId: Number(friendshipId), accept: Boolean(accept) });
    if (sio && sioAuthenticated) sio.emit('friendship_event', { targetUserId: Number(requesterId), kind: accept ? 'accepted' : 'declined' });
    toast(accept ? 'Amizade aceita!' : 'Solicitação recusada.', accept ? 'win' : 'info');
    loadFriendsData();
  } catch (error) { toast('Solicitação indisponível.', 'warn'); }
}

async function removeFriend(friendId) {
  if (!confirm('Remover este amigo da sua lista?')) return;
  try { await trpcMutation('friends.remove', { userId: Number(friendId) }); loadFriendsData(); } catch (error) { toast('Não foi possível remover o amigo.', 'warn'); }
}

async function acceptFriendInvite(roomCode) {
  try {
    ensureSocket();
    show('online-lobby');
    setOnlineLobbyMode('browse');
    joinActiveRoom(roomCode);
  } catch (error) { toast('Convite expirado ou indisponível.', 'warn'); loadFriendsData(); }
}

function inviteFriend(friendId) {
  var friend = (_friendsData.friends || []).find(function(item) { return Number(item.id) === Number(friendId); });
  var friendName = friend ? friend.name : 'seu amigo';
  ensureSocket();
  if (!sio || !sioConnected || !sioAuthenticated) { toast('Conectando...', 'info'); waitForAuth(function() { inviteFriend(friendId); }); return; }
  openOnlineLobby();
  socketCreateRoom(Number(friendId), friendName);
}

function renderFriends() {
  var data = _friendsData || { friends: [], incoming: [], invites: [] };
  var list = document.getElementById('friends-list');
  var incomingCard = document.getElementById('friend-incoming-card');
  var incomingList = document.getElementById('friend-incoming-list');
  var inviteCard = document.getElementById('friend-invites-card');
  var inviteList = document.getElementById('friend-invites-list');
  if (incomingCard) incomingCard.style.display = data.incoming.length ? 'block' : 'none';
  if (incomingList) incomingList.innerHTML = data.incoming.map(function(request) { return '<div class="friend-row"><span class="friend-av">🤠</span><div class="friend-info"><div class="friend-name">' + escapeRoomText(request.requesterName) + '</div><div class="friend-status offline">' + escapeRoomText([request.city, request.state].filter(Boolean).join(' · ') || 'Quer ser seu amigo') + '</div></div><button onclick="respondFriendRequest(' + Number(request.id) + ',' + Number(request.requesterId) + ',true)" style="background:#3b9956;border:0;color:#fff;border-radius:7px;padding:.3rem .45rem;font-size:.6rem;font-weight:800;cursor:pointer">Aceitar</button><button onclick="respondFriendRequest(' + Number(request.id) + ',' + Number(request.requesterId) + ',false)" style="background:transparent;border:1px solid rgba(255,255,255,.25);color:#fff;border-radius:7px;padding:.3rem .45rem;font-size:.6rem;cursor:pointer">Recusar</button></div>'; }).join('');
  if (inviteCard) inviteCard.style.display = data.invites.length ? 'block' : 'none';
  if (inviteList) inviteList.innerHTML = data.invites.map(function(invite) { return '<div class="friend-row"><span class="friend-av">🃏</span><div class="friend-info"><div class="friend-name">' + escapeRoomText(invite.senderName) + ' te desafiou</div><div class="friend-status online">Sala privada · ' + escapeRoomText(roomStakeLabel(invite.stakeTier)) + ' · ' + escapeRoomText(roomRegionLabel(invite.region)) + '</div></div><button onclick="acceptFriendInvite(\'' + escapeRoomText(invite.roomCode) + '\')" style="background:#3675ba;border:0;color:#fff;border-radius:7px;padding:.3rem .45rem;font-size:.6rem;font-weight:800;cursor:pointer">Entrar</button></div>'; }).join('');
  if (!list) return;
  list.innerHTML = data.friends.length ? data.friends.map(function(friend) { return '<div class="friend-row"><span class="friend-av">🤠</span><div class="friend-info"><div class="friend-name">' + escapeRoomText(friend.name) + '</div><div class="friend-status online">Amigo · ' + escapeRoomText([friend.city, friend.state].filter(Boolean).join(' · ') || 'Truco Tchê') + '</div></div><button onclick="inviteFriend(' + Number(friend.id) + ')" style="background:#3675ba;border:0;color:#fff;border-radius:7px;padding:.32rem .48rem;font-size:.62rem;font-weight:800;cursor:pointer">Desafiar</button><button onclick="removeFriend(' + Number(friend.id) + ')" style="background:none;border:none;color:rgba(255,255,255,.55);cursor:pointer;padding:.2rem .35rem;font-size:.8rem">✕</button></div>'; }).join('') : '<div style="color:rgba(255,255,255,.55);font-style:italic;font-size:.72rem;text-align:center;padding:1rem">Ainda não há amigos. Busque um jogador para enviar sua primeira solicitação.</div>';
}

// ╔══════════════════════════════════════════════════════════════╗
//  SKINS / THEMES / SHOP
// ╚══════════════════════════════════════════════════════════════╝
const SHOP_ITEMS = {
  skins: [
    { id: 'classic',  name: 'Clássico',    desc: 'Baralho Fournier original', price: 0,   icon: '🃏', preview: '#e8d8b0' },
    { id: 'vintage',  name: 'Vintage',     desc: 'Cartas envelhecidas sépia',  price: 150, icon: '📜', preview: '#c8a060' },
    { id: 'couro',    name: 'Couro',       desc: 'Textura de couro gaúcho',    price: 200, icon: '🤎', preview: '#8b5a2b' },
    { id: 'neon',     name: 'Neon',        desc: 'Cartas luminosas noturnas',  price: 300, icon: '💜', preview: '#1a0a2e' },
    { id: 'pampa',    name: 'Pampa',       desc: 'Verde e dourado do campo',   price: 250, icon: '🌾', preview: '#7a9a3a' },
    // ── Premium (comprados com Pilas 💰) ──
    { id: 'farroupilha', name: 'Farroupilha',  desc: 'Edição comemorativa da Revolução Farroupilha', pricePilas: 15, price: -1, icon: '⚔️',  preview: '#8b0000', premium: true },
    { id: 'chimarrao',   name: 'Chimarrão',    desc: 'Baralho verde-mate exclusivo',     pricePilas: 10, price: -1, icon: '🧉', preview: '#2d5a27', premium: true },
    { id: 'gaucho_real', name: 'Gaúcho Real', desc: 'Dourado com detalhes em couro fino',    pricePilas: 25, price: -1, icon: '👑', preview: '#b8860b', premium: true },
  ],
  themes: [
    { id: 'default', name: 'Pampa Claro', desc: 'Tema padrão',               price: 0,   icon: '☀️', bg:'#f5f1ea', felt:'#1a5a1a' },
    { id: 'dark',    name: 'Noite no Pago',desc: 'Tema escuro elegante',      price: 0,   icon: '🌙', bg:'#1a1208', felt:'#0d380d' },
    { id: 'couro',   name: 'Tapera',      desc: 'Marrom quente de tapera',   price: 200, icon: '🏚️', bg:'#2a1a0a', felt:'#1a3a0a' },
    { id: 'gaúcho',  name: 'Bandeira',    desc: 'Verde, amarelo e vermelho',  price: 300, icon: '🚩', bg:'#0a2010', felt:'#1a5000' },
  ],
  avatars: [
    { id: 'gaucho',   name: 'Gauchão',   desc: 'O veterano',     price: 0,   icon: '🤠' },
    { id: 'prenda',   name: 'Prenda',    desc: 'A rainha',       price: 0,   icon: '👩‍🦰' },
    { id: 'peao',     name: 'Peão',      desc: 'O brabo',        price: 0,   icon: '🧑‍🌾' },
    { id: 'caudilho', name: 'Caudilho',  desc: 'O líder',        price: 400, icon: '⚔️' },
    { id: 'xama',     name: 'Xamã',      desc: 'O misterioso',   price: 400, icon: '🪶' },
    { id: 'tropeiro', name: 'Tropeiro',  desc: 'O viajante',     price: 250, icon: '🐎' },
  ],
};

let _shopTab = 'skins';

function shopTab(tab, el) {
  _shopTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  renderShop();
}

function renderShop() {
  document.getElementById('shop-coins').textContent = TT_P.coins;
  const content = document.getElementById('shop-content');
  const owned = TT_P.shopOwned || { skins: ['classic'], themes: ['default','dark'], avatars: ['gaucho','prenda','peao'] };
  TT_P.shopOwned = owned;
  const active = TT_P.shopActive || { skin: 'classic', theme: 'default', avatar: 'gaucho' };
  TT_P.shopActive = active;

  if (_shopTab === 'pilas') {
    renderPilasShop(content);
    return;
  }
  if (_shopTab === 'pass') {
    content.innerHTML = `<div class="pass-card">
      <div style="font-size:.7rem;color:var(--txt3);text-transform:uppercase;letter-spacing:.1em">Passe do Gaudério</div>
      <div class="pass-price">🪙 500<span style="font-size:1rem;color:var(--txt3)">/mês</span></div>
      <ul class="pass-features">
        <li>✅ Todos os baralhos desbloqueados</li>
        <li>✅ Todos os temas desbloqueados</li>
        <li>✅ XP +50% em todas as partidas</li>
        <li>✅ Moedas +100% por vitória</li>
        <li>✅ Badge exclusivo "Gaudério VIP"</li>
        <li>✅ Suporte prioritário</li>
      </ul>
      <button class="mb mb-yes" onclick="buyPass()">Assinar Passe do Gaudério</button>
    </div>`;
    return;
  }

  const items = SHOP_ITEMS[_shopTab] || [];
  content.innerHTML = `<div class="shop-grid">${items.map(item => {
    const isPremium = !!item.premium;
    const isOwned = isPremium ? (_serverPurchases || []).some(p => p.category === _shopTab && p.itemId === item.id) : (owned[_shopTab] || []).includes(item.id);
    const isActive = active[_shopTab.replace('skins','skin').replace('themes','theme').replace('avatars','avatar')] === item.id;
    let priceLabel;
    if (isOwned) {
      priceLabel = isActive ? '✅ Ativo' : 'Ativar';
    } else if (isPremium) {
      priceLabel = '💰 ' + item.pricePilas + ' Pilas';
    } else {
      priceLabel = '🪙 ' + (item.price === 0 ? 'Grátis' : item.price);
    }
    return `<div class="skin-card ${isOwned?'owned':''} ${isActive?'active':''} ${isPremium && !isOwned?'premium':''}" onclick="${isPremium ? `shopActionPilas('${_shopTab}','${item.id}',${item.pricePilas},${isOwned})` : `shopAction('${_shopTab}','${item.id}',${item.price},${isOwned})`}">
      ${isOwned ? '<span class="skin-owned-badge">✓</span>' : ''}
      ${isPremium && !isOwned ? '<span class="premium-badge">💰 PREMIUM</span>' : ''}
      ${_shopTab === 'themes' ? `<div class="theme-preview" style="background:${item.bg};border:1px solid ${item.felt}"></div>` : `<span class="skin-preview">${item.icon}</span>`}
      <div class="skin-name">${item.name}</div>
      <div class="skin-desc">${item.desc}</div>
      <div class="skin-price" ${isPremium && !isOwned ? 'style="color:var(--gold);font-weight:800"' : ''}>${priceLabel}</div>
    </div>`;
  }).join('')}</div>`;
}

function shopAction(tab, id, price, owned) {
  const activeKey = tab.replace('skins','skin').replace('themes','theme').replace('avatars','avatar');
  if (!TT_P.shopOwned) TT_P.shopOwned = { skins: ['classic'], themes: ['default','dark'], avatars: ['gaucho','prenda','peao'] };
  if (!TT_P.shopActive) TT_P.shopActive = { skin: 'classic', theme: 'default', avatar: 'gaucho' };
  if (owned) {
    TT_P.shopActive[activeKey] = id;
    applyShopTheme();
    saveP(); renderShop();
    toast(`${id} ativado!`, 'info');
    SFX.click && SFX.click();
    return;
  }
  if (price === 0) {
    if (!TT_P.shopOwned[tab]) TT_P.shopOwned[tab] = [];
    TT_P.shopOwned[tab].push(id);
    TT_P.shopActive[activeKey] = id;
    applyShopTheme(); saveP(); renderShop();
    toast('Item desbloqueado!', 'win');
    return;
  }
  if (TT_P.coins < price) { toast(`Precisa de 🪙${price} moedas (tem ${TT_P.coins})`, 'lose'); return; }
  if (!confirm(`Comprar ${id} por 🪙${price}?`)) return;
  TT_P.coins -= price;
  if (!TT_P.shopOwned[tab]) TT_P.shopOwned[tab] = [];
  TT_P.shopOwned[tab].push(id);
  TT_P.shopActive[activeKey] = id;
  applyShopTheme(); saveP(); renderShop();
  toast(`Comprado! 🪙${price}`, 'win');
  SFX.unlock && SFX.unlock();
}

function buyPass() {
  if (TT_P.coins < 500) { toast('Precisa de 🪙500 moedas', 'lose'); return; }
  TT_P.coins -= 500;
  TT_P.hasPass = true;
  // Unlock everything
  Object.keys(SHOP_ITEMS).forEach(tab => {
    if (!TT_P.shopOwned) TT_P.shopOwned = {};
    TT_P.shopOwned[tab] = SHOP_ITEMS[tab].map(i => i.id);
  });
  saveP(); renderShop();
  toast('🎉 Passe do Gaudério ativado!', 'unlock');
}

function applyShopTheme() {
  const active = TT_P.shopActive;
  if (!active) return;
  const theme = (SHOP_ITEMS.themes || []).find(t => t.id === active.theme);
  if (theme) {
    document.documentElement.style.setProperty('--bg', theme.bg);
    if (theme.id === 'dark') darkMode = true;
    else if (theme.id === 'default') darkMode = false;
    applyTheme();
  }
}

// ╔══════════════════════════════════════════════════════════════╗
//  PILAS (MOEDA VIRTUAL) - LOJA + PIX
// ╚══════════════════════════════════════════════════════════════╝
let _pilasBalance = 0;
let _pilasPackages = [];
let _currentPixPayment = null;
let _pixPollInterval = null;
let _serverPurchases = [];

/**
 * Load user's premium purchases from the server.
 */
async function loadServerPurchases() {
  try {
    const res = await trpcQuery('pilas.myPurchases');
    _serverPurchases = res || [];
  } catch (e) {
    console.warn('[Pilas] loadPurchases error:', e);
  }
}

/**
 * Buy a premium shop item with Pilas (server-side transaction).
 */
async function shopActionPilas(tab, id, pricePilas, owned) {
  const activeKey = tab.replace('skins','skin').replace('themes','theme').replace('avatars','avatar');
  if (!TT_P.shopOwned) TT_P.shopOwned = { skins: ['classic'], themes: ['default','dark'], avatars: ['gaucho','prenda','peao'] };
  if (!TT_P.shopActive) TT_P.shopActive = { skin: 'classic', theme: 'default', avatar: 'gaucho' };

  // If already owned, just activate
  if (owned) {
    TT_P.shopActive[activeKey] = id;
    applyShopTheme();
    saveP(); renderShop();
    toast(`${id} ativado!`, 'info');
    SFX.click && SFX.click();
    return;
  }

  // Check pilas balance
  if (_pilasBalance < pricePilas) {
    toast(`Precisa de 💰${pricePilas} Pilas (tem ${_pilasBalance}). Compre mais Pilas na aba Pilas!`, 'lose');
    return;
  }

  if (!confirm(`Comprar ${SHOP_ITEMS[tab]?.find(i => i.id === id)?.name || id} por 💰${pricePilas} Pilas?`)) return;

  try {
    const res = await trpcMutation('pilas.buyShopItem', { category: tab, itemId: id, pricePilas });
    if (res.success) {
      // Update local state
      _pilasBalance = res.balance;
      document.querySelectorAll('.pilas-balance-display').forEach(el => {
        el.textContent = _pilasBalance;
      });
      // Add to server purchases
      _serverPurchases.push({ category: tab, itemId: id, pricePilas });
      // Also add to local shopOwned for activation
      if (!TT_P.shopOwned[tab]) TT_P.shopOwned[tab] = [];
      TT_P.shopOwned[tab].push(id);
      TT_P.shopActive[activeKey] = id;
      applyShopTheme(); saveP(); renderShop();
      toast(`🎉 Comprado! 💰${pricePilas} Pilas`, 'win');
      SFX.unlock && SFX.unlock();
    }
  } catch (e) {
    const msg = e?.message || 'Erro ao processar compra';
    if (msg.includes('já possui')) {
      toast('Você já possui este item!', 'info');
      await loadServerPurchases();
      renderShop();
    } else if (msg.includes('insuficiente')) {
      toast(`Saldo insuficiente! Compre mais Pilas na aba Pilas.`, 'lose');
    } else {
      toast('Erro ao processar compra. Tente novamente.', 'lose');
    }
  }
}

async function loadPilasBalance() {
  try {
    const res = await trpcQuery('pilas.balance');
    _pilasBalance = res?.balance ?? 0;
    // Update all balance displays
    document.querySelectorAll('.pilas-balance-display').forEach(el => {
      el.textContent = _pilasBalance;
    });
    const shopCoins = document.getElementById('shop-coins');
    if (shopCoins) shopCoins.textContent = _pilasBalance;
  } catch (e) {
    console.warn('[Pilas] loadBalance error:', e);
  }
}

async function loadPilasPackages() {
  try {
    const res = await trpcQuery('pilas.packages');
    _pilasPackages = res || [];
  } catch (e) {
    console.warn('[Pilas] loadPackages error:', e);
    _pilasPackages = [];
  }
}

function renderPilasShop(container) {
  loadPilasBalance();
  if (_pilasPackages.length === 0) {
    loadPilasPackages().then(() => _renderPilasContent(container));
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--txt3)">Carregando pacotes...</div>';
  } else {
    _renderPilasContent(container);
  }
}

function _renderPilasContent(container) {
  if (_pilasPackages.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:2rem">
        <div style="font-size:2.5rem;margin-bottom:.5rem">💰</div>
        <div style="font-size:1rem;font-weight:700;color:var(--txt);margin-bottom:.5rem">Pilas - Moeda do Truco Tchê</div>
        <div style="font-size:.8rem;color:var(--txt3);margin-bottom:1rem">1 Pila = R$1,00</div>
        <div style="font-size:.78rem;color:var(--txt3)">Nenhum pacote disponível no momento.<br>Volte em breve!</div>
      </div>`;
    return;
  }

  const html = `
    <div style="text-align:center;margin-bottom:1rem">
      <div style="font-size:.7rem;color:var(--txt3);text-transform:uppercase;letter-spacing:.1em">Seu Saldo</div>
      <div style="font-size:1.8rem;font-weight:800;color:var(--gold-d)">💰 <span class="pilas-balance-display">${_pilasBalance}</span> Pilas</div>
      <div style="font-size:.72rem;color:var(--txt3)">1 Pila = R$1,00</div>
    </div>
    <div style="font-size:.78rem;font-weight:700;color:var(--txt);margin-bottom:.5rem">Comprar Pilas via Pix</div>
    <div class="shop-grid">
      ${_pilasPackages.map(pkg => {
        const priceStr = (pkg.priceCents / 100).toFixed(2).replace('.', ',');
        const totalPilas = pkg.pilas + (pkg.bonusPilas || 0);
        return `
          <div class="skin-card" onclick="buyPilasPackage(${pkg.id})" style="cursor:pointer">
            ${pkg.badge ? `<span class="skin-owned-badge" style="background:var(--gold);color:#fff;font-size:.55rem;padding:.1rem .4rem;border-radius:999px;position:absolute;top:.4rem;right:.4rem">${pkg.badge}</span>` : ''}
            <span class="skin-preview" style="font-size:2rem">💰</span>
            <div class="skin-name">${pkg.name}</div>
            <div class="skin-desc">${totalPilas} pilas${pkg.bonusPilas > 0 ? ` <span style="color:var(--green);font-weight:700">(+${pkg.bonusPilas} bônus!)</span>` : ''}</div>
            <div class="skin-price" style="color:var(--green);font-weight:700">R$ ${priceStr}</div>
            <div style="font-size:.6rem;color:var(--txt3);margin-top:.2rem">⚡ Pix instantâneo</div>
          </div>`;
      }).join('')}
    </div>
    <div style="margin-top:1rem;padding:.75rem;background:var(--surf2);border-radius:var(--r2);font-size:.72rem;color:var(--txt3)">
      <strong>ℹ️ Como funciona:</strong><br>
      1. Escolha um pacote acima<br>
      2. Escaneie o QR Code Pix ou copie o código<br>
      3. Pague pelo app do seu banco<br>
      4. As pilas são creditadas automaticamente!
    </div>`;
  container.innerHTML = html;
}

async function buyPilasPackage(packageId) {
  const currentUser = window.localUser || (typeof AUTH !== 'undefined' ? AUTH.user : null);
  if (!currentUser) {
    toast('Faça login para comprar pilas!', 'lose');
    return;
  }
  const pkg = _pilasPackages.find(p => p.id === packageId);
  if (!pkg) { toast('Pacote não encontrado', 'lose'); return; }

  const totalPilas = pkg.pilas + (pkg.bonusPilas || 0);
  const priceStr = (pkg.priceCents / 100).toFixed(2).replace('.', ',');

  if (!confirm(`Comprar ${pkg.name} (${totalPilas} pilas) por R$ ${priceStr} via Pix?`)) return;

  toast('Gerando pagamento Pix...', 'info');

  try {
    const res = await trpcMutation('pilas.createPixPayment', { packageId });
    _currentPixPayment = res;
    showPixPaymentModal(res, pkg);
  } catch (e) {
    console.error('[Pilas] createPixPayment error:', e);
    toast('Erro ao gerar pagamento. Tente novamente.', 'lose');
  }
}

function showPixPaymentModal(payment, pkg) {
  const totalPilas = pkg.pilas + (pkg.bonusPilas || 0);
  const priceStr = (payment.amountBRL).toFixed(2).replace('.', ',');

  // Create modal overlay
  let modal = document.getElementById('pix-payment-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'pix-payment-modal';
    modal.className = 'modal';
    document.body.appendChild(modal);
  }
  modal.classList.remove('hidden');

  modal.innerHTML = `
    <div class="sheet" style="max-width:380px;padding:1.2rem">
      <div class="sh-handle"></div>
      <span class="sh-ico">💰</span>
      <div class="sh-ttl">Pagamento Pix</div>
      <div style="text-align:center;margin:.75rem 0">
        <div style="font-size:.78rem;color:var(--txt3)">${pkg.name} — ${totalPilas} pilas</div>
        <div style="font-size:1.4rem;font-weight:800;color:var(--green);margin:.3rem 0">R$ ${priceStr}</div>
      </div>
      ${payment.qrCodeBase64 ? `
        <div style="text-align:center;margin:.5rem 0">
          <img src="data:image/png;base64,${payment.qrCodeBase64}" alt="QR Code Pix" style="width:200px;height:200px;border-radius:var(--r2);border:2px solid var(--bdr)">
        </div>` : ''}
      ${payment.qrCode ? `
        <div style="margin:.5rem 0">
          <div style="font-size:.68rem;color:var(--txt3);margin-bottom:.3rem">Pix Copia e Cola:</div>
          <div style="display:flex;gap:.3rem">
            <input type="text" value="${payment.qrCode}" readonly style="flex:1;font-size:.6rem;padding:.4rem;border:1px solid var(--bdr);border-radius:var(--r);background:var(--surf2);color:var(--txt)" id="pix-copy-input">
            <button onclick="copyPixCode()" style="padding:.4rem .7rem;background:var(--gold);color:#fff;border:none;border-radius:var(--r);font-size:.68rem;font-weight:700;cursor:pointer">Copiar</button>
          </div>
        </div>` : ''}
      ${payment.ticketUrl ? `
        <div style="text-align:center;margin:.5rem 0">
          <a href="${payment.ticketUrl}" target="_blank" style="font-size:.72rem;color:var(--gold-d);text-decoration:underline">Abrir página de pagamento</a>
        </div>` : ''}
      <div style="text-align:center;margin:.5rem 0">
        <div id="pix-status" style="font-size:.78rem;font-weight:700;color:var(--gold-d)">⏳ Aguardando pagamento...</div>
        <div style="font-size:.6rem;color:var(--txt3);margin-top:.2rem">O pagamento expira em 30 minutos</div>
      </div>
      <div class="mbtns" style="margin-top:.75rem">
        <button class="mb mb-no" onclick="closePixModal()">Cancelar</button>
      </div>
    </div>`;

  // Start polling for payment status
  startPixPolling(payment.paymentId);
}

function copyPixCode() {
  const input = document.getElementById('pix-copy-input');
  if (input) {
    navigator.clipboard.writeText(input.value).then(() => {
      toast('Código Pix copiado!', 'info');
    }).catch(() => {
      input.select();
      document.execCommand('copy');
      toast('Código Pix copiado!', 'info');
    });
  }
}

function startPixPolling(paymentId) {
  if (_pixPollInterval) clearInterval(_pixPollInterval);
  let attempts = 0;
  const maxAttempts = 60; // 30 min (poll every 30s)

  _pixPollInterval = setInterval(async () => {
    attempts++;
    if (attempts > maxAttempts) {
      clearInterval(_pixPollInterval);
      _pixPollInterval = null;
      const statusEl = document.getElementById('pix-status');
      if (statusEl) statusEl.innerHTML = '❌ Pagamento expirado';
      return;
    }

    try {
      const res = await trpcMutation('pilas.checkPaymentStatus', { paymentId });
      if (res.status === 'approved') {
        clearInterval(_pixPollInterval);
        _pixPollInterval = null;
        const statusEl = document.getElementById('pix-status');
        if (statusEl) statusEl.innerHTML = '✅ Pagamento confirmado!';
        _pilasBalance = res.balance ?? _pilasBalance;
        document.querySelectorAll('.pilas-balance-display').forEach(el => {
          el.textContent = _pilasBalance;
        });
        toast('🎉 Pilas creditadas com sucesso!', 'win');
        SFX.unlock && SFX.unlock();
        setTimeout(() => closePixModal(), 2000);
      } else if (res.status === 'rejected' || res.status === 'cancelled') {
        clearInterval(_pixPollInterval);
        _pixPollInterval = null;
        const statusEl = document.getElementById('pix-status');
        if (statusEl) statusEl.innerHTML = '❌ Pagamento ' + (res.status === 'rejected' ? 'rejeitado' : 'cancelado');
      }
    } catch (e) {
      console.warn('[Pilas] poll error:', e);
    }
  }, 30000); // Poll every 30 seconds

  // Also do an immediate first check after 5 seconds
  setTimeout(async () => {
    try {
      const res = await trpcMutation('pilas.checkPaymentStatus', { paymentId });
      if (res.status === 'approved') {
        clearInterval(_pixPollInterval);
        _pixPollInterval = null;
        const statusEl = document.getElementById('pix-status');
        if (statusEl) statusEl.innerHTML = '✅ Pagamento confirmado!';
        _pilasBalance = res.balance ?? _pilasBalance;
        document.querySelectorAll('.pilas-balance-display').forEach(el => {
          el.textContent = _pilasBalance;
        });
        toast('🎉 Pilas creditadas com sucesso!', 'win');
        SFX.unlock && SFX.unlock();
        setTimeout(() => closePixModal(), 2000);
      }
    } catch (e) {}
  }, 5000);
}

function closePixModal() {
  if (_pixPollInterval) {
    clearInterval(_pixPollInterval);
    _pixPollInterval = null;
  }
  const modal = document.getElementById('pix-payment-modal');
  if (modal) modal.classList.add('hidden');
  _currentPixPayment = null;
  // Refresh the shop view
  if (_shopTab === 'pilas') {
    const content = document.getElementById('shop-content');
    if (content) renderPilasShop(content);
  }
}

// Load pilas balance on page load if user is logged in
if (window.localUser || (typeof AUTH !== 'undefined' && AUTH.user)) {
  loadPilasBalance();
}

// ╔══════════════════════════════════════════════════════════════╗
//  FULL REPLAY SYSTEM
// ╚══════════════════════════════════════════════════════════════╝
let _replayData = null;
let _replayCursor = 0;
let _replayInterval = null;

// Record events during game
function recordEvent(type, data = {}) {
  if (!TT_G.replay) TT_G.replay = [];
  TT_G.replay.push({ type, data, ts: Date.now(), score: { ...TT_G.score }, rw: [...TT_G.rw] });
}

function openReplayFromGO() {
  closeModal('m-go');
  if (!TT_G.replay || !TT_G.replay.length) { toast('Sem replay disponível', 'info'); return; }
  _replayData = { events: TT_G.replay, char: TT_G.char, finalScore: { ...TT_G.score }, hist: [...(TT_G.hist||[])] };
  _replayCursor = 0;
  show('replay-scr');
  renderReplay();
}

function openReplayFromHistory(idx) {
  const h = loadHistory();
  const entry = h[idx];
  if (!entry || !entry.replay) { toast('Replay não disponível para esta partida', 'info'); return; }
  _replayData = entry.replay;
  _replayCursor = 0;
  show('replay-scr');
  renderReplay();
}

function renderReplay() {
  if (!_replayData) return;
  const events = _replayData.events || [];
  const info = document.getElementById('replay-info');
  info.innerHTML = `<strong>${_replayData.char?.name || 'Adversário'}</strong> ${_replayData.char?.av || ''} · Placar final: ${_replayData.finalScore?.hu||0} × ${_replayData.finalScore?.ai||0}`;

  // Timeline
  const tl = document.getElementById('replay-timeline');
  tl.innerHTML = events.map((ev, i) => {
    const icons = { card_played:'🃏', truco:'🔥', envido:'🎯', flor:'🌸', round_end:'⚡', hand_end:'🏆' };
    return `<div class="replay-event ${i===_replayCursor?'active':''} ${ev.type==='round_end'||ev.type==='hand_end'?'round-end':''}" 
      onclick="jumpReplay(${i})" title="${ev.type}: ${JSON.stringify(ev.data).substring(0,40)}">${icons[ev.type]||'•'}</div>`;
  }).join('');
  tl.children[_replayCursor]?.scrollIntoView({ behavior:'smooth', block:'nearest', inline:'center' });

  renderReplayFrame(_replayCursor);
}

function renderReplayFrame(idx) {
  const events = _replayData?.events || [];
  if (!events[idx]) return;
  const ev = events[idx];

  document.getElementById('rp-ai-cards').innerHTML = (ev.data.aiCards || []).map(c =>
    `<div class="replay-mini-card"><img src="${cimg(c)}" alt="${c.rank} ${c.suit}"></div>`
  ).join('');
  document.getElementById('rp-hu-cards').innerHTML = (ev.data.huCards || []).map(c =>
    `<div class="replay-mini-card"><img src="${cimg(c)}" alt="${c.rank} ${c.suit}"></div>`
  ).join('');

  const typeLabels = { card_played:`${ev.data.player==='hu'?'Você':'Bagual'} jogou`, truco:'Truco cantado', envido:'Envido cantado', flor:'Flor!', round_end:'Rodada encerrada', hand_end:'Mão encerrada' };
  document.querySelector('.replay-info').innerHTML =
    `Evento ${idx+1}/${events.length}: <strong>${typeLabels[ev.type]||ev.type}</strong> · Placar: ${ev.score?.hu||0}×${ev.score?.ai||0}`;
}

function replayStep(n) {
  const events = _replayData?.events || [];
  _replayCursor = Math.max(0, Math.min(events.length - 1, _replayCursor + n));
  renderReplay();
}

function jumpReplay(idx) {
  _replayCursor = idx;
  renderReplay();
}

function toggleReplayPlay() {
  const btn = document.getElementById('rp-play-btn');
  if (_replayInterval) {
    clearInterval(_replayInterval);
    _replayInterval = null;
    btn.textContent = '▶ Auto';
  } else {
    btn.textContent = '⏸ Pausar';
    _replayInterval = setInterval(() => {
      const events = _replayData?.events || [];
      if (_replayCursor >= events.length - 1) {
        clearInterval(_replayInterval); _replayInterval = null;
        btn.textContent = '▶ Auto'; return;
      }
      replayStep(1);
    }, 1200);
  }
}

// Patch humanPlay and aiPlay to record events
const ___baseAPlay = aiPlay;
// ╔══════════════════════════════════════════════════════════════╗
//  TOURNAMENT WITH BRACKET (human players)
// ╚══════════════════════════════════════════════════════════════╝
// ══════════════════════════════════════════════════════════════
//  BRACKET TOURNAMENT — with tRPC persistence
// ══════════════════════════════════════════════════════════════
let BRACKET = { size: 4, name: 'Torneio Gaúcho', rounds: [], players: [], currentMatch: null, dbId: null };

function setBracketSize(n, el) {
  BRACKET.size = n;
  document.querySelectorAll('#bracket-size-btns .tab-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  renderBracketPlayerSlots();
}

function renderBracketPlayerSlots() {
  const container = document.getElementById('bracket-players-list');
  if (!container) return;
  let html = '<div style="font-size:.68rem;color:var(--txt3);margin-bottom:.4rem">Nomes dos jogadores:</div>';
  for (let i = 0; i < BRACKET.size; i++) {
    const val = i === 0 ? (TT_P.name || 'Você') : '';
    const placeholder = i === 0 ? 'Você (jogador 1)' : `Jogador ${i + 1}`;
    html += `<input class="auth-input" id="bp-name-${i}" type="text" placeholder="${placeholder}" value="${val}" maxlength="20" style="width:100%;margin-bottom:.3rem">`;
  }
  container.innerHTML = html;
}

async function createBracketTournament() {
  const _lu = JSON.parse(localStorage.getItem('truco_local_user') || 'null');
  if (!_lu) { toast('Faça login para criar um torneio!', 'info'); return; }
  const name = document.getElementById('bracket-name-input').value.trim() || 'Torneio Gaúcho';
  const players = [];
  for (let i = 0; i < BRACKET.size; i++) {
    const nameInput = document.getElementById('bp-name-' + i);
    const pName = nameInput ? nameInput.value.trim() : '';
    players.push({ id: i, name: pName || (i === 0 ? TT_P.name : `Jogador ${i + 1}`), avatar: i === 0 ? '🤠' : '🌄', seed: i });
  }
  BRACKET.name = name;
  BRACKET.players = players.map(p => ({ ...p, av: p.avatar }));
  BRACKET.dbId = null;
  BRACKET.currentMatch = null;

  // Generate first round locally
  const n = players.length;
  const firstMatches = [];
  for (let i = 0; i < Math.floor(n / 2); i++) {
    firstMatches.push({ p1: { ...players[i], av: players[i].avatar }, p2: { ...players[n - 1 - i], av: players[n - 1 - i].avatar }, winner: null, score: null });
  }
  BRACKET.rounds = [{ name: getBracketRoundName(n), matches: firstMatches }];

  // Persist to server
  try {
    const res = await trpcMutation('tournament.startBracket', { name, players });
    if (res && res.tournamentId) {
      BRACKET.dbId = res.tournamentId;
      // Sync rounds from server
      if (res.bracketData && res.bracketData.rounds) {
        BRACKET.rounds = res.bracketData.rounds.map(r => ({
          ...r,
          matches: r.matches.map(m => ({
            ...m,
            p1: { ...m.p1, av: m.p1.avatar },
            p2: { ...m.p2, av: m.p2.avatar },
            winner: m.winner ? { ...m.winner, av: m.winner.avatar } : null,
          }))
        }));
      }
    }
  } catch (e) { console.warn('Bracket create error:', e); }

  document.getElementById('bracket-setup-inner').style.display = 'none';
  document.getElementById('bracket-view-inner').style.display = 'block';
  renderBracketInner();
}

function getBracketRoundName(n) {
  if (n >= 16) return 'Oitavas de Final';
  if (n >= 8) return 'Quartas de Final';
  if (n >= 4) return 'Semifinal';
  return 'Final';
}

function renderBracketInner() {
  const header = document.getElementById('bracket-header-inner');
  if (!header) return;
  if (!BRACKET.rounds.length) {
    // Show setup
    document.getElementById('bracket-setup-inner').style.display = 'block';
    document.getElementById('bracket-view-inner').style.display = 'none';
    renderBracketPlayerSlots();
    return;
  }
  header.innerHTML = `<div style="text-align:center;margin-bottom:.7rem">
    <div style="font-size:1.1rem;font-weight:700">${BRACKET.name}</div>
    <div style="font-size:.7rem;color:var(--txt3)">${BRACKET.players.length} participantes${BRACKET.dbId ? ' · ☁️ salvo' : ''}</div>
  </div>`;

  const main = document.getElementById('bracket-main-inner');
  main.innerHTML = BRACKET.rounds.map((round, ri) => `
    <div class="bracket-col">
      <div class="bracket-col-title">${round.name}</div>
      ${round.matches.map((m, mi) => `
        <div class="match-card">
          <div class="match-player ${m.winner && m.winner.id === m.p1.id ? 'winner' : m.winner ? 'loser' : ''}">
            <span class="match-player-av">${m.p1.av || m.p1.avatar || '🌄'}</span>${m.p1.name}
            ${m.score ? `<span class="match-score">${m.winner && m.winner.id === m.p1.id ? m.score : '–'}</span>` : ''}
          </div>
          <div class="match-vs">vs</div>
          <div class="match-player ${m.winner && m.winner.id === m.p2.id ? 'winner' : m.winner ? 'loser' : ''}">
            <span class="match-player-av">${m.p2.av || m.p2.avatar || '🌄'}</span>${m.p2.name}
            ${m.score ? `<span class="match-score">${m.winner && m.winner.id === m.p2.id ? m.score : '–'}</span>` : ''}
          </div>
          ${!m.winner ? `<div style="padding:.3rem;text-align:center"><button onclick="playBracketMatch(${ri},${mi})" style="background:var(--gold);color:#fff;border:none;border-radius:999px;padding:.25rem .7rem;cursor:pointer;font-size:.72rem;font-weight:700">Jogar</button></div>` : ''}
        </div>`).join('')}
    </div>`).join('<div style="font-size:1.2rem;color:var(--bdr2);align-self:center">→</div>');

  // Champion
  const lastRound = BRACKET.rounds[BRACKET.rounds.length - 1];
  const champion = lastRound && lastRound.matches.length === 1 && lastRound.matches[0].winner;
  if (champion && lastRound.matches.every(m => m.winner)) {
    main.innerHTML += `<div style="text-align:center;align-self:center;padding:1rem">
      <div style="font-size:2.5rem">🏆</div>
      <div style="font-weight:700;font-size:.85rem">Campeão!</div>
      <div style="font-size:1rem">${champion.av || champion.avatar || '🌄'} ${champion.name}</div>
    </div>`;
  }

  // Actions
  const actions = document.getElementById('bracket-actions-inner');
  if (!actions) return;
  const pending = lastRound?.matches.filter(m => !m.winner).length ?? 0;
  if (pending === 0 && BRACKET.rounds.length && !champion) {
    actions.innerHTML = `<button class="mb mb-yes" onclick="advanceBracketLocal()">Próxima rodada →</button>`;
  } else if (champion) {
    if (champion.name === TT_P.name && TT_P.advStats) { TT_P.advStats.tourneyWins = (TT_P.advStats.tourneyWins || 0) + 1; saveP(); }
    actions.innerHTML = `<button class="mb mb-sec" onclick="resetBracket()">Novo Torneio</button>`;
  } else {
    actions.innerHTML = '';
  }
}

function playBracketMatch(roundIdx, matchIdx) {
  const match = BRACKET.rounds[roundIdx].matches[matchIdx];
  BRACKET.currentMatch = { roundIdx, matchIdx, p1: match.p1, p2: match.p2 };
  // Opponent is the non-human player
  const opp = match.p1.id === 0 ? match.p2 : match.p1;
  const fakeChar = { ...CHARS[Math.floor(Math.random() * CHARS.length)], name: opp.name, av: opp.av || opp.avatar || '🌄' };
  show('game');
  startGame(fakeChar);
}

function advanceBracketLocal() {
  const lastRound = BRACKET.rounds[BRACKET.rounds.length - 1];
  const winners = lastRound.matches.map(m => m.winner).filter(Boolean);
  if (winners.length < 2) return;
  const n = winners.length;
  const matches = [];
  for (let i = 0; i < Math.floor(n / 2); i++) {
    matches.push({ p1: winners[i], p2: winners[n - 1 - i], winner: null, score: null });
  }
  BRACKET.rounds.push({ name: getBracketRoundName(n), matches });
  renderBracketInner();
}

function resetBracket() {
  BRACKET = { size: 4, name: 'Torneio Gaúcho', rounds: [], players: [], currentMatch: null, dbId: null };
  document.getElementById('bracket-setup-inner').style.display = 'block';
  document.getElementById('bracket-view-inner').style.display = 'none';
  renderBracketPlayerSlots();
}

// Load tournament history from server
async function loadTourneyHistory() {
  const body = document.getElementById('tourney-history-body');
  if (!body) return;
  const _lu = JSON.parse(localStorage.getItem('truco_local_user') || 'null');
  if (!_lu) {
    body.innerHTML = '<p style="color:var(--txt3);padding:2rem;text-align:center">Faça login para ver seu histórico de torneios.</p>';
    return;
  }
  body.innerHTML = '<p style="color:var(--txt3);padding:1rem;text-align:center">⏳ Carregando...</p>';
  try {
    const history = await trpcQuery('tournament.history', { limit: 20 });
    if (!history || !history.length) {
      body.innerHTML = '<p style="color:var(--txt3);padding:2rem;text-align:center">Nenhum torneio concluído ainda.</p>';
      return;
    }
    body.innerHTML = history.map(t => {
      const date = t.completedAt ? new Date(t.completedAt).toLocaleDateString('pt-BR') : '--';
      const pct = Math.round(t.wins / t.totalRounds * 100);
      const isChamp = t.wins === t.totalRounds;
      return `<div style="background:var(--surf);border:1.5px solid ${isChamp ? 'var(--gold-bdr)' : 'var(--bdr)'};border-radius:var(--r2);padding:.85rem;margin-bottom:.6rem">
        <div style="display:flex;align-items:center;gap:.6rem">
          <span style="font-size:1.6rem">${isChamp ? '🏆' : '🎖️'}</span>
          <div style="flex:1">
            <div style="font-weight:700;font-size:.85rem">${t.name}</div>
            <div style="font-size:.65rem;color:var(--txt3)">${date} · ${t.type === 'ai' ? 'vs IA' : 'Bracket'}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:.85rem;font-weight:700;color:${isChamp ? 'var(--gold)' : 'var(--txt2)'}">${t.wins}/${t.totalRounds}</div>
            ${t.coinsAwarded ? `<div style="font-size:.65rem;color:var(--txt3)">🪙 +${t.coinsAwarded}</div>` : ''}
          </div>
        </div>
        <div style="background:var(--bdr);border-radius:999px;height:4px;margin-top:.5rem">
          <div style="background:${isChamp ? 'var(--gold)' : 'var(--green)'};height:4px;border-radius:999px;width:${pct}%"></div>
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    body.innerHTML = '<p style="color:var(--red);padding:1rem;text-align:center">Erro ao carregar histórico.</p>';
  }
}

// Initialize bracket player slots on first render
document.addEventListener('DOMContentLoaded', () => { renderBracketPlayerSlots(); });

// Hook into endGame for bracket
// ╔══════════════════════════════════════════════════════════════╗
//  ONBOARDING — guided first game
// ╚══════════════════════════════════════════════════════════════╝
const OB_STEPS = [
  { title:'Bem-vindo ao Truco Tchê! 🤠', body:'Vou te guiar pela sua primeira partida. Você vai aprender jogando!', target:null },
  { title:'Suas cartas', body:'Estas são suas 3 cartas. As com ★ são manilhas — as mais fortes do baralho!', target:'p-hand' },
  { title:'A mão 👑', body:'A mão (indicado por 👑) joga primeiro. Em empate geral, a mão vence!', target:'mano-hu-label' },
  { title:'Jogar uma carta', body:'Toque em qualquer carta para jogá-la. Comece com uma carta média para não revelar suas manilhas!', target:'p-hand' },
  { title:'Botões de ação', body:'Antes de jogar, você pode pedir Envido (disputar pontos extras) ou gritar Truco para aumentar a aposta!', target:'sbtns' },
  { title:'A mesa de jogo', body:'As cartas jogadas aparecem aqui no feltro verde. Quem jogar a carta mais forte vence a rodada!', target:'felt-wrap' },
  { title:'O placar', body:'Primeiro a 12 pontos vence a partida! Acompanhe o placar aqui no topo.', target:'g-hdr' },
  { title:'Pronto! Bom jogo! 🎉', body:'Agora é com você. Se precisar de ajuda, ative o Modo Treino nas configurações!', target:null },
];
let _obStep = 0;

function startOnboarding() {
  if (localStorage.getItem('truco_ob_done')) return;
  _obStep = 0;
  document.getElementById('ob-overlay').classList.remove('hidden');
  showObStep(0);
}

function showObStep(idx) {
  const step = OB_STEPS[idx];
  if (!step) { skipOnboarding(); return; }
  _obStep = idx;
  document.getElementById('ob-tip-title').textContent = step.title;
  document.getElementById('ob-tip-body').textContent = step.body;

  // Dots
  document.getElementById('ob-dots').innerHTML = OB_STEPS.map((_,i) =>
    `<div class="ob-dot ${i===idx?'active':''}"></div>`).join('');

  // Spotlight
  const spotlight = document.getElementById('ob-spotlight');
  const tip = document.getElementById('ob-tip');
  if (step.target) {
    const el = document.getElementById(step.target);
    if (el) {
      const r = el.getBoundingClientRect();
      spotlight.style.cssText = `top:${r.top-8}px;left:${r.left-8}px;width:${r.width+16}px;height:${r.height+16}px;`;
      tip.style.top = (r.bottom + 16) + 'px';
      tip.style.left = Math.max(8, r.left) + 'px';
    }
  } else {
    spotlight.style.cssText = 'width:0;height:0;box-shadow:none;';
    tip.style.top = '50%'; tip.style.left = '50%';
    tip.style.transform = 'translate(-50%,-50%)';
  }
}

function nextOnboarding() { showObStep(_obStep + 1); }
function skipOnboarding() {
  const ob=document.getElementById('ob-overlay');if(ob){ob.classList.add('hidden');ob.style.display='none';}
  localStorage.setItem('truco_ob_done','1');
}

// ╔══════════════════════════════════════════════════════════════╗
//  TRUCO A 15 VARIANT
// ╚══════════════════════════════════════════════════════════════╝
function toggleVariant15() {
  const is15 = document.getElementById('cfg-15').checked;
  CFG.variant15 = is15;
  saveCfg();
  toast(is15 ? 'Variante Truco a 15 ativada' : 'Voltando ao Truco a 12', 'info');
}

// Override deal() to use correct target
// ╔══════════════════════════════════════════════════════════════╗
//  REGIONAL RANKING
// ╚══════════════════════════════════════════════════════════════╝
const REGIONS = [
  { id:'RS', name:'Rio Grande do Sul', flag:'🇧🇷', sub:'RS' },
  { id:'SC', name:'Santa Catarina',    flag:'🇧🇷', sub:'SC' },
  { id:'PR', name:'Paraná',            flag:'🇧🇷', sub:'PR' },
  { id:'SP', name:'São Paulo',         flag:'🇧🇷', sub:'SP' },
  { id:'AR', name:'Argentina',         flag:'🇦🇷', sub:'AR' },
  { id:'UY', name:'Uruguai',           flag:'🇺🇾', sub:'UY' },
  { id:'global', name:'Global',        flag:'🌍', sub:'' },
];

let _selectedRegion = localStorage.getItem('truco_region') || 'RS';

function setMyRegion(id) {
  _selectedRegion = id;
  localStorage.setItem('truco_region', id);
  if (!TT_P.region) { TT_P.region = id; saveP(); }
}

function renderRegional() {
  const grid = document.getElementById('region-grid');
  grid.innerHTML = REGIONS.map(r => `
    <div class="region-btn ${r.id===_selectedRegion?'sel':''}" onclick="selectRegion('${r.id}')">
      <span class="region-flag">${r.flag}</span>${r.name}
    </div>`).join('');
  renderRegionalTable();
}

function selectRegion(id) {
  _selectedRegion = id;
  renderRegional();
}

function renderRegionalTable() {
  const board = getLeaderboard();
  // Filter by region (in real app, each entry would have region)
  // Simulate by assigning regions based on name hash
  const filtered = _selectedRegion === 'global' ? board : board.filter((e, i) => {
    // Assign regions to seeded entries and check real player's region
    if (e.name === TT_P.name) return (TT_P.region || 'RS') === _selectedRegion;
    return REGIONS[i % REGIONS.length].id === _selectedRegion;
  });

  const myElo = getMyElo();
  const table = document.getElementById('regional-table');
  if (!filtered.length) {
    table.innerHTML = '<div style="color:var(--txt3);font-style:italic;text-align:center;padding:1.5rem">Nenhum jogador desta região ainda.<br>Jogue partidas para aparecer aqui!</div>';
    return;
  }

  const rows = filtered.map((e, i) => {
    const isMe = e.name === TT_P.name;
    const d = DIVISIONS.find(d => d.name === e.div) || DIVISIONS[0];
    return `<tr class="${isMe?'me':''}">
      <td class="rank-pos">${i<3?['🥇','🥈','🥉'][i]:i+1}</td>
      <td>${d.icon} ${e.name}</td>
      <td><span class="div-badge ${d.cls}">${e.div}</span></td>
      <td style="font-weight:700;color:var(--gold-d)">${e.elo}</td>
    </tr>`;
  }).join('');

  table.innerHTML = `<div style="font-size:.7rem;color:var(--txt3);margin-bottom:.4rem">
    ${REGIONS.find(r=>r.id===_selectedRegion)?.flag} ${REGIONS.find(r=>r.id===_selectedRegion)?.name} — ${filtered.length} jogadores
    ${TT_P.region !== _selectedRegion && TT_P.region ? '' : `<button onclick="setMyRegion('${_selectedRegion}');renderRegional()" style="float:right;background:none;border:none;color:var(--blue);cursor:pointer;font-size:.7rem">Definir como minha região</button>`}
  </div>
  <table class="rank-table">
    <thead><tr><th>#</th><th>Jogador</th><th>Divisão</th><th>ELO</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// ╔══════════════════════════════════════════════════════════════╗
//  AI COACH / TRAINING MODE
// ╚══════════════════════════════════════════════════════════════╝
let _coachMode = false;
let _coachQueue = [];

function toggleCoachMode() {
  _coachMode = document.getElementById('cfg-coach').checked;
  CFG.coachMode = _coachMode;
  saveCfg();
  const overlay = document.getElementById('coach-overlay');
  if (_coachMode) {
    overlay.classList.remove('hidden');
    showCoachTip('welcome');
    toast('Modo Treino ativado! A IA vai explicar cada decisão.', 'info');
  } else {
    overlay.classList.add('hidden');
  }
}

function exitCoachMode() {
  _coachMode = false;
  CFG.coachMode = false;
  if (document.getElementById('cfg-coach')) document.getElementById('cfg-coach').checked = false;
  saveCfg();
  document.getElementById('coach-overlay').classList.add('hidden');
}

const COACH_TIPS = {
  welcome: { title:'Modo Treino ativado!', body:'Vou explicar cada decisão da IA e sugerir jogadas. Aprenda enquanto joga!' },
  ai_play_strong: { title:'IA jogou forte', body:'A IA jogou a carta mais forte porque precisa vencer esta rodada para garantir a mão.' },
  ai_play_weak: { title:'IA preservou manilha', body:'A IA jogou uma carta fraca porque já está ganhando. Guardou as manilhas para quando precisar.' },
  ai_truco: { title:'Por que a IA pediu Truco?', body:'A IA tem pelo menos uma manilha ou 2 cartas fortes. Ela acredita que vai ganhar a mão.' },
  ai_truco_bluff: { title:'A IA pode estar blefando!', body:'Este personagem tem alta chance de blefe. Analise o placar antes de aceitar.' },
  ai_envido: { title:'IA pediu Envido', body:'A IA tem pontos de envido altos (provavelmente 24+). Cuidado ao aceitar sem bons pontos!' },
  hu_should_truco: { title:'Dica: Truco aqui!', body:'Você tem carta(s) forte(s). Considere pedir Truco para aumentar os pontos em jogo!' },
  hu_should_envido: { title:'Dica: Seu envido é forte', body:'Seus pontos de envido parecem bons. Considere pedir Envido antes de jogar!' },
  ai_fold_truco: { title:'IA correu do Truco', body:'A IA recusou porque suas cartas eram fracas. Soube a hora de ceder 1 ponto para não perder mais.' },
  round_draw: { title:'Empate! Regra da Mão', body:'Em empate, quem é a mão (👑) joga primeiro na próxima rodada e vence se tudo empatar.' },
  envido_calc: { title:'Como calcular Envido', body:`Seu envido: ${0}pts. Duas cartas do mesmo naipe = 20 + soma dos valores (figuras valem 0).` },
};

function showCoachTip(key, extra = {}) {
  if (!_coachMode) return;
  const tip = COACH_TIPS[key];
  if (!tip) return;
  const overlay = document.getElementById('coach-overlay');
  overlay.classList.remove('hidden');
  document.getElementById('coach-tip-title').textContent = tip.title;
  let body = tip.body;
  if (key === 'envido_calc') body = `Seu envido: ${TT_G.envPts?.hu||0}pts. Duas cartas do mesmo naipe = 20 + valores (figuras valem 0).`;
  document.getElementById('coach-tip-body').textContent = body;
}

function nextCoachTip() {
  if (_coachQueue.length) {
    showCoachTip(_coachQueue.shift());
  } else {
    document.getElementById('coach-overlay').classList.add('hidden');
  }
}

// Inject coach tips at key moments
const _cBaseAiCallTruco = aiCallTruco;
const _cBaseAiCallEnvido = aiCallEnvido;
// Suggest actions to human
function analyzeAndCoach() {
  if (!_coachMode || TT_G.phase !== 'playing' || TT_G.turn !== 'hu') return;
  const myPts = TT_G.envPts?.hu || 0;
  const hasStrong = TT_G.pHand?.filter(c => c.tv >= 10).length >= 2;
  const hasMan = TT_G.pHand?.some(c => c.tv >= 11);
  if (!TT_G.pfirst?.hu && !TT_G.envRes && myPts >= 24) {
    setTimeout(() => showCoachTip('hu_should_envido'), 800);
  } else if (!TT_G.lastTruChal && (hasMan || hasStrong) && TT_G.rw.length === 0) {
    setTimeout(() => showCoachTip('hu_should_truco'), 1200);
  }
}

// ╔══════════════════════════════════════════════════════════════╗
//  VOICE SYNTHESIS — Web Speech API
// ╚══════════════════════════════════════════════════════════════╝
const VOICE_PITCH = {
  gauchao: 0.8, prenda: 1.3, peao: 0.7, missioneiro: 0.9,
  farroupilha: 1.0, serrana: 1.2, pampeano: 0.75, curupira: 1.1,
};
const VOICE_RATE = {
  gauchao: 0.85, prenda: 1.1, peao: 0.9, missioneiro: 0.8,
  farroupilha: 1.05, serrana: 1.0, pampeano: 0.9, curupira: 0.95,
};

let _voiceEnabled = false;
let _voices = [];

function initVoice() {
  if (!window.speechSynthesis) return;
  const load = () => { _voices = window.speechSynthesis.getVoices(); };
  load();
  window.speechSynthesis.onvoiceschanged = load;
}

function getBestVoice(lang = 'pt-BR') {
  // Prefer Portuguese voices, fall back to any available
  return _voices.find(v => v.lang.startsWith('pt')) ||
         _voices.find(v => v.lang.startsWith('es')) ||
         _voices[0] || null;
}

function speak(text, charId = 'gauchao') {
  if (!_voiceEnabled || !window.speechSynthesis || !text) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  const voice = getBestVoice();
  if (voice) utter.voice = voice;
  utter.lang = 'pt-BR';
  utter.pitch = VOICE_PITCH[charId] || 1.0;
  utter.rate = VOICE_RATE[charId] || 0.9;
  utter.volume = 0.85;

  // Show voice indicator in bubble
  const bubble = document.getElementById('bubble');
  if (bubble) {
    const indicator = document.createElement('div');
    indicator.className = 'voice-indicator';
    indicator.innerHTML = '<span class="voice-bars"><span class="vb" style="height:40%"></span><span class="vb"></span><span class="vb"></span><span class="vb"></span><span class="vb" style="height:60%"></span></span>';
    bubble.appendChild(indicator);
    utter.onend = () => indicator.remove();
  }
  window.speechSynthesis.speak(utter);
}

// Override bubbleSay to also speak
const _vsBaseBubble = bubbleSay;
function toggleVoice() {
  _voiceEnabled = CFG.voice = document.getElementById('cfg-voice')?.checked || false;
  saveCfg();
  if (_voiceEnabled) {
    initVoice();
    toast('🔊 Voz dos personagens ativada!', 'info');
    setTimeout(() => speak('Buenas, vivente! Tô pronto pra jogar.', TT_G.char?.id || 'gauchao'), 300);
  } else {
    window.speechSynthesis?.cancel();
  }
}

// ╔══════════════════════════════════════════════════════════════╗
//  CAPACITOR CONFIG — native app setup
// ╚══════════════════════════════════════════════════════════════╝
function showCapacitorSetup() {
  const instructions = `
Para publicar como App nativo (iOS/Android):

1. Instale o Capacitor:
   npm install @capacitor/core @capacitor/cli
   npm install @capacitor/android @capacitor/ios

2. Inicialize:
   npx cap init "Truco Tchê" "br.trucotche.app"

3. Adicione as plataformas:
   npx cap add android
   npx cap add ios

4. Copie os assets:
   npx cap copy

5. Abra no IDE:
   npx cap open android   (Android Studio)
   npx cap open ios       (Xcode)

Este HTML já inclui:
✅ PWA manifest
✅ Service Worker
✅ Apple meta tags  
✅ Theme color
✅ Viewport mobile
  `.trim();
  alert(instructions);
}

// ╔══════════════════════════════════════════════════════════════╗
//  PATCH INIT — wire everything together
// ╚══════════════════════════════════════════════════════════════╝

// Override the existing init block
const _origInit = () => {};

// Load auth state
loadAuth();

// Apply coach + voice config
document.addEventListener('DOMContentLoaded', () => {
  initVoice();
  _voiceEnabled = CFG.voice || false;
  _coachMode = CFG.coachMode || false;
  applyShopTheme();

  // Add Capacitor button to settings
  setTimeout(() => {
    const sheet = document.querySelector('.settings-sheet');
    if (sheet && !document.getElementById('cap-btn')) {
      const div = document.createElement('div');
      div.className = 'set-row';
      div.id = 'cap-btn';
      div.innerHTML = `<div><div class="set-lbl">App Nativo (Capacitor)</div><div class="set-sub">Publique na App Store / Google Play</div></div><button onclick="showCapacitorSetup()" style="background:var(--surf2);border:1px solid var(--bdr2);border-radius:999px;padding:.25rem .75rem;cursor:pointer;font-size:.72rem;color:var(--txt2)">Ver guia</button>`;
      sheet.insertBefore(div, sheet.querySelector('.mb'));
    }
  }, 200);
});

// Patch startGame for onboarding + coach + presence
// Patch deal for coach analysis
// Patch humanPlay for coach + replay
// Wire up voice toggle to the correct function
document.addEventListener('change', e => {
  if (e.target.id === 'cfg-voice') toggleVoice();
  if (e.target.id === 'cfg-coach') toggleCoachMode();
  if (e.target.id === 'cfg-15') toggleVariant15();
});

// Add "Ver Replay" to history entries
const _baseRenderHistory = renderHistory;
// Save replay with match history
const _baseSaveMatchHist = saveMatchHistory;
// ── Add regional ranking button to ranking screen ──
const _baseRenderRanking = renderRanking;
// ── Region selection in profile ──
const _baseRenderProfile2 = renderProfile;
// Truco Tchê v8 carregado

// ── Histórico de Partidas Online ──
async function renderOnlineHistory() {
  const el = document.getElementById('online-history-body');
  if (!el) return;
  el.innerHTML = '<div class="spinner" style="margin:2rem auto"></div>';
  try {
    const user = window.localUser || (typeof AUTH !== 'undefined' ? AUTH.user : null);
    if (!user) {
      el.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--txt3);font-size:.8rem">Faça login para ver seu histórico online.</div>';
      return;
    }
    const res = await fetch('/api/trpc/online.matchHistory', {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    });
    const json = await res.json();
    const matches = json?.result?.data ?? [];
    if (!matches.length) {
      el.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--txt3);font-size:.8rem">🌐 Nenhuma partida online registrada ainda.<br><br>Jogue sua primeira partida online!</div>';
      return;
    }
    const rows = matches.map(m => {
      const isP1 = m.player1Id === user.id;
      const myScore = isP1 ? m.scoreP1 : m.scoreP2;
      const oppScore = isP1 ? m.scoreP2 : m.scoreP1;
      const oppName = isP1 ? m.player2Name : m.player1Name;
      const won = m.winnerId === user.id;
      const date = new Date(m.playedAt).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit' });
      const dur = m.durationSeconds ? Math.floor(m.durationSeconds/60) + 'min' : '';
      const wo = m.isWalkover ? ' (W.O.)' : '';
      const resultColor = won ? 'var(--green)' : 'var(--red)';
      const resultLabel = won ? 'Vitória' : 'Derrota';
      return `<div style="display:flex;align-items:center;gap:.6rem;padding:.6rem .5rem;border-bottom:1px solid var(--bdr);">
        <div style="font-size:1.2rem">${won ? '🏆' : '💔'}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:.78rem;font-weight:700;color:var(--txt1)">${oppName}${wo}</div>
          <div style="font-size:.62rem;color:var(--txt3)">${date}${dur ? ' · ' + dur : ''} · ${m.mode.toUpperCase()}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:.9rem;font-weight:700;color:${resultColor}">${myScore}×${oppScore}</div>
          <div style="font-size:.6rem;color:${resultColor}">${resultLabel}</div>
        </div>
      </div>`;
    }).join('');
    el.innerHTML = `<div style="font-size:.65rem;color:var(--txt3);margin-bottom:.5rem;text-align:center">Últimas ${matches.length} partidas online</div>${rows}`;
  } catch(e) {
    el.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--red);font-size:.8rem">Erro ao carregar histórico. Tente novamente.</div>';
    console.error('[OnlineHistory]', e);
  }
}

// ─── BLOCK 4 ───
(function(){
  'use strict';

  // ─── tRPC helper (vanilla fetch) ───
  const TRPC_BASE = '/api/trpc';

  // tRPC 11 + superjson: body must be wrapped as {"json": {...}} and
  // query input must be wrapped as ?input={"json":{...}}
  async function trpcMutation(path, input) {
    const body = input !== undefined ? JSON.stringify({ json: input }) : JSON.stringify({ json: {} });
    const res = await fetch(`${TRPC_BASE}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body,
    });
    const json = await res.json();
    if (json.error) {
      const msg = json.error.json?.message || json.error.message || 'Erro desconhecido';
      throw new Error(msg);
    }
    // superjson response: result.data.json or result.data
    const data = json.result?.data;
    return data?.json !== undefined ? data.json : data;
  }

  async function trpcQuery(path, input) {
    const inputParam = input !== undefined
      ? `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`
      : '';
    const res = await fetch(`${TRPC_BASE}/${path}${inputParam}`, {
      method: 'GET',
      credentials: 'include',
    });
    const json = await res.json();
    if (json.error) {
      const msg = json.error.json?.message || json.error.message || 'Erro desconhecido';
      throw new Error(msg);
    }
    const data = json.result?.data;
    return data?.json !== undefined ? data.json : data;
  }

  async function loadRulesTestReport() {
    const target = document.getElementById('rules-tests-body');
    if (!target) return;
    target.innerHTML = '<div style="text-align:center;color:rgba(255,255,255,.65);padding:2rem"><div class="spinner" style="margin:0 auto .7rem"></div>Consultando cobertura automatizada...</div>';
    try {
      const report = await trpcQuery('rulesTests.report');
      const summary = report.summary || {};
      const groups = Array.isArray(report.groups) ? report.groups : [];
      let cards = groups.map(function(group, index) {
        const accents = ['#f2b23c', '#55a8e8', '#d379bb'];
        const scenarios = (group.scenarios || []).map(function(scenario) { return '<li style="display:flex;gap:.48rem;align-items:flex-start;margin:.42rem 0;color:rgba(255,255,255,.84);font-size:.76rem;line-height:1.35"><span style="color:#7be09a">✓</span><span>' + escapeRoomText(scenario) + '</span></li>'; }).join('');
        return '<section style="background:rgba(7,15,28,.52);border:1px solid ' + accents[index % accents.length] + ';border-radius:14px;padding:.9rem;margin:.8rem 0;box-shadow:0 8px 24px rgba(0,0,0,.15)"><div style="display:flex;justify-content:space-between;gap:.7rem;align-items:flex-start"><div><div style="font-family:Georgia,serif;color:' + accents[index % accents.length] + ';font-size:1.05rem;font-weight:700">' + escapeRoomText(group.title) + '</div><div style="color:rgba(255,255,255,.58);font-size:.7rem;margin-top:.22rem;line-height:1.35">' + escapeRoomText(group.description) + '</div></div><span style="background:rgba(123,224,154,.14);border:1px solid rgba(123,224,154,.35);color:#8ce9a9;border-radius:999px;padding:.22rem .46rem;font-size:.61rem;font-weight:800;white-space:nowrap">COBERTO</span></div><ul style="list-style:none;padding:0;margin:.7rem 0 0">' + scenarios + '</ul></section>';
      }).join('');
      const generatedAt = report.generatedAt ? new Date(report.generatedAt).toLocaleString('pt-BR') : 'agora';
      const execution = report.execution || { passed: 0, total: 0, overall: 'failed', checks: [] };
      const executionColor = execution.overall === 'passed' ? '#91efa9' : '#ff9a9a';
      const history = Array.isArray(report.history) ? report.history : [];
      const failedChecks = (execution.checks || []).filter(function(check) { return !check.passed; });
      const hasFailedExecution = execution.overall !== 'passed' || failedChecks.length > 0;
      const statusTitle = hasFailedExecution ? 'Verificação requer atenção' : 'Motor de Regras Validado';
      const statusDescription = hasFailedExecution ? 'Uma ou mais regras não passaram na autoverificação. Revise os checks destacados antes de publicar uma nova versão.' : 'Relatório administrativo da cobertura definida na suíte ' + escapeRoomText(report.suite || 'Vitest') + '.';
      const failureAlert = hasFailedExecution
        ? '<section id="rules-test-failure-alert" role="alert" aria-live="assertive" tabindex="-1" style="background:linear-gradient(135deg,rgba(119,24,37,.94),rgba(83,16,31,.92));border:1px solid #ff8f9c;border-left:5px solid #ff596d;border-radius:14px;padding:1rem;margin:.8rem 0;box-shadow:0 10px 28px rgba(105,12,27,.3)"><div style="display:flex;gap:.75rem;align-items:flex-start"><span aria-hidden="true" style="font-size:1.35rem;line-height:1">⚠</span><div style="min-width:0;flex:1"><div style="color:#fff1f3;font-weight:800;font-size:1rem">Falha detectada na autoverificação</div><div style="color:rgba(255,233,237,.86);font-size:.73rem;line-height:1.4;margin-top:.24rem"><strong>' + failedChecks.length + '</strong> check' + (failedChecks.length === 1 ? '' : 's') + ' reprovado' + (failedChecks.length === 1 ? '' : 's') + '. A execução exige revisão imediata.</div></div></div><ul style="list-style:none;padding:0;margin:.65rem 0 .8rem">' + failedChecks.map(function(check) { return '<li style="color:#ffe1e5;font-size:.72rem;margin:.3rem 0">• ' + escapeRoomText(check.title) + (check.detail ? ' — ' + escapeRoomText(check.detail) : '') + '</li>'; }).join('') + '</ul><button type="button" onclick="loadRulesTestReport()" style="background:#fff2f3;border:1px solid #ffc2ca;border-radius:8px;color:#8f1728;padding:.48rem .75rem;font-weight:800;cursor:pointer">↻ Executar novamente</button></section>'
        : '<div role="status" aria-live="polite" style="display:flex;align-items:center;gap:.42rem;color:#98efad;font-size:.7rem;padding:.15rem .1rem .35rem"><span aria-hidden="true">✓</span><span>Autoverificação aprovada; nenhuma intervenção é necessária.</span></div>';
      const mappedScenarios = groups.reduce(function(total, group) { return total + (Array.isArray(group.scenarios) ? group.scenarios.length : 0); }, 0);
      const mappedPercent = mappedScenarios > 0 ? 100 : 0;
      const executionPercent = Number(execution.total || 0) > 0 ? Math.round((Number(execution.passed || 0) / Number(execution.total || 0)) * 100) : 0;
      const coverageRows = groups.map(function(group, index) {
        const accent = ['#f2b23c', '#55a8e8', '#d379bb'][index % 3];
        const scenarioCount = Array.isArray(group.scenarios) ? group.scenarios.length : 0;
        return '<div style="margin:.55rem 0"><div style="display:flex;justify-content:space-between;gap:.7rem;color:rgba(255,255,255,.8);font-size:.7rem;margin-bottom:.28rem"><span>' + escapeRoomText(group.title) + '</span><strong style="color:' + accent + '">' + scenarioCount + '/' + scenarioCount + '</strong></div><div role="progressbar" aria-label="Cobertura de ' + escapeRoomText(group.title) + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100" style="height:7px;background:rgba(255,255,255,.1);border-radius:999px;overflow:hidden"><div style="width:100%;height:100%;background:linear-gradient(90deg,' + accent + ',#e8f5ea);border-radius:inherit"></div></div></div>';
      }).join('');
      const coverageChart = '<section style="background:linear-gradient(135deg,rgba(24,47,58,.7),rgba(37,35,67,.55));border:1px solid rgba(128,206,218,.36);border-radius:14px;padding:.9rem;margin:.8rem 0"><div style="display:flex;gap:.9rem;align-items:center"><div role="img" aria-label="Cobertura de cenários mapeados: ' + mappedPercent + '%" style="width:86px;height:86px;flex:0 0 86px;border-radius:50%;background:conic-gradient(#71d7d1 0 ' + mappedPercent + '%,rgba(255,255,255,.1) ' + mappedPercent + '% 100%);display:grid;place-items:center;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12)"><div style="width:65px;height:65px;border-radius:50%;background:#10232c;display:flex;align-items:center;justify-content:center;flex-direction:column"><strong style="color:#c8fbf5;font-size:1.1rem;line-height:1">' + mappedPercent + '%</strong><span style="color:rgba(255,255,255,.55);font-size:.48rem;text-transform:uppercase;margin-top:.18rem">Mapeado</span></div></div><div><div style="font-family:Georgia,serif;color:#c8fbf5;font-weight:700;font-size:1.02rem">Mapa de Cobertura</div><div style="color:rgba(255,255,255,.62);font-size:.7rem;line-height:1.35;margin-top:.22rem"><strong style="color:#fff">' + mappedScenarios + '/' + mappedScenarios + '</strong> cenários de regra catalogados nesta tela, distribuídos entre Truco, Envido e Flor.</div></div></div><div style="margin-top:.75rem">' + coverageRows + '</div></section>';
      const executionGroupRows = ['truco', 'envido', 'flor'].map(function(groupId, index) {
        const checks = (execution.checks || []).filter(function(check) { return check.group === groupId; });
        const passed = checks.filter(function(check) { return check.passed; }).length;
        const total = checks.length;
        const percent = total ? Math.round((passed / total) * 100) : 0;
        const title = { truco: 'Truco', envido: 'Envido', flor: 'Flor' }[groupId];
        const accent = ['#f2b23c', '#55a8e8', '#d379bb'][index];
        return '<div style="margin:.48rem 0"><div style="display:flex;justify-content:space-between;gap:.7rem;color:rgba(255,255,255,.8);font-size:.68rem;margin-bottom:.24rem"><span>' + title + '</span><strong style="color:' + (percent === 100 ? '#91efa9' : '#ff9a9a') + '">' + passed + '/' + total + ' · ' + percent + '%</strong></div><div role="progressbar" aria-label="Execução de checks de ' + title + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + percent + '" style="height:6px;background:rgba(255,255,255,.1);border-radius:999px;overflow:hidden"><div style="width:' + percent + '%;height:100%;background:linear-gradient(90deg,' + accent + ',' + executionColor + ');border-radius:inherit;transition:width 220ms cubic-bezier(.23,1,.32,1)"></div></div></div>';
      }).join('');
      const executionRows = (execution.checks || []).map(function(check) { return '<li style="display:flex;gap:.48rem;align-items:flex-start;margin:.35rem 0;color:rgba(255,255,255,.82);font-size:.72rem' + (check.passed ? '' : ';background:rgba(255,72,93,.13);border:1px solid rgba(255,143,156,.5);border-radius:7px;padding:.42rem .48rem') + '"><span style="color:' + (check.passed ? '#91efa9' : '#ff9a9a') + '">' + (check.passed ? '✓' : '✕') + '</span><span>' + escapeRoomText(check.title) + (check.passed ? '' : ' — ' + escapeRoomText(check.detail || 'Falhou')) + '</span></li>'; }).join('');
      const historyRows = history.slice(0, 10).map(function(item) {
        const isFailure = item.status === 'failed';
        const failed = Array.isArray(item.failedChecks) ? item.failedChecks : [];
        const executionId = Number(item.id) || 0;
        const createdAt = item.createdAt ? new Date(item.createdAt).toLocaleString('pt-BR') : 'agora';
        const detail = isFailure && failed.length ? failed.map(function(check) { return escapeRoomText(check.group || 'regra') + ': ' + escapeRoomText(check.title || 'Check reprovado'); }).join(' · ') : 'Nenhuma falha registrada';
        return '<li style="padding:.62rem 0;border-top:1px solid rgba(255,255,255,.09)"><div style="display:flex;justify-content:space-between;gap:.6rem;align-items:flex-start"><div style="min-width:0"><div style="color:' + (isFailure ? '#ffb6bf' : '#9cefb0') + ';font-size:.72rem;font-weight:800">' + (isFailure ? '⚠ Falha #' + executionId : '✓ Aprovada #' + executionId) + '</div><div style="color:rgba(255,255,255,.58);font-size:.64rem;margin-top:.18rem">' + escapeRoomText(createdAt) + ' · ' + Number(item.passedChecks || 0) + '/' + Number(item.totalChecks || 0) + ' checks · ' + escapeRoomText(item.executedByName || 'Administrador') + '</div><div style="color:rgba(255,255,255,.78);font-size:.66rem;line-height:1.35;margin-top:.22rem;overflow-wrap:anywhere">' + detail + '</div></div>' + (isFailure && executionId ? '<button type="button" onclick="exportRulesFailureCSV(' + executionId + ')" style="flex:0 0 auto;background:rgba(255,232,235,.12);border:1px solid rgba(255,158,170,.55);border-radius:7px;color:#ffd8dd;padding:.36rem .5rem;font-size:.62rem;font-weight:800;cursor:pointer">⇩ CSV</button>' : '') + '</div></li>';
      }).join('');
      const historySection = '<section aria-label="Histórico de autoverificações" style="background:rgba(18,23,39,.72);border:1px solid rgba(148,173,222,.32);border-radius:14px;padding:.9rem;margin:.8rem 0"><div style="display:flex;justify-content:space-between;gap:.6rem;align-items:center"><div><div style="font-family:Georgia,serif;color:#d8e6ff;font-size:1rem;font-weight:700">Histórico de execuções</div><div style="color:rgba(255,255,255,.56);font-size:.68rem;margin-top:.2rem">Últimas verificações persistidas para auditoria administrativa.</div></div><span style="color:#bcd3ff;font-size:.68rem;font-weight:800">' + history.length + ' registro' + (history.length === 1 ? '' : 's') + '</span></div><ul style="list-style:none;padding:0;margin:.58rem 0 0">' + (historyRows || '<li style="color:rgba(255,255,255,.56);font-size:.72rem;padding:.5rem 0">Nenhuma execução persistida ainda.</li>') + '</ul></section>';
      cards = failureAlert + coverageChart + '<section style="background:rgba(8,31,29,.58);border:1px solid ' + executionColor + ';border-radius:14px;padding:.9rem;margin:.8rem 0"><div style="display:flex;gap:.8rem;align-items:center"><div role="img" aria-label="Autoverificação aprovada em ' + executionPercent + '%" style="width:54px;height:54px;flex:0 0 54px;border-radius:50%;background:conic-gradient(' + executionColor + ' 0 ' + executionPercent + '%,rgba(255,255,255,.1) ' + executionPercent + '% 100%);display:grid;place-items:center"><div style="width:42px;height:42px;border-radius:50%;background:#10211f;display:flex;align-items:center;justify-content:center;color:' + executionColor + ';font-size:.68rem;font-weight:800">' + executionPercent + '%</div></div><div style="min-width:0;flex:1"><div style="font-family:Georgia,serif;color:' + executionColor + ';font-size:1.02rem;font-weight:700">Autoverificação em tempo real</div><div style="color:rgba(255,255,255,.58);font-size:.7rem;margin-top:.2rem">Checks determinísticos executados ao abrir este relatório.</div></div><strong style="color:' + executionColor + ';font-size:1.05rem">' + Number(execution.passed || 0) + '/' + Number(execution.total || 0) + '</strong></div><div style="margin-top:.7rem">' + executionGroupRows + '</div><ul style="list-style:none;padding:0;margin:.7rem 0 0">' + executionRows + '</ul></section>' + cards;
      cards += historySection;
      target.innerHTML = '<section style="background:linear-gradient(135deg,' + (hasFailedExecution ? 'rgba(111,31,45,.78),rgba(76,23,43,.78)' : 'rgba(40,112,91,.72),rgba(20,55,77,.72)') + ');border:1px solid ' + (hasFailedExecution ? 'rgba(255,143,156,.66)' : 'rgba(112,216,180,.5)') + ';border-radius:16px;padding:1rem"><div style="display:flex;justify-content:space-between;gap:.7rem;align-items:flex-start"><div><div style="font-family:Georgia,serif;color:' + (hasFailedExecution ? '#ffe2e6' : '#d6f6da') + ';font-size:1.1rem;font-weight:700">' + statusTitle + '</div><div style="color:rgba(255,255,255,.72);font-size:.7rem;margin-top:.3rem">' + statusDescription + '</div></div><span style="color:' + (hasFailedExecution ? '#ffb0ba' : '#a5f4b9') + ';font-size:1.35rem" aria-hidden="true">' + (hasFailedExecution ? '⚠' : '🛡️') + '</span></div><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem;margin-top:.9rem"><div style="background:rgba(0,0,0,.18);border-radius:10px;padding:.55rem;text-align:center"><div style="color:#fff;font-weight:800;font-size:1.15rem">' + Number(summary.covered || 0) + '</div><div style="color:rgba(255,255,255,.62);font-size:.58rem;text-transform:uppercase">Cenários</div></div><div style="background:rgba(0,0,0,.18);border-radius:10px;padding:.55rem;text-align:center"><div style="color:#fff;font-weight:800;font-size:1.15rem">' + Number(summary.categories || 0) + '</div><div style="color:rgba(255,255,255,.62);font-size:.58rem;text-transform:uppercase">Grupos</div></div><div style="background:rgba(0,0,0,.18);border-radius:10px;padding:.55rem;text-align:center"><div style="color:#fff;font-weight:800;font-size:.82rem;padding-top:.14rem">' + escapeRoomText(summary.runner || 'Vitest') + '</div><div style="color:rgba(255,255,255,.62);font-size:.58rem;text-transform:uppercase">Executor</div></div></div></section>' + cards + '<div style="text-align:center;color:rgba(255,255,255,.4);font-size:.62rem;padding:.55rem 0">Relatório consultado em ' + escapeRoomText(generatedAt) + '. Execute a suíte de CI para validar uma nova revisão de código.</div>';
      if (hasFailedExecution) {
        const alert = document.getElementById('rules-test-failure-alert');
        if (alert && typeof alert.focus === 'function') alert.focus();
      }
    } catch (error) {
      target.innerHTML = '<section style="text-align:center;padding:2rem;background:rgba(126,25,34,.22);border:1px solid rgba(246,122,135,.42);border-radius:14px"><div style="font-size:1.4rem">⚠️</div><div style="color:#ffc0c6;font-weight:700;margin-top:.4rem">Relatório indisponível</div><div style="color:rgba(255,255,255,.62);font-size:.72rem;margin:.4rem 0 .8rem">A página exige uma sessão de administrador válida.</div><button onclick="loadRulesTestReport()" style="background:#246e5e;border:0;border-radius:8px;color:#fff;padding:.45rem .75rem;font-weight:800;cursor:pointer">Tentar novamente</button></section>';
    }
  }
  window.loadRulesTestReport = loadRulesTestReport;

  var _rulesFailureMonitor = null;
  var _rulesFailurePollInFlight = false;

  function getRulesFailureMonitorUser() {
    return window.localUser || (typeof AUTH !== 'undefined' ? AUTH.user : null);
  }

  function isRulesFailureMonitorAdmin(user) {
    return !!(user && (user.role === 'admin' || (user.email && user.email.toLowerCase() === 'gerentewilliam.pinheiro@gmail.com')));
  }

  function getRulesFailureSeenKey() {
    const user = getRulesFailureMonitorUser();
    return user && user.id ? 'truco_rules_failure_seen_' + user.id : null;
  }

  function getRulesFailureSeenId() {
    const key = getRulesFailureSeenKey();
    return key ? Number(localStorage.getItem(key) || 0) || 0 : 0;
  }

  function markRulesFailureSeen(executionId) {
    const key = getRulesFailureSeenKey();
    if (!key || !Number.isInteger(Number(executionId))) return;
    localStorage.setItem(key, String(Math.max(getRulesFailureSeenId(), Number(executionId))));
  }

  function handleRulesTestFailureAlert(event) {
    const executionId = Number(event && event.executionId) || 0;
    if (executionId && executionId <= getRulesFailureSeenId()) return;
    if (executionId) markRulesFailureSeen(executionId);
    const failed = Array.isArray(event && event.failedChecks) ? event.failedChecks : [];
    const first = failed[0] && failed[0].title ? ': ' + failed[0].title : '';
    toast('⚠️ Falha nas regras detectada' + first, 'warn');
    const testsScreen = document.getElementById('rules-tests-scr');
    if (testsScreen && testsScreen.classList.contains('on')) loadRulesTestReport();
  }

  async function pollRulesTestFailures() {
    if (_rulesFailurePollInFlight || !isRulesFailureMonitorAdmin(getRulesFailureMonitorUser())) return;
    _rulesFailurePollInFlight = true;
    try {
      const failures = await trpcQuery('rulesTests.latestFailures', { afterId: getRulesFailureSeenId() });
      (Array.isArray(failures) ? failures : []).forEach(function(failure) {
        handleRulesTestFailureAlert({
          executionId: failure.id,
          passed: failure.passedChecks,
          total: failure.totalChecks,
          failedChecks: failure.failedChecks,
          createdAt: failure.createdAt,
        });
      });
    } catch (_) {
      // O Socket.IO continua cobrindo a instância local; a próxima consulta tenta novamente.
    } finally {
      _rulesFailurePollInFlight = false;
    }
  }

  function startRulesFailureMonitor() {
    if (!isRulesFailureMonitorAdmin(getRulesFailureMonitorUser()) || _rulesFailureMonitor) return;
    pollRulesTestFailures();
    _rulesFailureMonitor = setInterval(pollRulesTestFailures, 3000);
  }

  function stopRulesFailureMonitor() {
    if (_rulesFailureMonitor) clearInterval(_rulesFailureMonitor);
    _rulesFailureMonitor = null;
  }
  window.startRulesFailureMonitor = startRulesFailureMonitor;
  window.stopRulesFailureMonitor = stopRulesFailureMonitor;

  async function exportRulesFailureCSV(executionId) {
    if (!Number.isInteger(Number(executionId)) || Number(executionId) <= 0) {
      toast('Diagnóstico inválido para exportação.', 'warn');
      return;
    }
    try {
      const data = await trpcQuery('rulesTests.exportFailure', { executionId: Number(executionId) });
      const blob = new Blob(['\uFEFF' + String(data.csv || '')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = String(data.filename || 'diagnostico-regras.csv');
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast('Diagnóstico exportado em CSV.', 'win');
    } catch (error) {
      toast(error && error.message ? error.message : 'Não foi possível exportar o diagnóstico.', 'warn');
    }
  }
  window.exportRulesFailureCSV = exportRulesFailureCSV;

  // ─── Local user state ───
  let localUser = JSON.parse(localStorage.getItem('truco_local_user') || 'null');
  let resetToken = null;

  function saveLocalUser(u) {
    localUser = u;
    window.localUser = u;
    if (u) localStorage.setItem('truco_local_user', JSON.stringify(u));
    else localStorage.removeItem('truco_local_user');
    updateHomeCTA();
  }

  // ─── PIN digit inputs ───
  function setupPinInputs() {
    document.querySelectorAll('.la-pin-row').forEach(row => {
      const digits = row.querySelectorAll('.la-pin-digit');
      digits.forEach((inp, i) => {
        inp.addEventListener('input', e => {
          const v = e.target.value.replace(/\D/g, '');
          e.target.value = v.slice(0, 1);
          if (v && i < 5) digits[i + 1].focus();
          e.target.classList.toggle('filled', !!v);
        });
        inp.addEventListener('keydown', e => {
          if (e.key === 'Backspace' && !inp.value && i > 0) {
            digits[i - 1].focus();
            digits[i - 1].value = '';
            digits[i - 1].classList.remove('filled');
          }
        });
        inp.addEventListener('paste', e => {
          e.preventDefault();
          const text = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, 6);
          text.split('').forEach((ch, j) => {
            if (digits[j]) {
              digits[j].value = ch;
              digits[j].classList.toggle('filled', !!ch);
            }
          });
          if (text.length > 0) digits[Math.min(text.length, 5)].focus();
        });
      });
    });
  }

  function getPin(rowId) {
    const digits = document.querySelectorAll(`#${rowId} .la-pin-digit`);
    let pin = '';
    digits.forEach(d => pin += d.value);
    return pin;
  }

  function clearPin(rowId) {
    document.querySelectorAll(`#${rowId} .la-pin-digit`).forEach(d => {
      d.value = '';
      d.classList.remove('filled');
    });
  }

  // ─── Screen switching ───
  window.laShowScreen = function(screenId) {
    document.querySelectorAll('#m-auth .la-screen').forEach(s => s.classList.add('hidden'));
    const el = document.getElementById(screenId);
    if (el) el.classList.remove('hidden');
    // Clear errors
    document.querySelectorAll('.la-error').forEach(e => { e.classList.add('hidden'); e.textContent = ''; });
  };

  function showError(id, msg) {
    const el = document.getElementById(id);
    if (el) { el.textContent = msg; el.classList.remove('hidden'); }
  }

  // ─── States list ───
  const BR_STATES = [
    'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA',
    'PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'
  ];

  function populateStates() {
    const sel = document.getElementById('rg-state');
    if (!sel) return;
    BR_STATES.forEach(uf => {
      const opt = document.createElement('option');
      opt.value = uf; opt.textContent = uf;
      sel.appendChild(opt);
    });
  }

  window.localLoadCities = function() {
    // Simple: just let user type the city
  };

  // ─── Register ───
  window.localRegister = async function() {
    const name = document.getElementById('rg-name')?.value.trim();
    const email = document.getElementById('rg-email')?.value.trim();
    const phone = document.getElementById('rg-phone')?.value.trim();
    const state = document.getElementById('rg-state')?.value;
    const city = document.getElementById('rg-city')?.value.trim();
    const pin = getPin('rg-pin-row');

    if (!name || name.length < 2) return showError('rg-error', 'Informe seu nome (mínimo 2 caracteres)');
    if (!email || !email.includes('@')) return showError('rg-error', 'Informe um e-mail válido');
    if (!/^\d{6}$/.test(pin)) return showError('rg-error', 'O PIN deve ter exatamente 6 dígitos numéricos');

    const btn = document.getElementById('rg-submit');
    btn.disabled = true; btn.textContent = 'Criando...';

    try {
      const data = await trpcMutation('localAuth.register', { name, email, phone: phone || undefined, state: state || undefined, city: city || undefined, pin });
      saveLocalUser(data.user);
      updateLoggedScreen();
      updateHomeCTA();
      if (typeof loadPilasBalance === 'function') loadPilasBalance();
      clearPin('rg-pin-row');
      // Se havia ação pendente, executa após fechar o modal
      const pendingChar = window._pendingGameChar;
      if (pendingChar) {
        window._pendingGameChar = null;
        closeModal('m-auth');
        setTimeout(() => {
          if (pendingChar === 'online') {
            openOnlineLobby();
          } else if (pendingChar === 'ai-section') {
            toggleAISection();
          } else if (pendingChar === 'tournament') {
            startTournament();
          } else {
            startGame(pendingChar); show('game');
          }
        }, 200);
      } else {
        laShowScreen('la-logged');
      }
    } catch (e) {
      showError('rg-error', e.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Criar minha conta';
    }
  };

  // ─── Login ───
  window.localLogin = async function() {
    const email = document.getElementById('li-email')?.value.trim();
    const pin = getPin('li-pin-row');

    if (!email || !email.includes('@')) return showError('li-error', 'Informe um e-mail válido');
    if (!/^\d{6}$/.test(pin)) return showError('li-error', 'O PIN deve ter exatamente 6 dígitos');

    const btn = document.getElementById('li-submit');
    btn.disabled = true; btn.textContent = 'Entrando...';

    try {
      const data = await trpcMutation('localAuth.login', { email, pin });
      saveLocalUser(data.user);
      updateLoggedScreen();
      updateHomeCTA();
      checkAdminAccess();
      if (typeof loadPilasBalance === 'function') loadPilasBalance();
      clearPin('li-pin-row');
      // Limpar mensagem informativa
      const infoEl = document.getElementById('la-login-info');
      if (infoEl) { infoEl.textContent = ''; infoEl.classList.add('hidden'); }
      // Se havia ação pendente, executa após fechar o modal
      const pendingChar = window._pendingGameChar;
      if (pendingChar) {
        window._pendingGameChar = null;
        closeModal('m-auth');
        setTimeout(() => {
          if (pendingChar === 'online') {
            openOnlineLobby();
          } else if (pendingChar === 'ai-section') {
            toggleAISection();
          } else if (pendingChar === 'tournament') {
            startTournament();
          } else {
            startGame(pendingChar); show('game');
          }
        }, 200);
      } else {
        laShowScreen('la-logged');
      }
    } catch (e) {
      showError('li-error', e.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Entrar';
    }
  };

  // ─── Forgot PIN ───
  window.localForgotPin = async function() {
    const email = document.getElementById('fp-email')?.value.trim();
    if (!email || !email.includes('@')) return showError('fp-error', 'Informe um e-mail válido');

    const btn = document.querySelector('#la-forgot-step1 .la-btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }
    try {
      // Sugestão 1: token is sent via email, not returned in response
      await trpcMutation('localAuth.forgotPin', { email, origin: window.location.origin });
      document.getElementById('la-forgot-step1').style.display = 'none';
      document.getElementById('la-forgot-step2').style.display = 'block';
    } catch (e) {
      showError('fp-error', e.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Enviar link por e-mail'; }
    }
  };

  // ─── Reset PIN ───
  window.localResetPin = async function() {
    const newPin = getPin('fp-pin-row');
    if (!/^\d{6}$/.test(newPin)) return showError('fp-error2', 'O PIN deve ter exatamente 6 dígitos');
    // Sugestão 1: token is read from the input field (pasted from email link)
    const tokenInput = document.getElementById('fp-token-display')?.value?.trim();
    if (!tokenInput) return showError('fp-error2', 'Cole o token recebido por e-mail.');

    try {
      await trpcMutation('localAuth.resetPin', { resetToken: tokenInput, newPin });
      resetToken = null;
      // Fetch profile after reset (auto-login)
      const profile = await trpcQuery('localAuth.profile');
      saveLocalUser(profile);
      laShowScreen('la-logged');
      updateLoggedScreen();
      clearPin('fp-pin-row');
      document.getElementById('la-forgot-step1').style.display = 'block';
      document.getElementById('la-forgot-step2').style.display = 'none';
    } catch (e) {
      showError('fp-error2', e.message);
    }
  };

  // ─── Logout ───
  window.localLogout = async function() {
    try {
      await trpcMutation('auth.logout', {});
    } catch (e) { /* ignore */ }
    saveLocalUser(null);
    laShowScreen('la-login');
  };

  // ─── Login com Google via Manus OAuth ───
  // Busca a URL do servidor (que tem acesso às variáveis de ambiente VITE_*)
  // e redireciona o usuário para o portal Manus, que suporta login com Google,
  // GitHub, Microsoft e outros provedores sociais.
  window.loginWithGoogle = async function() {
    const btn = document.getElementById('btn-google-login') || document.getElementById('btn-google-register');
    if (btn) { btn.disabled = true; btn.querySelector('span').textContent = 'Redirecionando...'; }
    try {
      const res = await trpcQuery('auth.loginUrl', { origin: window.location.origin });
      if (res && res.url) {
        window.location.href = res.url;
      } else {
        toast('Não foi possível obter a URL de login. Tente novamente.', 'lose');
        if (btn) { btn.disabled = false; btn.querySelector('span').textContent = btn.id === 'btn-google-login' ? 'Entrar com Google' : 'Cadastrar com Google'; }
      }
    } catch (e) {
      toast('Erro ao conectar com o servidor: ' + (e.message || 'Tente novamente'), 'lose');
      if (btn) { btn.disabled = false; btn.querySelector('span').textContent = btn.id === 'btn-google-login' ? 'Entrar com Google' : 'Cadastrar com Google'; }
    }
  };

  // ─── Update logged screen ───
  function updateLoggedScreen() {
    if (!localUser) return;
    const s = (id, txt) => { const e = document.getElementById(id); if (e) e.textContent = txt; };
    s('la-logged-name', localUser.name || 'Gaudério');
    s('la-logged-info', localUser.email || '');
    s('la-uc-email', localUser.email || '—');
    s('la-uc-phone', localUser.phone || '—');
    const loc = [localUser.city, localUser.state].filter(Boolean).join(' – ');
    s('la-uc-loc', loc || '—');
  }

  // ─── Home CTA ───
  function updateHomeCTA() {
    const ctaReg = document.getElementById('home-auth-cta');
    const ctaLog = document.getElementById('home-auth-logged');
    if (!ctaReg || !ctaLog) return;
    if (localUser) {
      ctaReg.style.display = 'none';
      ctaLog.style.display = 'block';
      const hclN = document.getElementById('hcl-name'); if (hclN) hclN.textContent = localUser.name || 'Gaudério';
      const hclI = document.getElementById('hcl-info'); if (hclI) hclI.textContent = localUser.email || 'Clique para ver perfil';
      const pbName = document.getElementById('pb-name'); if (pbName) pbName.textContent = localUser.name || 'Peão';
    } else {
      ctaReg.style.display = 'block';
      ctaLog.style.display = 'none';
    }
    setTimeout(refreshHomeActiveRooms, 0);
  }

  // ─── History ───
  window.openHistoryModal = function() {
    closeModal('m-auth');
    setTimeout(() => {
      openModal('m-history');
      loadHistory('day');
    }, 200);
  };

  window.loadHistory = async function(period) {
    // Update active tab
    document.querySelectorAll('.hpt').forEach(b => b.classList.toggle('active', b.dataset.period === period));

    const listEl = document.getElementById('hist-list');
    listEl.innerHTML = '<div class="hist-empty">Carregando...</div>';

    try {
      const data = await trpcQuery('localAuth.history', { period });
      // Stats
      document.getElementById('hs-wins').textContent = data.stats.wins;
      document.getElementById('hs-losses').textContent = data.stats.losses;
      document.getElementById('hs-rate').textContent = data.stats.winRate + '%';

      // List
      if (!data.matches || data.matches.length === 0) {
        listEl.innerHTML = '<div class="hist-empty">Nenhuma partida neste período</div>';
        return;
      }

      listEl.innerHTML = data.matches.map(m => {
        const isWin = m.result === 'win';
        const dt = new Date(m.playedAt);
        const dateStr = dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        const timeStr = dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        return `<div class="hist-item ${isWin ? 'win' : 'lose'}">
          <span class="hi-ico">${m.characterAvatar || '🤠'}</span>
          <div class="hi-info">
            <div class="hi-char">${m.characterName || 'Adversário'}</div>
            <div class="hi-score">${m.score}</div>
          </div>
          <div style="text-align:right">
            <div class="hi-result ${isWin ? 'win' : 'lose'}">${isWin ? 'VITÓRIA' : 'DERROTA'}</div>
            <div class="hi-date">${dateStr} ${timeStr}</div>
          </div>
        </div>`;
      }).join('');
    } catch (e) {
      listEl.innerHTML = `<div class="hist-empty">❌ ${e.message}</div>`;
    }
  };

  // ─── Save match (called from endGame) ───
  window.saveMatchToServer = async function(result, scoreText, charName, charAvatar, durationSec, scorePlayer, scoreOpponent) {
    if (!localUser) return;
    try {
      await trpcMutation('localAuth.saveMatch', {
        result,
        score: scoreText,
        scorePlayer: typeof scorePlayer === 'number' ? scorePlayer : undefined,
        scoreOpponent: typeof scoreOpponent === 'number' ? scoreOpponent : undefined,
        characterName: charName || undefined,
        characterAvatar: charAvatar || undefined,
        durationSeconds: durationSec || undefined,
      });
    } catch (e) {
      console.warn('[History] Failed to save match:', e.message);
    }
  };

  // ─── Check session on load ───
  async function checkSession() {
    try {
      const profile = await trpcQuery('localAuth.profile');
      if (profile && profile.id) {
        saveLocalUser(profile);
        updateLoggedScreen();
        if (typeof loadPilasBalance === 'function') loadPilasBalance();

        // Detecta retorno do OAuth com vinculação de conta
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('linked') === 'google') {
          // Remove o parâmetro da URL sem recarregar a página
          const cleanUrl = window.location.pathname + (window.location.hash || '');
          window.history.replaceState({}, '', cleanUrl);
          // Mostra toast de sucesso após um pequeno delay
          setTimeout(() => {
            toast('🎉 Conta Google vinculada com sucesso! Seu histórico foi preservado.', 'success', 5000);
          }, 800);
        }
      }
    } catch (e) {
      // Not logged in — show register CTA
      saveLocalUser(null);
    }
  }

  // ─── Init ───
  document.addEventListener('DOMContentLoaded', () => {
    setupPinInputs();
    populateStates();
    updateHomeCTA();
    if (localUser) updateLoggedScreen();
    // Verify session with server
    setTimeout(checkSession, 500);
  });

  // If DOM already loaded
  if (document.readyState !== 'loading') {
    setupPinInputs();
    populateStates();
    updateHomeCTA();
    if (localUser) updateLoggedScreen();
    setTimeout(checkSession, 500);
  }

  // Expor globalmente para outros scripts
  window.trpcMutation = trpcMutation;
  window.trpcQuery = trpcQuery;
  window.loadRulesTestReport = loadRulesTestReport;
  window.exportRulesFailureCSV = exportRulesFailureCSV;
  window.handleRulesTestFailureAlert = handleRulesTestFailureAlert;
  window.startRulesFailureMonitor = startRulesFailureMonitor;
  window.stopRulesFailureMonitor = stopRulesFailureMonitor;
  window.localUser = localUser;
  window.saveLocalUser = function(u) {
    localUser = u;
    window.localUser = u;
    if (u) localStorage.setItem('truco_local_user', JSON.stringify(u));
    else localStorage.removeItem('truco_local_user');
    updateHomeCTA();
    if (u) updateLoggedScreen();
  };

})();

// ─── BLOCK 5 ───
// ╔═══════════════════════════════════════════════════════════════════╗
//  MULTIPLAYER ONLINE — Socket.io (Server-Authoritative)
// ╚═══════════════════════════════════════════════════════════════════╝

// ── Estado global do online (Socket.io) ──
// (variáveis já declaradas globalmente no primeiro script para evitar ReferenceError)
// sio, sioConnected, sioRoom, sioRole, sioOpponentName, sioMyName, sioInQueue, sioGameState, sioGameActive
// Reconnection state
var sioReconnectAttempts = 0;
var sioReconnectTimer = null;
var sioOpponentGracePeriod = null; // countdown timer for opponent walkover
var sioStateSyncTimer = null;
if (!sioRoom) sioRoom = sessionStorage.getItem('truco_active_room') || null;
const SIO_MAX_RECONNECT_ATTEMPTS = 8;

// ── Connection status banner ──
function showConnectionBanner(state, msg) {
  let banner = document.getElementById('sio-conn-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'sio-conn-banner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;padding:.5rem 1rem;text-align:center;font-size:.85rem;font-weight:600;transition:all .3s';
    document.body.appendChild(banner);
  }
  if (state === 'hidden') { banner.style.display = 'none'; return; }
  const styles = {
    connected:     { bg: '#22c55e', color: '#fff' },
    reconnecting:  { bg: '#f59e0b', color: '#fff' },
    disconnected:  { bg: '#ef4444', color: '#fff' },
    opponent_away: { bg: '#8b5cf6', color: '#fff' },
  };
  const s = styles[state] || styles.disconnected;
  banner.style.background = s.bg;
  banner.style.color = s.color;
  banner.style.display = 'block';
  banner.textContent = msg;
}

// ── Attempt reconnection with exponential backoff ──
function attemptReconnect() {
  if (sioReconnectAttempts >= SIO_MAX_RECONNECT_ATTEMPTS) {
    showConnectionBanner('disconnected', '❌ Não foi possível reconectar. Recarregue a página.');
    return;
  }
  const delay = Math.min(1000 * Math.pow(2, sioReconnectAttempts), 30000);
  sioReconnectAttempts++;
  showConnectionBanner('reconnecting', `🔄 Reconectando... tentativa ${sioReconnectAttempts} (aguarde ${Math.round(delay/1000)}s)`);
  sioReconnectTimer = setTimeout(() => {
    if (sio) sio.connect();
  }, delay);
}

// ── Try to rejoin active game after reconnecting ──
function tryRejoinGame() {
  const user = window.localUser || (typeof AUTH !== 'undefined' ? AUTH.user : null);
  if (!user || !sio || !sioConnected || !sioAuthenticated) return;
  sio.emit('reconnect_game', {}, (res) => {
    if (res && res.success) {
      sioRoom = res.roomCode;
      sioRole = res.role;
      sioGameActive = true;
      showConnectionBanner('connected', '✅ Reconectado! Retomando partida...');
      setTimeout(() => showConnectionBanner('hidden'), 3000);
      show('online-game');
      scheduleOnlineStateSync();
    } else if (sioRoom) {
      // A sala pode estar aguardando início em outra instância. Continue
      // consultando o snapshot até que a partida ativa exista no banco.
      scheduleOnlineStateSync();
    }
  });
}

const ONLINE_STATE_SYNC_WAITING_MS = 700;
const ONLINE_STATE_SYNC_PLAYING_MS = 1200;

function syncOnlineStateNow() {
  if (!sio || !sioConnected || !sioAuthenticated || (!sioGameActive && !sioRoom)) return;
  sio.emit('sync_game_state', {}, () => {});
}

function scheduleOnlineStateSync() {
  if (sioStateSyncTimer) return;
  const sync = () => {
    sioStateSyncTimer = null;
    if (!sio || !sioConnected || !sioAuthenticated || (!sioGameActive && !sioRoom)) return;
    syncOnlineStateNow();
    sioStateSyncTimer = setTimeout(sync, sioGameActive ? ONLINE_STATE_SYNC_PLAYING_MS : ONLINE_STATE_SYNC_WAITING_MS);
  };
  sioStateSyncTimer = setTimeout(sync, sioGameActive ? ONLINE_STATE_SYNC_PLAYING_MS : ONLINE_STATE_SYNC_WAITING_MS);
}

function stopOnlineStateSync() {
  if (sioStateSyncTimer) clearTimeout(sioStateSyncTimer);
  sioStateSyncTimer = null;
}

function recoverWaitingRoom() {
  if (!sio || !sioConnected || !sioAuthenticated || sioGameActive) return;
  sio.emit('recover_waiting_room', {}, (res) => {
    if (!res?.found) return;
    sioRoom = res.code;
    sioRole = 'p1';
    sessionStorage.setItem('truco_active_room', res.code);
    scheduleOnlineStateSync();
  });
}

function restorePendingOnlineNegotiation(state) {
  if (!state || state.turn !== state.myRole) return;
  const callerName = (role) => role === state.myRole ? state.myName : state.opponentName;
  if (state.phase === 'truco_neg' && !document.getElementById('m-online-truco')) {
    showOnlineTrucoModal({ level: state.trucoLevel, callerName: callerName(state.trucoCaller) });
  }
  if (state.phase === 'envido_neg' && !document.getElementById('m-online-envido')) {
    showOnlineEnvidoModal({
      action: (state.envidoChain || []).slice(-1)[0] || 'envido',
      bet: state.envidoBet,
      callerName: callerName(state.envidoCaller),
    });
  }
  if (state.phase === 'flor_neg' && !document.getElementById('m-online-flor')) {
    showOnlineFlorModal({
      action: (state.florChain || []).slice(-1)[0] || 'flor',
      bet: state.florBet,
      callerName: callerName(state.florCaller),
    });
  }
}

// ── Socket.io Connection ──
var sioAuthenticated = false;
var _sioAuthCallbacks = Array.isArray(_sioAuthCallbacks) ? _sioAuthCallbacks : []; // callbacks waiting for auth
function _sioDoAuth(onAuthenticated) {
  sioAuthenticated = false;
  const user = window.localUser || (typeof AUTH !== 'undefined' ? AUTH.user : null);
  if (user) {
    sioMyName = user.name || user.email || 'Jogador';
    sio.emit('auth', { userId: user.id, userName: sioMyName }, function(res) {
      if (!res || !res.success) return;
      sioAuthenticated = true;
      console.log('[SIO] Auth confirmed for', sioMyName);
      // Flush pending callbacks
      var cbs = Array.isArray(_sioAuthCallbacks) ? _sioAuthCallbacks.splice(0) : [];
      cbs.forEach(function(fn) { fn(); });
      if (typeof onAuthenticated === 'function') onAuthenticated();
    });
  }
}
function waitForAuth(cb) {
  if (sio && sioConnected && sioAuthenticated) { cb(); return; }
  if (!Array.isArray(_sioAuthCallbacks)) _sioAuthCallbacks = [];
  _sioAuthCallbacks.push(cb);
  if (!sio || !sioConnected) ensureSocket();
}
function ensureSocket() {
  if (sio && sioConnected) return sio;
  // Usar _sioFn capturado antes do spaceEditor sobrescrever window.io
  var _ioFn = window._sioFn || (typeof io === 'function' && typeof io.Manager !== 'undefined' ? io : null);
  if (!_ioFn) {
    // socket.io-client not yet loaded (should not happen with inline script tag)
    console.warn('[SIO] socket.io-client nao carregado. Tentando novamente em 500ms...');
    setTimeout(ensureSocket, 500);
    return null;
  }
  console.log('[SIO] Current page URL:', window.location.href);
  console.log('[SIO] Connecting to:', window.location.origin + '/api/socketio');
  sio = _ioFn(window.location.origin, { path: '/api/socketio', transports: ['websocket', 'polling'] });
  sio.on('connect', () => {
    sioConnected = true;
    sioReconnectAttempts = 0;
    if (sioReconnectTimer) { clearTimeout(sioReconnectTimer); sioReconnectTimer = null; }
    console.log('[SIO] Connected:', sio.id);
    showConnectionBanner('hidden');
    // Authenticate before requesting a reconnection, so identity is verified server-side.
    _sioDoAuth(function() {
      tryRejoinGame();
      recoverWaitingRoom();
      // Atualiza o painel inicial pela consulta persistida após toda reconexão.
      refreshHomeActiveRooms();
    });
  });
  sio.on('connect_error', (error) => {
    console.error('[SIO] Connection error:', error.message || error);
    console.error('[SIO] Error details:', { type: error.type, data: error.data });
  });
  
  sio.on('disconnect', (reason) => {
    sioConnected = false;
    sioAuthenticated = false;
    console.warn('[SIO] Disconnected:', reason);
    if (reason === 'io server disconnect') {
      console.log('[SIO] Server forced disconnect, attempting to reconnect...');
      sio.connect();
    }
    // Only auto-reconnect if we were in an active game and it wasn't intentional
    if (sioGameActive && reason !== 'io client disconnect') {
      attemptReconnect();
    }
  });

  // A lista recebida por Socket.IO pode pertencer somente à instância local.
  // Trate eventos de sala como invalidação e consulte a fonte persistida.
  function refreshRoomsAfterInvalidation() {
    var panel = document.getElementById('active-rooms-panel');
    if (panel && panel.style.display !== 'none') refreshActiveRooms();
    else refreshHomeActiveRooms();
  }
  sio.on('rooms_invalidated', refreshRoomsAfterInvalidation);
  sio.on('rooms_updated', refreshRoomsAfterInvalidation);

  sio.on('friend_game_invite', function(invite) {
    toast((invite.senderName || 'Um amigo') + ' enviou um convite privado!', 'info');
    if (document.getElementById('friends-scr') && document.getElementById('friends-scr').classList.contains('on')) loadFriendsData();
  });

  sio.on('friendship_updated', function(event) {
    var message = event.kind === 'request' ? (event.senderName || 'Um jogador') + ' enviou uma solicitação de amizade.' : event.kind === 'accepted' ? (event.senderName || 'Um jogador') + ' aceitou sua amizade!' : (event.senderName || 'Um jogador') + ' recusou a solicitação de amizade.';
    toast(message, event.kind === 'accepted' ? 'win' : 'info');
    if (document.getElementById('friends-scr') && document.getElementById('friends-scr').classList.contains('on')) loadFriendsData();
  });

  sio.on('rules_test_failure', function(event) {
    if (typeof window.handleRulesTestFailureAlert === 'function') window.handleRulesTestFailureAlert(event);
  });

  // ── Game Events ──
  sio.on('game_started', (data) => {
    sioGameActive = true;
    scheduleOnlineStateSync();
    // Parar countdown da sala
    stopRoomCountdown();
    // Limpar chat do lobby
    const lc = document.getElementById('sio-lobby-chat');
    const lca = document.getElementById('sio-lobby-chat-area');
    if (lc) lc.style.display = 'none';
    if (lca) lca.innerHTML = '';
    // Garantir que todos os jogadores vão para a tela de jogo
    show('online-game');
  });

  sio.on('in_person_players_updated', (data) => {
    if (!data?.code || (_inPersonTableInvite && _inPersonTableInvite.code !== data.code)) return;
    _inPersonTableInvite = { ...(_inPersonTableInvite || {}), ...data, code: data.code };
    renderInPersonParticipants(_inPersonTableInvite);
    const total = Array.isArray(data.participants) ? data.participants.length : 0;
    setInPersonScannerStatus(total < data.maxPlayers ? `${total}/${data.maxPlayers} jogadores na mesa. Aguardando a roda completar.` : 'Mesa completa. Preparando a partida...');
  });

  sio.on('game_state', (data) => {
    if (data && (data.reconnected || data.synchronized)) {
      sioGameActive = true;
      if (document.getElementById('online-game') && !document.getElementById('online-game').classList.contains('on')) show('online-game');
      scheduleOnlineStateSync();
      restorePendingOnlineNegotiation(data);
    }
    window._ogOpponentPresence = 'online';
    sioGameState = data;
    if (data && Array.isArray(data.roundWins) && data.roundWins.length === 0 && window._ogResolvedTrick) {
      clearOnlineResolvedTrick();
    }
    renderOnlineGame(data);
  });

  sio.on('round_result', (data) => {
    // Flash round result
    const myResult = data.teamGame ? sioGameState?.team : sioRole;
    const msg = data.result === 'draw' ? 'Empate na rodada!' :
      data.result === myResult ? 'Sua equipe venceu a rodada!' : 'A outra equipe venceu a rodada!';
    toast(msg, data.result === myResult ? 'win' : data.result === 'draw' ? 'info' : 'lose');
    showOnlineResolvedTrick(data);
  });

  sio.on('hand_winner', (data) => {
    const isMe = data.winner === (data.teamGame ? sioGameState?.team : sioRole);
    toast(isMe ? `${data.teamGame ? 'Sua equipe' : 'Você'} fez ${data.points} ponto(s)!` : `${data.winnerName} fez ${data.points} ponto(s)`, isMe ? 'win' : 'lose');
  });

  sio.on('game_over', (data) => {
    sioGameActive = false;
    sioRoom = null;
    sessionStorage.removeItem('truco_active_room');
    stopOnlineStateSync();
    const isMe = data.winner === sioRole;
    const msg = data.isWalkover
      ? (isMe ? 'Adversário desconectou. Vitória sua!' : 'Você desconectou. Derrota.')
      : (isMe ? `Vitória! ${data.score.p1} x ${data.score.p2}` : `Derrota! ${data.score.p1} x ${data.score.p2}`);
    showOnlineGameOver(isMe, data);
  });

  sio.on('truco_called', (data) => {
    showOnlineTrucoModal(data);
  });

  sio.on('truco_accepted', (data) => {
    closeOnlineModal('m-online-truco');
    toast(`Truco aceito! Vale ${data.level}`, 'info');
  });

  sio.on('truco_refused', (data) => {
    closeOnlineModal('m-online-truco');
    toast(`${data.winnerName} ganhou a mão (adversário correu)`, 'info');
  });

  sio.on('envido_called', (data) => {
    showOnlineEnvidoModal(data);
  });

  sio.on('envido_resolved', (data) => {
    closeOnlineModal('m-online-envido');
    if (data.accepted) {
      toast(`Envido resolvido! ${data.winnerName} ganhou ${data.points} pts`, 'info');
    } else {
      toast(`Envido recusado. +${data.points} pts`, 'info');
    }
  });

  sio.on('flor_called', (data) => {
    showOnlineFlorModal(data);
  });

  sio.on('flor_resolved', (data) => {
    closeOnlineModal('m-online-flor');
    toast(data.accepted ? `Flor resolvida! +${data.points}` : `Flor recusada. +${data.points}`, 'info');
  });

  sio.on('player_folded', (data) => {
    if (data.reason === 'timeout') {
      toast(`⏰ ${data.folderName} estourou o tempo! ${data.winnerName} ganhou a mão`, 'warn');
    } else {
      toast(`${data.folderName} correu! ${data.winnerName} ganhou a mão`, 'info');
    }
  });

  sio.on('turn_timeout', (data) => {
    // Show warning that a player timed out
    const isMe = data.player === sioRole;
    if (isMe) {
      toast('⏰ Seu tempo esgotou! Você perdeu a mão.', 'lose');
    }
  });

  sio.on('opponent_disconnected_temp', (data) => {
    // Opponent disconnected but has a grace period to reconnect
    window._ogOpponentPresence = 'reconnecting';
    if (sioGameState) renderOnlineGame(sioGameState);
    if (sioOpponentGracePeriod) clearInterval(sioOpponentGracePeriod);
    let remaining = Math.round(data.gracePeriodMs / 1000);
    showConnectionBanner('opponent_away', `⏳ ${data.name} desconectou. Aguardando reconexão... ${remaining}s`);
    sioOpponentGracePeriod = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(sioOpponentGracePeriod);
        sioOpponentGracePeriod = null;
      } else {
        showConnectionBanner('opponent_away', `⏳ ${data.name} desconectou. Aguardando reconexão... ${remaining}s`);
      }
    }, 1000);
  });
  sio.on('opponent_reconnected', (data) => {
    window._ogOpponentPresence = 'online';
    if (sioGameState) renderOnlineGame(sioGameState);
    if (sioOpponentGracePeriod) { clearInterval(sioOpponentGracePeriod); sioOpponentGracePeriod = null; }
    showConnectionBanner('connected', `✅ ${data.name} reconectou!`);
    setTimeout(() => showConnectionBanner('hidden'), 3000);
    toast(`${data.name} voltou à partida!`, 'win');
  });
  sio.on('opponent_disconnected', (data) => {
    window._ogOpponentPresence = 'offline';
    if (sioGameState) renderOnlineGame(sioGameState);
    if (sioOpponentGracePeriod) { clearInterval(sioOpponentGracePeriod); sioOpponentGracePeriod = null; }
    showConnectionBanner('hidden');
    toast(`Adversário desconectou! ${data.winnerName} venceu`, 'win');
  });

   // ── Online Stats ──
  sio.on('online_stats', (data) => {
    const totalOnline = Number(data && data.totalOnline) || 0;
    const onlineLabel = totalOnline + ' jogador' + (totalOnline === 1 ? '' : 'es') + ' online';
    const headerCount = document.getElementById('header-online-count');
    if (headerCount) headerCount.textContent = '● ' + onlineLabel;
    // Badge no card da home
    const badge = document.getElementById('online-badge');
    if (badge) {
      badge.textContent = totalOnline + ' online';
      badge.style.display = totalOnline > 0 ? 'block' : 'none';
    }
    // Contador no lobby
    const lobbyCount = document.getElementById('lobby-online-count');
    if (lobbyCount) {
      lobbyCount.textContent = '● ' + totalOnline + ' online';
      lobbyCount.style.opacity = totalOnline > 0 ? '1' : '0';
    }
    // Contador na aba de fila
    const queueOnline = document.getElementById('sio-queue-online');
    if (queueOnline) {
      const parts = [];
      if (data.totalOnline > 0) parts.push(data.totalOnline + ' jogador' + (data.totalOnline !== 1 ? 'es' : '') + ' conectado' + (data.totalOnline !== 1 ? 's' : ''));
      if (data.inQueue > 0) parts.push(data.inQueue + ' na fila');
      queueOnline.textContent = parts.length ? '● ' + parts.join(' · ') : '';
      queueOnline.style.color = data.inQueue > 0 ? 'var(--tg-green,#4caf50)' : 'var(--txt3)';
    }
  });

  sio.on('guest_joined', (data) => {
    sioOpponentName = data.guestName;
    stopRoomCountdown();
    // Atualizar nova tela de espera
    var owNameOpp = document.getElementById('ow-name-opp');
    if (owNameOpp) { owNameOpp.textContent = data.guestName; owNameOpp.style.color = 'rgba(255,255,255,.85)'; }
    var owAvatarOpp = document.getElementById('ow-avatar-opp');
    if (owAvatarOpp) { owAvatarOpp.textContent = '🤠'; owAvatarOpp.style.animation = ''; owAvatarOpp.style.borderColor = 'rgba(255,100,100,.8)'; }
    var owStatusBadge = document.getElementById('ow-status-badge');
    if (owStatusBadge) { owStatusBadge.textContent = 'Jogador entrou!'; owStatusBadge.style.background = 'rgba(200,150,10,.2)'; owStatusBadge.style.color = '#ffd700'; owStatusBadge.style.borderColor = 'rgba(200,150,10,.4)'; }
    var owMainMsg = document.getElementById('ow-main-msg');
    if (owMainMsg) owMainMsg.textContent = 'Aguardando jogador...';
    var owSubMsg = document.getElementById('ow-sub-msg');
    if (owSubMsg) owSubMsg.textContent = 'Iniciando partida em instantes...';
    var owTimerFill = document.getElementById('ow-timer-fill');
    if (owTimerFill) { owTimerFill.style.background = 'linear-gradient(90deg,#ffd700,#ffec60)'; owTimerFill.style.width = '100%'; }
    // Mostrar chat da sala de espera
    var lobbyChat = document.getElementById('sio-lobby-chat');
    if (lobbyChat) lobbyChat.style.display = 'block';
    // Som de alerta: adversário entrou
    try { SFX.win && SFX.win(); } catch(e) {}
    // Notificação sonora + banner de desafio
    playTrucoChallengeSound();
    showChallengeNotification(data.guestName + ' aceitou o desafio!');
  });
  sio.on('room_timeout', () => {
    stopRoomCountdown();
    sioRoom = null;
    sioRole = null;
    // Resetar nova tela de espera
    var owNameOpp = document.getElementById('ow-name-opp');
    if (owNameOpp) { owNameOpp.textContent = 'Aguardando...'; owNameOpp.style.color = 'rgba(255,255,255,.45)'; }
    var owAvatarOpp = document.getElementById('ow-avatar-opp');
    if (owAvatarOpp) { owAvatarOpp.textContent = '❓'; owAvatarOpp.style.animation = 'pulse 1.8s infinite'; owAvatarOpp.style.borderColor = ''; }
    var owStatusBadge = document.getElementById('ow-status-badge');
    if (owStatusBadge) { owStatusBadge.textContent = 'Sala fechada'; owStatusBadge.style.background = 'rgba(255,80,80,.15)'; owStatusBadge.style.color = '#ff9090'; owStatusBadge.style.borderColor = 'rgba(255,80,80,.3)'; }
    var owMainMsg = document.getElementById('ow-main-msg');
    if (owMainMsg) owMainMsg.textContent = 'Nenhum adversário encontrado';
    var owSubMsg = document.getElementById('ow-sub-msg');
    if (owSubMsg) owSubMsg.textContent = 'Volte ao início e tente novamente';
    var owShareArea = document.getElementById('ow-share-area');
    if (owShareArea) owShareArea.style.display = 'none';
    var lc = document.getElementById('sio-lobby-chat');
    var lca = document.getElementById('sio-lobby-chat-area');
    if (lc) lc.style.display = 'none';
    if (lca) lca.innerHTML = '';
    toast('⏰ Nenhum adversário entrou em 15 minutos. A sala foi fechada.', 'warn');
  });
  sio.on('match_found', (data) => {
    sioRoom = data.code;
    sioRole = data.role === 'host' ? 'p1' : 'p2';
    sioOpponentName = data.opponentName;
    sioInQueue = false;
    // Resetar UI da fila
    const queueBtn = document.getElementById('sio-queue-btn');
    if (queueBtn) { queueBtn.textContent = '🔍 Buscar Partida'; queueBtn.style.background = 'var(--tg-green)'; }
    const queueStatus = document.getElementById('sio-queue-status');
    if (queueStatus) queueStatus.style.display = 'none';
    // Notificação sonora + banner de desafio
    playTrucoChallengeSound();
    showChallengeNotification('Partida encontrada! vs ' + data.opponentName);
    toast(`Partida encontrada! vs ${data.opponentName} — aguardando início...`, 'win');
    // Mostrar tela de espera no lobby (não vai direto para o jogo — game_started fará isso)
    // Atualiza painel da sala para mostrar que partida foi encontrada
    const rd = document.getElementById('sio-room-display');
    const jf = document.getElementById('sio-join-form');
    const acGrid = document.querySelector('#ol-tab-challenge .ac-grid');
    if (acGrid) acGrid.style.display = 'none';
    if (jf) jf.style.display = 'none';
    if (rd) {
      rd.style.display = 'block';
      const rcode = document.getElementById('sio-rcode');
      if (rcode) rcode.textContent = data.code;
      const rpRow = document.getElementById('sio-rp-row');
      if (rpRow) rpRow.innerHTML = `<div class="rp rdy">${sioMyName}</div><div class="rp rdy">${data.opponentName}</div>`;
      const rsStatus = document.getElementById('sio-room-status');
      if (rsStatus) rsStatus.innerHTML = `<div class="spinner"></div><span>✅ vs ${data.opponentName} — iniciando partida...</span>`;
    }
    // game_started vai chamar show('online-game') quando o servidor confirmar
  });
  sio.on('queue_update', (data) => {
    const posEl = document.getElementById('sio-queue-pos');
    if (posEl) posEl.textContent = `Posição na fila: ${data.position}`;
  });

  // Servidor pediu para tentar novamente (lock de corrida no matchmaking)
  sio.on('queue_retry', () => {
    if (!sioInQueue) return;
    console.log('[SIO] queue_retry recebido, reentrando na fila...');
    setTimeout(() => {
      if (!sioInQueue) return;
      sio.emit('find_match', { mode: '1v1' }, (res) => {
        if (!res) return;
        if (res.error) {
          toast(res.error, 'warn');
          sioInQueue = false;
          const btn = document.getElementById('sio-queue-btn');
          if (btn) { btn.textContent = '🔍 Buscar Partida'; btn.style.background = 'var(--tg-green)'; }
          const qs = document.getElementById('sio-queue-status');
          if (qs) qs.style.display = 'none';
          return;
        }
        if (res.matched) { sioRoom = res.code; show('online-game'); }
        // se res.queued, continua aguardando match_found normalmente
      });
    }, 150);
  });

  sio.on('chat_msg', (data) => {
    // Se estiver na sala de espera (lobby), mostrar no chat do lobby
    var lobbyChat = document.getElementById('sio-lobby-chat');
    var onlineGameVisible = document.getElementById('online-game') && document.getElementById('online-game').classList.contains('on');
    if (lobbyChat && lobbyChat.style.display !== 'none' && !onlineGameVisible) {
      appendLobbyChat(data.name, data.msg, false);
    } else {
      appendOnlineChat(data.name, data.msg, false);
    }
  });
  sio.on('quick_chat', (data) => {
    const isMine = data.socketId === sio.id;
    if (!isMine) {
      appendOnlineChat(data.name, QUICK_PHRASES[data.phraseId] || '?', false);
      showQuickChatBubble(QUICK_PHRASES[data.phraseId] || '?', false);
    }
  });
  // ── Espectador: estado inicial ──
  sio.on('spectator_state', (data) => {
    // Exibir estado parcial na tela de jogo online como espectador
    const phEl = document.getElementById('og-phase');
    if (phEl) phEl.textContent = '👁️ Assistindo ao vivo';
    const s1El = document.getElementById('og-score-opp');
    const s2El = document.getElementById('og-score-me');
    if (s1El && data.score) s1El.textContent = data.score.p1;
    if (s2El && data.score) s2El.textContent = data.score.p2;
    if (data.names) {
      const n1 = document.getElementById('og-name-opp');
      const n2 = document.getElementById('og-name-me');
      if (n1) n1.textContent = data.names.p1 || 'P1';
      if (n2) n2.textContent = data.names.p2 || 'P2';
    }
    // Ocultar ações e chat rápido para espectador
    const actEl = document.getElementById('og-actions');
    if (actEl) actEl.style.display = 'none';
    const qcEl = document.getElementById('quick-chat-bar');
    if (qcEl) qcEl.style.display = 'none';
    const handEl = document.getElementById('og-my-hand');
    if (handEl) { handEl.innerHTML = '<div style="font-size:.7rem;color:var(--txt3);text-align:center;padding:.5rem">👁️ Modo espectador — você está assistindo</div>'; }
  });
  // Tournament events
  sio.on('tournament_created', (data) => {
    if (document.getElementById('ol-tab-tournaments')?.style.display !== 'none') {
      loadOnlineTournaments();
    }
  });

  sio.on('tournament_updated', () => {
    if (document.getElementById('ol-tab-tournaments')?.style.display !== 'none') {
      loadOnlineTournaments();
    }
  });

  sio.on('tournament_player_joined', (data) => {
    // Update local cache and re-render without full reload
    if (_tournamentsData.length > 0) {
      const t = _tournamentsData.find(x => x.id === data.tournamentId);
      if (t) {
        t.currentPlayers = data.currentPlayers;
        renderTournamentsList(_tournamentsData);
        return;
      }
    }
    loadOnlineTournaments();
  });

  sio.on('tournament_started', (data) => {
    toast('🏆 Campeonato iniciado! Prepare-se para sua partida, tchê!', 'win');
    SFX.win && SFX.win();
    loadOnlineTournaments();
    // If bracket screen is open for this tournament, refresh it
    if (_currentBracketTournamentId === data.tournamentId) {
      loadTournamentBracket(data.tournamentId);
    }
    startTournamentMatchMonitor();
  });

  let tournamentMatchMonitor = null;
  function enterTournamentMatch(data) {
    if (!data?.roomCode) return;
    if (data.status === 'playing') {
      show('online-game');
      sio.emit('reconnect_game', {}, (result) => {
        if (!result?.success) toast(result?.error || 'Confronto iniciado; sincronizando a mesa...', 'info');
      });
      return;
    }
    const enterMatch = data.role === 'host'
      ? (done) => sio.emit('recover_waiting_room', { code: data.roomCode }, done)
      : (done) => sio.emit('join_room', { code: data.roomCode }, done);
    enterMatch((result) => {
      if (result?.error || result?.found === false) {
        toast(result?.error || 'Não foi possível preparar teu confronto do torneio.', 'warn');
        return;
      }
      toast(`🏆 Confronto pronto contra ${data.opponentName || 'adversário'}!`, 'win');
      show('online-game');
      // Quando os jogadores estiverem em instâncias diferentes, o snapshot
      // persistido entrega a mão assim que a partida for iniciada.
      setTimeout(() => { sio.emit('reconnect_game', {}, () => {}); }, 1200);
    });
  }

  function monitorTournamentMatch() {
    if (!sio || !sioConnected || !sioAuthenticated) return;
    sio.emit('get_tournament_match', {}, (result) => {
      if (!result?.found || !result.roomCode) return;
      if (tournamentMatchMonitor) {
        clearInterval(tournamentMatchMonitor);
        tournamentMatchMonitor = null;
      }
      enterTournamentMatch(result);
    });
  }

  function startTournamentMatchMonitor() {
    if (tournamentMatchMonitor) return;
    monitorTournamentMatch();
    tournamentMatchMonitor = setInterval(monitorTournamentMatch, 2500);
  }
  window.startTournamentMatchMonitor = startTournamentMatchMonitor;

  // Cada confronto da chave possui uma mesa privada persistida. O anfitrião
  // recupera a sala e o adversário ocupa a vaga convidada automaticamente.
  sio.on('tournament_match_ready', (data) => {
    if (tournamentMatchMonitor) {
      clearInterval(tournamentMatchMonitor);
      tournamentMatchMonitor = null;
    }
    enterTournamentMatch(data);
  });

  // Real-time bracket updates — server now carries full bracketData in payload
  // so we can render immediately without an extra tRPC round-trip.
  sio.on('tournament_bracket_updated', (data) => {
    if (_currentBracketTournamentId !== data.tournamentId) return;
    if (data.bracketData) {
      // Fast path: server sent full bracket — render directly, no extra fetch
      renderTournamentBracketFromSocket(data.tournamentId, data.bracketData);
    } else {
      // Fallback: older payload without bracketData — fetch from tRPC
      loadTournamentBracket(data.tournamentId);
    }
  });

  sio.on('tournament_match_result', (data) => {
    // Refresh bracket if viewing this tournament
    if (_currentBracketTournamentId === data.tournamentId) {
      loadTournamentBracket(data.tournamentId);
      toast('🏆 Resultado registrado! Chave atualizada.', 'info');
    }
  });

  sio.on('tournament_completed', (data) => {
    toast('🏆 Torneio encerrado! Campeão: ' + (data.championName || 'Desconhecido'), 'win');
    SFX.win && SFX.win();
    loadOnlineTournaments();
    if (_currentBracketTournamentId === data.tournamentId) {
      loadTournamentBracket(data.tournamentId);
    }
    sio.emit('get_tournament_certificate', { tournamentId: data.tournamentId }, (result) => {
      if (result?.certificateUrl) downloadTournamentCertificate(result);
    });
  });

  function downloadTournamentCertificate(data) {
    if (!data?.certificateUrl) return;
    toast('📜 Teu certificado de campeão está pronto!', 'win');
    const link = document.createElement('a');
    link.href = data.certificateUrl;
    link.target = '_blank';
    link.rel = 'noopener';
    link.download = `certificado-${data.tournamentName || 'truco-tche'}.pdf`;
    link.click();
  }

  sio.on('tournament_certificate_ready', (data) => {
    downloadTournamentCertificate(data);
  });

  // Player left tournament (pre-start desistance)
  sio.on('tournament_player_left', (data) => {
    if (_tournamentsData.length > 0) {
      const t = _tournamentsData.find(x => x.id === data.tournamentId);
      if (t) {
        t.currentPlayers = data.currentPlayers;
        renderTournamentsList(_tournamentsData);
        return;
      }
    }
    loadOnlineTournaments();
  });

  // Tournament cancelled (timeout or manual)
  sio.on('tournament_cancelled', (data) => {
    toast('⚠️ Torneio cancelado: ' + (data.reason || 'Torneio encerrado'), 'warn');
    // Remove from local cache
    _tournamentsData = _tournamentsData.filter(t => t.id !== data.tournamentId);
    renderTournamentsList(_tournamentsData);
    // If viewing this tournament's bracket, go back to lobby
    if (_currentBracketTournamentId === data.tournamentId) {
      _currentBracketTournamentId = null;
      show('online-lobby');
    }
  });

  return sio;
}

// ── Login Required Modal ──
function showLoginRequiredModal() {
  // Marcar ação pendente para redirecionar ao lobby online após login
  window._pendingGameChar = 'online';
  var authModal = document.getElementById('m-auth');
  if (authModal) {
    authModal.classList.remove('hidden');
    if (SFX && SFX.click) SFX.click();
    if (typeof laShowScreen === 'function') laShowScreen('la-login');
    var infoEl = document.getElementById('la-login-info');
    if (infoEl) {
      infoEl.textContent = '\uD83C\uDF10 Fa\u00e7a login ou crie um cadastro para jogar online!';
      infoEl.classList.remove('hidden');
    }
  } else {
    // Fallback: toast
    toast('\uD83C\uDF10 Fa\u00e7a login para jogar online!', 'warn');
  }
}

// ── Lobby Functions ──
function openOnlineLobby() {
    const user = window.localUser || (typeof AUTH !== 'undefined' ? AUTH.user : null);
    if (!user) {
    // Mostrar modal de login claro em vez de toast
    showLoginRequiredModal();
    return;
  }
  ensureSocket();
  initializeRoomFilterControls();
  show('online-lobby');
  setOnlineLobbyMode('browse');
  // Atualizar nome do jogador na tela de espera
  var owNameMe = document.getElementById('ow-name-me');
  if (owNameMe) owNameMe.textContent = sioMyName || (window.localUser && window.localUser.name) || 'Você';
  // Resetar estado da tela de espera
  var owNameOpp = document.getElementById('ow-name-opp');
  if (owNameOpp) { owNameOpp.textContent = 'Aguardando...'; owNameOpp.style.color = 'rgba(255,255,255,.45)'; }
  var owAvatarOpp = document.getElementById('ow-avatar-opp');
  if (owAvatarOpp) { owAvatarOpp.textContent = '❓'; owAvatarOpp.style.animation = 'pulse 1.8s infinite'; owAvatarOpp.style.borderColor = ''; }
  var owStatusBadge = document.getElementById('ow-status-badge');
  if (owStatusBadge) { owStatusBadge.textContent = 'Procurando...'; owStatusBadge.style.background = 'rgba(110,240,110,.15)'; owStatusBadge.style.color = '#8ef08e'; owStatusBadge.style.borderColor = 'rgba(110,240,110,.3)'; }
  var owMainMsg = document.getElementById('ow-main-msg');
  if (owMainMsg) owMainMsg.textContent = 'Aguardando adversário...';
  var owSubMsg = document.getElementById('ow-sub-msg');
  if (owSubMsg) owSubMsg.textContent = 'A sala ficará aberta por até 15 minutos';
  var owShareArea = document.getElementById('ow-share-area');
  if (owShareArea) owShareArea.style.display = 'none';
  var owTimerFill = document.getElementById('ow-timer-fill');
  if (owTimerFill) { owTimerFill.style.width = '100%'; }
  refreshActiveRooms();
}

function leaveOnlineLobby() {
  stopActiveRoomsRefresh();
  if (sioInQueue && sio) {
    sio.emit('cancel_matchmaking');
    sioInQueue = false;
  }
  // Cancelar sala de espera se ainda não iniciou
  if (sioRoom && sioRole === 'p1' && sio && !sioGameActive) {
    sio.emit('cancel_room');
    sioRoom = null;
    sioRole = null;
    // Resetar UI
    var rd = document.getElementById('sio-room-display');
    if (rd) rd.style.display = 'none';
    stopRoomCountdown();
  }
  show('home');
}

function switchOnlineTab(tab, el) {
  document.querySelectorAll('.ol-tab-content').forEach(c => c.style.display = 'none');
  document.querySelectorAll('.ol-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('ol-tab-' + tab).style.display = 'block';
  el.classList.add('active');
  if (tab === 'tournaments') loadOnlineTournaments();
  if (tab === 'live') loadLiveRooms();
}

function toggleJoinForm() {
  const f = document.getElementById('sio-join-form');
  f.style.display = f.style.display === 'none' ? 'block' : 'none';
}

function copyRoomCode() {
  try {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(sioRoom)
        .then(() => toast('Código copiado! 📋', 'info'))
        .catch(() => prompt('Copie o código da sala:', sioRoom));
    } else {
      prompt('Copie o código da sala:', sioRoom);
    }
  } catch(e) { prompt('Copie:', sioRoom); }
  SFX.click && SFX.click();
}
function shareRoomGeneric() {
  var code = sioRoom || document.getElementById('sio-rcode').textContent;
  var url = window.location.origin;
  var text = '🃏 Me desafia no Truco Tchê! Código da sala: ' + code + ' — ' + url;
  if (navigator.share) {
    navigator.share({ title: 'Truco Tchê', text: text, url: url })
      .catch(() => {});
  } else {
    // Fallback: copiar para área de transferência
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => toast('Link copiado! 🔗', 'info'));
    } else {
      prompt('Copie e compartilhe:', text);
    }
  }
  SFX.click && SFX.click();
}
function sendLobbyChat() {
  var inp = document.getElementById('sio-lobby-chat-input');
  if (!inp || !inp.value.trim() || !sio) return;
  var msg = inp.value.trim();
  sio.emit('chat_msg', { msg });
  appendLobbyChat(sioMyName, msg, true);
  inp.value = '';
}
function appendLobbyChat(name, msg, isMine) {
  var area = document.getElementById('sio-lobby-chat-area');
  if (!area) return;
  var div = document.createElement('div');
  div.style.cssText = 'margin-bottom:.25rem;' + (isMine ? 'text-align:right;color:var(--tg-gold,#c8a84b)' : 'color:var(--txt2)');
  div.textContent = isMine ? msg : name + ': ' + msg;
  area.appendChild(div);
  area.scrollTop = area.scrollHeight;
}
function shareRoomWhatsApp() {
  var code = sioRoom || document.getElementById('sio-rcode').textContent;
  var url = window.location.origin;
  var msg = '🃏 Me desafia no Truco Tchê!\n\n'
    + 'Código da sala: *' + code + '*\n'
    + 'Entre pelo link: ' + url + '\n\n'
    + 'Clique em Jogar Online > Entrar na Sala e use o código acima. Bora trucar! 🤠';
  var waUrl = 'https://wa.me/?text=' + encodeURIComponent(msg);
  window.open(waUrl, '_blank');
  SFX.click && SFX.click();
}
// ── Room Waiting Countdown ───
var _roomCountdownTimer = null;
function stopRoomCountdown() {
  if (_roomCountdownTimer) { clearTimeout(_roomCountdownTimer); _roomCountdownTimer = null; }
  if (window._owTimerInterval) { clearInterval(window._owTimerInterval); window._owTimerInterval = null; }
}
function startRoomCountdown(durationMs) {
  // Parar qualquer countdown anterior
  if (_roomCountdownTimer) { clearTimeout(_roomCountdownTimer); _roomCountdownTimer = null; }
  if (window._owTimerInterval) { clearInterval(window._owTimerInterval); window._owTimerInterval = null; }
  // Inicializar barra de progresso da nova tela
  var owTimerFill = document.getElementById('ow-timer-fill');
  if (owTimerFill) { owTimerFill.style.transition = 'none'; owTimerFill.style.width = '100%'; }
  // Intervalo para atualizar a barra visual
  var _owTimerStart = Date.now();
  var _owTimerInterval = setInterval(function() {
    var elapsed = Date.now() - _owTimerStart;
    var pct = Math.max(0, 100 - (elapsed / durationMs) * 100);
    var fill = document.getElementById('ow-timer-fill');
    if (fill) { fill.style.transition = 'width 1s linear'; fill.style.width = pct + '%'; }
    if (pct <= 0) { clearInterval(_owTimerInterval); window._owTimerInterval = null; }
  }, 1000);
  window._owTimerInterval = _owTimerInterval;
  // Countdown textual
  var endAt = Date.now() + durationMs;
  var el = document.getElementById('sio-room-countdown');
  function tick() {
    var left = Math.max(0, endAt - Date.now());
    var mins = Math.floor(left / 60000);
    var secs = Math.floor((left % 60000) / 1000);
    if (el) el.textContent = 'A sala fecha em ' + mins + ':' + (secs < 10 ? '0' : '') + secs;
    if (left > 0) _roomCountdownTimer = setTimeout(tick, 1000);
    else if (el) el.textContent = 'Tempo esgotado.';
  }
  tick();
}

// ── Room Management ──
var _activeRoomsRefreshTimer = null;

function stopActiveRoomsRefresh() {
  if (_activeRoomsRefreshTimer) { clearInterval(_activeRoomsRefreshTimer); _activeRoomsRefreshTimer = null; }
}

function setOnlineLobbyMode(mode) {
  var panel = document.getElementById('active-rooms-panel');
  var waiting = document.getElementById('online-waiting-area');
  var browsing = mode === 'browse';
  if (panel) panel.style.display = browsing ? 'block' : 'none';
  if (waiting) waiting.style.display = browsing ? 'none' : 'flex';
  // Sem um adapter global de Socket.IO, este polling curto alcança salas criadas
  // por outra instância Autoscale usando a consulta persistida `list_rooms`.
  if (browsing && !_activeRoomsRefreshTimer) _activeRoomsRefreshTimer = setInterval(refreshActiveRooms, 5000);
  if (!browsing) stopActiveRoomsRefresh();
}

function escapeRoomText(value) {
  return String(value == null ? '' : value).replace(/[&<>'"]/g, function(char) {
    return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char];
  });
}

var activeRoomFilters = { mode: 'all', stakeTier: 'all', region: 'all' };
var ROOM_REGION_OPTIONS = Array.from({ length: 30 }, function(_, index) { return String(index + 1); }).concat(['40']);

function roomModeLabel(value) {
  return ({ '1v1': '1 contra 1', desafio: 'Desafio', torneio: 'Torneio' })[value] || '1 contra 1';
}

function roomStakeLabel(value) {
  return ({ amistoso: 'Amistoso', baixo: 'Baixa', medio: 'Média', alto: 'Alta' })[value] || 'Amistoso';
}

function roomRegionLabel(value) {
  return value === 'BR' ? 'Nacional' : 'Região ' + (value || '40');
}

function ensureRoomFilterState() {
  if (!activeRoomFilters || typeof activeRoomFilters !== 'object') activeRoomFilters = { mode: 'all', stakeTier: 'all', region: 'all' };
  if (!Array.isArray(ROOM_REGION_OPTIONS)) ROOM_REGION_OPTIONS = Array.from({ length: 30 }, function(_, index) { return String(index + 1); }).concat(['40']);
}

function initializeRoomFilterControls() {
  ensureRoomFilterState();
  document.querySelectorAll('select[data-room-filter="region"]').forEach(function(select) {
    if (select.options.length > 1) return;
    ROOM_REGION_OPTIONS.forEach(function(region) {
      var option = document.createElement('option');
      option.value = region;
      option.textContent = 'Região ' + region;
      select.appendChild(option);
    });
  });
  var createRegion = document.getElementById('room-create-region');
  if (createRegion && !createRegion.options.length) {
    ROOM_REGION_OPTIONS.forEach(function(region) {
      var option = document.createElement('option');
      option.value = region;
      option.textContent = 'Região ' + region;
      createRegion.appendChild(option);
    });
    createRegion.value = '40';
  }
  document.querySelectorAll('[data-room-filter]').forEach(function(control) {
    var filterName = control.getAttribute('data-room-filter');
    if (filterName && Object.prototype.hasOwnProperty.call(activeRoomFilters, filterName)) control.value = activeRoomFilters[filterName] || 'all';
  });
}

function setRoomFilter(key, value) {
  ensureRoomFilterState();
  if (!Object.prototype.hasOwnProperty.call(activeRoomFilters, key)) return;
  activeRoomFilters[key] = value || 'all';
  initializeRoomFilterControls();
  refreshActiveRooms();
  refreshHomeActiveRooms();
}

function getActiveRoomFilters() {
  ensureRoomFilterState();
  return { mode: activeRoomFilters.mode, stakeTier: activeRoomFilters.stakeTier, region: activeRoomFilters.region };
}

function filterRoomsLocally(rooms) {
  ensureRoomFilterState();
  return (Array.isArray(rooms) ? rooms : []).filter(function(room) {
    return (activeRoomFilters.mode === 'all' || room.mode === activeRoomFilters.mode)
      && (activeRoomFilters.stakeTier === 'all' || room.stakeTier === activeRoomFilters.stakeTier)
      && (activeRoomFilters.region === 'all' || room.region === activeRoomFilters.region);
  });
}

function renderActiveRooms(rooms) {
  var list = document.getElementById('active-rooms-list');
  var count = document.getElementById('active-rooms-count');
  if (!list || !count) return;
  var validRooms = filterRoomsLocally(rooms);
  count.textContent = validRooms.length ? validRooms.length + (validRooms.length === 1 ? ' sala aguardando jogador' : ' salas aguardando jogadores') : 'Nenhuma sala aberta agora';
  if (!validRooms.length) {
    list.innerHTML = '<div style="padding:1rem .55rem;text-align:center;color:rgba(255,255,255,.48);font-size:.72rem">Ainda não há desafio aberto. Crie uma sala e convide alguém para jogar.</div>';
    return;
  }
  list.innerHTML = validRooms.map(function(room) {
    var host = escapeRoomText(room.hostName || 'Jogador');
    var code = String(room.code || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
    var viewers = Number(room.spectators || 0);
    return '<div style="display:flex;align-items:center;gap:.65rem;padding:.58rem;border-radius:9px;background:rgba(255,255,255,.045);margin-bottom:.4rem;border:1px solid rgba(255,255,255,.06)">' +
      '<div style="width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:rgba(200,168,75,.18);border:1px solid rgba(200,168,75,.28);font-size:.9rem">🤠</div>' +
      '<div style="min-width:0;flex:1"><div style="color:rgba(255,255,255,.9);font-size:.72rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + host + '</div>' +
      '<div style="color:rgba(255,255,255,.42);font-size:.58rem;margin-top:.1rem">' + escapeRoomText(roomModeLabel(room.mode)) + ' · ' + escapeRoomText(roomStakeLabel(room.stakeTier)) + ' · ' + escapeRoomText(roomRegionLabel(room.region)) + ' · código ' + escapeRoomText(code) + (viewers ? ' · ' + viewers + ' assistindo' : '') + '</div></div>' +
      '<button type="button" onclick="joinActiveRoom(\'' + code + '\')" style="background:#3675ba;border:1px solid rgba(157,208,255,.35);color:#fff;border-radius:7px;padding:.34rem .55rem;font-size:.64rem;font-weight:800;cursor:pointer">Entrar</button></div>';
  }).join('');
}

function refreshActiveRooms() {
  initializeRoomFilterControls();
  if (!sio || !sioConnected || !sioAuthenticated) {
    waitForAuth(function() { refreshActiveRooms(); });
    return;
  }
  sio.emit('list_rooms', getActiveRoomFilters(), function(response) {
    var rooms = response && response.rooms ? response.rooms : [];
    renderActiveRooms(rooms);
    renderHomeActiveRooms(rooms);
  });
}

function renderHomeActiveRooms(rooms) {
  var list = document.getElementById('home-active-rooms-list');
  var count = document.getElementById('home-active-rooms-count');
  if (!list || !count) return;
  var user = window.localUser || (typeof AUTH !== 'undefined' ? AUTH.user : null);
  var validRooms = filterRoomsLocally(rooms);
  if (!user) {
    count.textContent = validRooms.length ? validRooms.length + ' desafios disponíveis' : 'Faça login para encontrar adversários';
    list.innerHTML = '<div style="font-size:.64rem;color:rgba(255,255,255,.5);padding:.22rem 0">Entre na sua conta para ver e aceitar desafios em tempo real.</div>';
    return;
  }
  count.textContent = validRooms.length ? validRooms.length + (validRooms.length === 1 ? ' desafio aguardando' : ' desafios aguardando') : 'Nenhum desafio aberto neste momento';
  if (!validRooms.length) {
    list.innerHTML = '<div style="font-size:.64rem;color:rgba(255,255,255,.5);padding:.22rem 0">Seja o primeiro a abrir uma mesa e chame a gauchada.</div>';
    return;
  }
  list.innerHTML = validRooms.slice(0, 2).map(function(room, index) {
    var host = escapeRoomText(room.hostName || 'Jogador');
    var code = String(room.code || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
    return '<div style="display:flex;align-items:center;gap:.45rem;padding:.38rem .1rem' + (index ? ';border-top:1px solid rgba(255,255,255,.08)' : '') + '">' +
      '<span style="font-size:.76rem">🤠</span><span style="flex:1;min-width:0;color:rgba(255,255,255,.84);font-size:.65rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + host + ' <span style="font-weight:400;color:rgba(255,255,255,.42)">· ' + escapeRoomText(roomModeLabel(room.mode)) + ' · ' + escapeRoomText(roomStakeLabel(room.stakeTier)) + ' · ' + escapeRoomText(roomRegionLabel(room.region)) + '</span></span>' +
      '<button type="button" onclick="joinHomeActiveRoom(\'' + code + '\')" style="background:#3675ba;border:1px solid rgba(157,208,255,.35);color:#fff;border-radius:6px;padding:.25rem .4rem;font-size:.58rem;font-weight:800;cursor:pointer">Entrar</button></div>';
  }).join('');
}

function refreshHomeActiveRooms() {
  initializeRoomFilterControls();
  var user = window.localUser || (typeof AUTH !== 'undefined' ? AUTH.user : null);
  if (!user) { renderHomeActiveRooms([]); return; }
  ensureSocket();
  if (!sio || !sioConnected || !sioAuthenticated) {
    waitForAuth(function() { refreshHomeActiveRooms(); });
    return;
  }
  sio.emit('list_rooms', getActiveRoomFilters(), function(response) {
    renderHomeActiveRooms(response && response.rooms ? response.rooms : []);
  });
}

function joinHomeActiveRoom(code) {
  var user = window.localUser || (typeof AUTH !== 'undefined' ? AUTH.user : null);
  if (!user) { showLoginRequiredModal(); return; }
  ensureSocket();
  show('online-lobby');
  setOnlineLobbyMode('browse');
  joinActiveRoom(code);
}

function finishRoomJoin(code, res) {
  sioRoom = code;
  sessionStorage.setItem('truco_active_room', code);
  sioRole = 'p2';
  scheduleOnlineStateSync();
  sioOpponentName = res.hostName;
  setOnlineLobbyMode('waiting');
  toast('Entrando na sala de ' + res.hostName + '...', 'info');
  var lobbyChat = document.getElementById('sio-lobby-chat');
  if (lobbyChat) lobbyChat.style.display = 'block';
  document.getElementById('sio-room-display').style.display = 'block';
  document.getElementById('sio-rcode').textContent = code;
  document.getElementById('sio-room-status').innerHTML = '<span style="color:var(--green);font-weight:700">✅ Sala encontrada! Aguardando início...</span>';
  var rpRow = document.getElementById('sio-rp-row');
  if (rpRow) rpRow.innerHTML = '<div class="rp rdy">' + escapeRoomText(res.hostName) + '</div><div class="rp rdy">' + escapeRoomText(sioMyName) + '</div>';
  var jf = document.getElementById('sio-join-form');
  if (jf) jf.style.display = 'none';
}

function joinActiveRoom(code) {
  if (!sio || !sioConnected || !sioAuthenticated) {
    toast('Conectando...', 'info');
    waitForAuth(function() { joinActiveRoom(code); });
    return;
  }
  var normalizedCode = String(code).toUpperCase();
  sio.emit('join_room', { code: normalizedCode }, function(res) {
    if (res.error) { toast(res.error, 'warn'); refreshActiveRooms(); return; }
    finishRoomJoin(normalizedCode, res);
  });
}

function socketCreateRoom(privateInviteeId, privateInviteeName) {
  initializeRoomFilterControls();
  if (!sio || !sioConnected || !sioAuthenticated) {
    toast('Conectando...', 'info');
    waitForAuth(function() { socketCreateRoom(privateInviteeId, privateInviteeName); });
    return;
  }
  var createMode = document.getElementById('room-create-mode');
  var createStake = document.getElementById('room-create-stake');
  var createRegion = document.getElementById('room-create-region');
  sio.emit('create_room', {
    mode: createMode ? createMode.value : '1v1',
    stakeTier: createStake ? createStake.value : 'amistoso',
    region: createRegion ? createRegion.value : '40',
    privateInviteeId: privateInviteeId || undefined,
  }, (res) => {
    if (res.error) { toast(res.error, 'warn'); return; }
    setOnlineLobbyMode('waiting');
    sioRoom = res.code;
    sessionStorage.setItem('truco_active_room', res.code);
    sioRole = 'p1';
    scheduleOnlineStateSync();
    // Atualizar nova tela de espera
    var rcodeEl = document.getElementById('sio-rcode');
    if (rcodeEl) rcodeEl.textContent = res.code;
    var shareArea = document.getElementById('ow-share-area');
    if (shareArea) shareArea.style.display = 'block';
    var owNameMe = document.getElementById('ow-name-me');
    if (owNameMe) owNameMe.textContent = sioMyName || 'Você';
    var owMainMsg = document.getElementById('ow-main-msg');
    if (owMainMsg) owMainMsg.textContent = 'Aguardando adversário...';
    var owSubMsg = document.getElementById('ow-sub-msg');
    if (owSubMsg) owSubMsg.textContent = 'A sala ficará aberta por até 15 minutos';
    startRoomCountdown(15 * 60 * 1000);
    if (res.isPrivate) toast('Sala privada criada. Convite enviado para ' + (privateInviteeName || 'seu amigo') + '!', 'win');
  });
}

let _inPersonTableInvite = null;
let _inPersonQrScanner = null;
let _inPersonScannerBusy = false;

function getInPersonInvitePayload(code, inviteToken) {
  return JSON.stringify({ type: 'truco-tche-in-person', version: 1, roomCode: code, inviteToken });
}

function parseInPersonInvitePayload(raw) {
  try {
    const parsed = JSON.parse(String(raw || '').trim());
    if (parsed?.type !== 'truco-tche-in-person' || parsed?.version !== 1) return null;
    if (!/^[A-Z2-9]{4}$/i.test(parsed.roomCode || '') || typeof parsed.inviteToken !== 'string' || parsed.inviteToken.length < 20) return null;
    return { roomCode: parsed.roomCode.toUpperCase(), inviteToken: parsed.inviteToken };
  } catch { return null; }
}

function openInPersonTableScreen() {
  show('in-person-scr');
  refreshNotificationBadge();
}

function closeInPersonTableScreen() {
  stopInPersonScanner();
  show('home');
}

function inPersonModeLabel(mode) {
  return mode === '2v2' ? 'Duplas · 2×2' : mode === '3v3' ? 'Trios · 3×3' : 'Mano a mano · 1×1';
}

function renderInPersonParticipants(invite) {
  const container = document.getElementById('in-person-participants');
  if (!container) return;
  const maxPlayers = Number(invite?.maxPlayers || 2);
  const joined = Array.isArray(invite?.participants) ? invite.participants : [];
  const seats = Array.from({ length: maxPlayers }, (_, index) => {
    const seat = index + 1;
    const player = joined.find(item => Number(item.seat) === seat);
    const team = seat % 2 === 1 ? 'A' : 'B';
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:.35rem .45rem;border-radius:7px;margin-top:.22rem;background:${player ? (team === 'A' ? 'rgba(72,142,224,.18)' : 'rgba(229,150,70,.18)') : 'rgba(255,255,255,.055)'};font-size:.63rem"><span style="color:${team === 'A' ? '#a9d6ff' : '#ffd39b'};font-weight:800">Equipe ${team} · vaga ${seat}</span><span style="color:${player ? '#fff' : 'rgba(255,255,255,.4)'}">${player ? escapeNotificationText(player.userName) : 'Aguardando QR'}</span></div>`;
  });
  container.innerHTML = `<div style="font-size:.61rem;color:rgba(255,255,255,.55);margin-bottom:.28rem">${joined.length}/${maxPlayers} jogadores · ${inPersonModeLabel(invite?.mode || '1v1')}</div>${seats.join('')}`;
}

function renderInPersonHostInvite(invite) {
  const card = document.getElementById('in-person-host-card');
  const createCard = document.getElementById('in-person-create-card');
  const qr = document.getElementById('in-person-qr');
  const code = document.getElementById('in-person-code');
  const expiry = document.getElementById('in-person-expiry');
  const title = document.getElementById('in-person-host-title');
  const copy = document.getElementById('in-person-host-copy');
  if (card) card.style.display = 'block';
  if (createCard) createCard.style.display = 'none';
  if (code) code.textContent = `MESA ${invite.code}`;
  if (expiry) expiry.textContent = `Válido até ${new Date(invite.expiresAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  if (title) title.textContent = `Convide para ${inPersonModeLabel(invite.mode || '1v1')}`;
  if (copy) copy.textContent = `O QR Code é temporário e libera ${invite.maxPlayers - 1} vaga${invite.maxPlayers - 1 === 1 ? '' : 's'} nesta mesa.`;
  renderInPersonParticipants(invite);
  if (!qr) return;
  qr.innerHTML = '';
  if (typeof QRCode === 'undefined') {
    qr.innerHTML = '<div style="width:220px;height:220px;display:grid;place-items:center;color:#283">Preparando QR Code...</div>';
    window.__trucoEnsureQrLibraries?.().then(() => renderInPersonHostInvite(invite)).catch(() => { qr.innerHTML = '<div style="width:220px;height:220px;display:grid;place-items:center;color:#283">QR indisponível. Use Copiar convite.</div>'; });
    return;
  }
  new QRCode(qr, { text: getInPersonInvitePayload(invite.code, invite.inviteToken), width: 220, height: 220, colorDark: '#18372b', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
}

function createInPersonTableClient() {
  if (!sio || !sioConnected || !sioAuthenticated) {
    toast('Conectando à cancha...', 'info');
    waitForAuth(createInPersonTableClient);
    return;
  }
  const modeControl = document.getElementById('in-person-mode');
  const mode = ['1v1', '2v2', '3v3'].includes(modeControl?.value) ? modeControl.value : '1v1';
  sio.emit('create_in_person_table', { mode }, (res) => {
    if (res?.error) { toast(res.error, 'warn'); return; }
    _inPersonTableInvite = { ...res, participants: [{ seat: 1, team: 'A', userName: sioMyName || 'Você' }] };
    renderInPersonHostInvite(_inPersonTableInvite);
    refreshNotificationBadge();
    toast(`${inPersonModeLabel(mode)} criada. Mostre o QR Code!`, 'win');
  });
}

async function copyInPersonInvite() {
  if (!_inPersonTableInvite) return;
  try {
    await navigator.clipboard.writeText(getInPersonInvitePayload(_inPersonTableInvite.code, _inPersonTableInvite.inviteToken));
    toast('Convite copiado. Envie apenas para quem vai jogar contigo.', 'info');
  } catch { toast('Não foi possível copiar o convite neste navegador.', 'warn'); }
}

function setInPersonScannerStatus(message) {
  const status = document.getElementById('in-person-scanner-status');
  if (status) status.textContent = message;
}

async function startInPersonScanner() {
  const reader = document.getElementById('in-person-qr-reader');
  if (!reader) return;
  if (typeof Html5Qrcode === 'undefined') {
    setInPersonScannerStatus('Preparando leitor...');
    try { await window.__trucoEnsureQrLibraries?.(); } catch {}
    if (typeof Html5Qrcode === 'undefined') { setInPersonScannerStatus('Leitor não disponível. Cole o convite copiado pelo anfitrião.'); return; }
  }
  if (_inPersonQrScanner) return;
  reader.style.display = 'block';
  setInPersonScannerStatus('Solicitando acesso à câmera...');
  try {
    _inPersonQrScanner = new Html5Qrcode('in-person-qr-reader');
    await _inPersonQrScanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 220, height: 220 } }, async (decodedText) => {
      if (_inPersonScannerBusy) return;
      _inPersonScannerBusy = true;
      await stopInPersonScanner();
      joinInPersonInvite(decodedText);
    }, () => {});
    setInPersonScannerStatus('Aponte a câmera para o QR Code da mesa.');
  } catch {
    _inPersonQrScanner = null;
    reader.style.display = 'none';
    setInPersonScannerStatus('Não foi possível abrir a câmera. Verifique a permissão ou cole o convite.');
  }
}

async function stopInPersonScanner() {
  const scanner = _inPersonQrScanner;
  _inPersonQrScanner = null;
  _inPersonScannerBusy = false;
  if (scanner) { try { await scanner.stop(); await scanner.clear(); } catch {} }
  const reader = document.getElementById('in-person-qr-reader');
  if (reader) reader.style.display = 'none';
}

function joinInPersonFromInput() {
  const input = document.getElementById('in-person-invite-input');
  joinInPersonInvite(input?.value || '');
}

function joinInPersonInvite(rawInvite) {
  const invite = parseInPersonInvitePayload(rawInvite);
  if (!invite) { setInPersonScannerStatus('QR Code ou convite inválido. Peça ao anfitrião para gerar uma nova mesa.'); return; }
  if (!sio || !sioConnected || !sioAuthenticated) {
    toast('Conectando à cancha...', 'info');
    waitForAuth(() => joinInPersonInvite(rawInvite));
    return;
  }
  setInPersonScannerStatus('Validando convite e preparando a mesa...');
  sio.emit('join_room', { code: invite.roomCode, inPersonToken: invite.inviteToken }, (res) => {
    if (res?.error) { setInPersonScannerStatus(res.error); toast(res.error, 'warn'); return; }
    if (res?.mode === '2v2' || res?.mode === '3v3') {
      setInPersonScannerStatus(res.waiting ? `Você entrou na Equipe ${res.team}. Aguardando ${res.maxPlayers - (res.participants?.length || 0)} jogador(es).` : 'Mesa completa. Preparando a partida...');
      if (Array.isArray(res.participants)) renderInPersonParticipants({ ...res, participants: res.participants });
      toast(res.waiting ? `Você entrou na Equipe ${res.team}.` : 'Mesa completa. Iniciando a partida!', 'win');
      return;
    }
    finishRoomJoin(invite.roomCode, res);
    show('online-lobby');
    toast('Mesa Presencial encontrada. Iniciando a partida...', 'win');
  });
}

function socketJoinRoom() {
  if (!sio || !sioConnected || !sioAuthenticated) {
    toast('Conectando...', 'info');
    waitForAuth(function() { socketJoinRoom(); });
    return;
  }
  const code = document.getElementById('sio-join-code').value.trim().toUpperCase();
  if (code.length !== 4) { toast('Código deve ter 4 caracteres', 'warn'); return; }
  joinActiveRoom(code);
}

// ── Matchmaking ──
function toggleMatchmaking() {
  if (!sio || !sioConnected || !sioAuthenticated) { toast('Conectando...', 'info'); waitForAuth(function() { toggleMatchmaking(); }); return; }
  if (sioInQueue) {
    sio.emit('cancel_matchmaking');
    sioInQueue = false;
    document.getElementById('sio-queue-btn').textContent = '🔍 Buscar Partida';
    document.getElementById('sio-queue-btn').style.background = 'var(--tg-green)';
    document.getElementById('sio-queue-status').style.display = 'none';
  } else {
    sio.emit('find_match', { mode: '1v1' }, (res) => {
      if (res.error) { toast(res.error, 'warn'); return; }
      if (res.matched) {
        sioRoom = res.code;
        show('online-game');
      } else {
        sioInQueue = true;
        document.getElementById('sio-queue-btn').textContent = '✕ Cancelar busca';
        document.getElementById('sio-queue-btn').style.background = 'var(--tg-red)';
        document.getElementById('sio-queue-status').style.display = 'block';
      }
    });
  }
}

// ── Online Tournaments ──
let _tournamentSizeSelected = 4;
let _tournamentsData = [];
let _tournamentFilter = 'all';

function socketCreateTournament() {
  if (!sio || !sioConnected || !sioAuthenticated) {
    toast('Conectando...', 'info');
    waitForAuth(function() { socketCreateTournament(); });
    return;
  }
  // Reset modal
  const nameEl = document.getElementById('ct-name');
  const prizeEl = document.getElementById('ct-prize');
  if (nameEl) nameEl.value = '';
  if (prizeEl) prizeEl.value = '';
  _tournamentSizeSelected = 4;
  // Reset size buttons
  document.querySelectorAll('.ct-size-btn').forEach(b => {
    const s = parseInt(b.getAttribute('data-size'));
    b.style.background = s === 4 ? 'var(--tg-gold,#c8a84b)' : 'transparent';
    b.style.color = s === 4 ? '#000' : 'var(--txt2)';
    b.style.borderColor = s === 4 ? 'var(--tg-gold,#c8a84b)' : 'var(--bdr)';
  });
  const modal = document.getElementById('m-create-tournament');
  if (modal) modal.classList.remove('hidden');
}

function selectTournamentSize(size, btn) {
  _tournamentSizeSelected = size;
  document.querySelectorAll('.ct-size-btn').forEach(b => {
    const active = b === btn;
    b.style.background = active ? 'var(--tg-gold,#c8a84b)' : 'transparent';
    b.style.color = active ? '#000' : 'var(--txt2)';
    b.style.borderColor = active ? 'var(--tg-gold,#c8a84b)' : 'var(--bdr)';
  });
}

function confirmCreateTournament() {
  const name = (document.getElementById('ct-name')?.value || '').trim();
  if (!name) { toast('Informe o nome do campeonato, tchê!', 'warn'); return; }
  const prize = (document.getElementById('ct-prize')?.value || '').trim() || null;
  const maxPlayers = _tournamentSizeSelected || 4;
  closeModal('m-create-tournament');
  sio.emit('create_tournament', { name, maxPlayers, prize }, (res) => {
    if (res.error) { toast(res.error, 'warn'); return; }
    toast(`Campeonato "${name}" criado! Aguardando jogadores... 🏆`, 'win');
    loadOnlineTournaments();
  });
}

function createOnlineOneVsOneTournament() {
  if (!sio || !sioConnected || !sioAuthenticated) {
    toast('Conectando à cancha...', 'info');
    waitForAuth(createOnlineOneVsOneTournament);
    return;
  }
  const name = (document.getElementById('ot-name')?.value || '').trim();
  const prize = (document.getElementById('ot-prize')?.value || '').trim() || null;
  const scheduledStartAtInput = document.getElementById('ot-start-at')?.value || '';
  const scheduledStartAt = scheduledStartAtInput ? new Date(scheduledStartAtInput).toISOString() : null;
  const maxPlayers = Number(document.getElementById('ot-capacity')?.value || 0);
  if (!name) { toast('Informe o nome do campeonato, tchê!', 'warn'); return; }
  if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 64 || maxPlayers % 2 !== 0) {
    toast('No mano a mano, informe um número par de 2 a 64 vagas.', 'warn');
    return;
  }
  sio.emit('create_tournament', { name, maxPlayers, prize, scheduledStartAt }, (res) => {
    if (res.error) { toast(res.error, 'warn'); return; }
    toast(`🏆 ${name} criado! Você é o primeiro inscrito.`, 'win');
    const nameInput = document.getElementById('ot-name');
    const prizeInput = document.getElementById('ot-prize');
    const startAtInput = document.getElementById('ot-start-at');
    if (nameInput) nameInput.value = '';
    if (prizeInput) prizeInput.value = '';
    if (startAtInput) startAtInput.value = '';
    loadOnlineTournaments();
    window.startTournamentMatchMonitor?.();
  });
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from(rawData, char => char.charCodeAt(0));
}

function setTournamentReminderControl(state, detail) {
  const button = document.getElementById('ot-push-reminder-button');
  const detailEl = document.getElementById('ot-push-reminder-detail');
  if (!button || !detailEl) return;
  detailEl.textContent = detail;
  if (state === 'enabled') {
    button.textContent = 'Desativar';
    button.style.borderColor = 'rgba(255,156,145,.55)';
    button.style.color = '#ff9c91';
  } else if (state === 'unsupported') {
    button.textContent = 'Indisponível';
    button.disabled = true;
    button.style.opacity = '.6';
    button.style.cursor = 'not-allowed';
  } else {
    button.textContent = 'Ativar';
    button.disabled = false;
    button.style.borderColor = 'rgba(119,216,151,.6)';
    button.style.color = '#77d897';
    button.style.opacity = '1';
    button.style.cursor = 'pointer';
  }
}

async function refreshTournamentReminderControl() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    setTournamentReminderControl('unsupported', 'Este navegador não oferece lembretes push. Use um navegador atualizado no celular.');
    return;
  }
  try {
    const status = await trpcQuery('push.status');
    if (status?.enabled) {
      setTournamentReminderControl('enabled', `Lembretes ativos neste dispositivo${status.deviceCount > 1 ? ` · ${status.deviceCount} dispositivos autorizados` : ''}.`);
    } else {
      setTournamentReminderControl('disabled', 'Receba avisos neste dispositivo antes do horário previsto dos campeonatos em que estiver inscrito.');
    }
  } catch {
    setTournamentReminderControl('disabled', 'Entre na tua conta para ativar lembretes de campeonatos neste dispositivo.');
  }
}

async function toggleTournamentReminders() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    toast('Este navegador não permite lembretes push.', 'warn');
    return;
  }
  try {
    const registration = await navigator.serviceWorker.ready;
    const currentSubscription = await registration.pushManager.getSubscription();
    const currentStatus = await trpcQuery('push.status');
    if (currentSubscription && currentStatus?.enabled) {
      await trpcMutation('push.unsubscribe', { endpoint: currentSubscription.endpoint });
      await currentSubscription.unsubscribe();
      setTournamentReminderControl('disabled', 'Lembretes desativados neste dispositivo. Você pode autorizar novamente quando quiser.');
      toast('Lembretes desativados neste dispositivo.', 'info');
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      setTournamentReminderControl('disabled', 'A permissão foi recusada. Você pode liberar as notificações nas configurações do navegador.');
      toast('Permissão de notificações não concedida.', 'warn');
      return;
    }
    const configResponse = await fetch('/api/push/config', { credentials: 'include' });
    if (!configResponse.ok) throw new Error('Configuração de notificações indisponível');
    const { vapidPublicKey } = await configResponse.json();
    const subscription = currentSubscription || await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });
    const keys = subscription.toJSON().keys || {};
    if (!keys.p256dh || !keys.auth) throw new Error('Assinatura de notificações incompleta');
    await trpcMutation('push.subscribe', {
      endpoint: subscription.endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      userAgent: navigator.userAgent,
    });
    setTournamentReminderControl('enabled', 'Lembretes ativos neste dispositivo para campeonatos em que você estiver inscrito.');
    toast('🔔 Lembretes ativados neste dispositivo!', 'win');
  } catch (error) {
    console.warn('[PWA] Não foi possível atualizar lembretes:', error);
    toast('Não foi possível atualizar os lembretes. Tente novamente.', 'warn');
  }
}

function filterTournaments(filter, btn) {
  _tournamentFilter = filter;
  document.querySelectorAll('#tf-all,#tf-registering,#tf-active').forEach(b => {
    const active = b === btn;
    b.style.background = active ? 'var(--tg-gold,#c8a84b)' : 'transparent';
    b.style.color = active ? '#000' : 'var(--txt3)';
    b.style.borderColor = active ? 'var(--tg-gold,#c8a84b)' : 'var(--bdr)';
  });
  renderTournamentsList(_tournamentsData);
}

function escapeNotificationText(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char]);
}

function formatNotificationTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function updateNotificationUnreadBadge(count) {
  const badge = document.getElementById('notification-unread-badge');
  if (!badge) return;
  const total = Number(count) || 0;
  badge.textContent = total > 99 ? '99+' : String(total);
  badge.style.display = total > 0 ? 'inline-block' : 'none';
}

function renderNotificationsCenter(data) {
  const list = document.getElementById('notifications-list');
  if (!list) return;
  const notifications = Array.isArray(data?.notifications) ? data.notifications : [];
  updateNotificationUnreadBadge(data?.unreadCount || 0);
  if (!notifications.length) {
    list.innerHTML = '<div style="padding:1.4rem .5rem;text-align:center;color:rgba(255,255,255,.5);font-size:.72rem">Ainda não há avisos por aqui. Quando um lembrete for enviado, ele aparecerá neste histórico.</div>';
    return;
  }
  list.innerHTML = notifications.map(notification => {
    const unread = !notification.readAt;
    return `<article style="display:flex;gap:.65rem;align-items:flex-start;padding:.68rem 0;border-bottom:1px solid rgba(255,255,255,.09);${unread ? 'background:rgba(245,215,124,.06);margin:0 -.25rem;padding-left:.25rem;padding-right:.25rem;border-radius:7px' : ''}">
      <span style="font-size:1.1rem">${notification.kind === 'tournament_reminder' ? '🏆' : '📍'}</span>
      <div style="min-width:0;flex:1"><div style="font-size:.75rem;font-weight:${unread ? '800' : '600'};color:${unread ? '#fff0b0' : 'rgba(255,255,255,.8)'}">${escapeNotificationText(notification.title)}</div><div style="font-size:.68rem;color:rgba(255,255,255,.58);line-height:1.4;margin-top:.12rem">${escapeNotificationText(notification.body)}</div><div style="font-size:.58rem;color:rgba(255,255,255,.35);margin-top:.3rem">${formatNotificationTime(notification.createdAt)}${unread ? ' · Não lida' : ''}</div></div>
      ${unread ? `<button onclick="markNotificationRead(${Number(notification.id)})" style="background:transparent;border:1px solid rgba(245,215,124,.4);color:#f5d77c;border-radius:6px;padding:.25rem .38rem;font-size:.58rem;cursor:pointer">Lida</button>` : ''}
    </article>`;
  }).join('');
}

async function refreshNotificationBadge() {
  try {
    const data = await window.trpcQuery?.('notifications.list', { limit: 1 });
    if (data) updateNotificationUnreadBadge(data.unreadCount || 0);
  } catch { /* a central exibirá o estado de login quando for aberta */ }
}

async function openNotificationsCenter() {
  show('notifications-scr');
  const list = document.getElementById('notifications-list');
  if (list) list.innerHTML = '<div style="padding:1.2rem;text-align:center;color:rgba(255,255,255,.55);font-size:.72rem">Carregando seus avisos...</div>';
  try {
    const data = await window.trpcQuery?.('notifications.list', { limit: 50 });
    if (!data) throw new Error('Sessão não disponível');
    renderNotificationsCenter(data);
  } catch {
    if (list) list.innerHTML = '<div style="padding:1.2rem;text-align:center;color:rgba(255,255,255,.62);font-size:.72rem">Entre na sua conta para consultar o histórico de avisos.</div>';
  }
}

async function markNotificationRead(notificationId) {
  try {
    await window.trpcMutation?.('notifications.markRead', { notificationId });
    await openNotificationsCenter();
  } catch { toast('Não foi possível atualizar este aviso.', 'warn'); }
}

async function markAllNotificationsRead() {
  try {
    await window.trpcMutation?.('notifications.markAllRead');
    await openNotificationsCenter();
  } catch { toast('Não foi possível atualizar os avisos.', 'warn'); }
}

function joinOnlineTournament(tournamentId) {
  if (!sio || !sioConnected || !sioAuthenticated) {
    toast('Conectando...', 'info');
    waitForAuth(function() { joinOnlineTournament(tournamentId); });
    return;
  }
  sio.emit('join_tournament', { tournamentId }, (res) => {
    if (res.error) { toast(res.error, 'warn'); return; }
    const total = res.currentPlayers || 1;
    toast(`🏆 Inscrito! ${total} jogador(es) até agora. Aguardando completar a chave...`, 'win');
    SFX.win && SFX.win();
    loadOnlineTournaments();
    window.startTournamentMatchMonitor?.();
  });
}

function leaveOnlineTournament(tournamentId) {
  if (!sio || !sioConnected || !sioAuthenticated) {
    toast('Conectando...', 'info');
    waitForAuth(function() { leaveOnlineTournament(tournamentId); });
    return;
  }
  sio.emit('leave_tournament', { tournamentId }, (res) => {
    if (res.error) { toast(res.error, 'warn'); return; }
    toast('✔ Saíste do campeonato, tchê!', 'info');
    loadOnlineTournaments();
  });
}

function loadOnlineTournaments() {
  if (!sio || !sioConnected) return;
  const el = document.getElementById('ot-tournaments-list') || document.getElementById('sio-tournaments-list');
  if (el) el.innerHTML = '<div style="text-align:center;color:var(--txt3);font-size:.75rem;padding:1.5rem"><div class="spinner" style="margin:0 auto .5rem"></div>Buscando campeonatos...</div>';
  sio.emit('list_tournaments', {}, (res) => {
    if (res.error) return;
    _tournamentsData = res.tournaments || [];
    renderTournamentsList(_tournamentsData);
    refreshTournamentReminderControl();
  });
}

function renderTournamentsList(tournaments) {
  const el = document.getElementById('ot-tournaments-list') || document.getElementById('sio-tournaments-list');
  if (!el) return;
  const filtered = _tournamentFilter === 'all' ? tournaments
    : tournaments.filter(t => t.status === _tournamentFilter);
  if (!filtered || filtered.length === 0) {
    el.innerHTML = `<div style="text-align:center;color:var(--txt3);font-size:.75rem;padding:2rem">
      <div style="font-size:2rem;margin-bottom:.5rem">🏆</div>
      <div>Nenhum campeonato ${_tournamentFilter === 'registering' ? 'aberto para inscrição' : _tournamentFilter === 'active' ? 'em andamento' : 'disponível'} no momento.</div>
      <div style="margin-top:.4rem;font-size:.65rem">Crie um e chame os guris!</div>
    </div>`;
    return;
  }
  el.innerHTML = filtered.map(t => {
    const isRegistering = t.status === 'registering';
    const pct = Math.round((t.currentPlayers / t.maxPlayers) * 100);
    const statusColor = isRegistering ? 'var(--tg-green,#4caf50)' : '#e94560';
    const statusLabel = isRegistering ? '✅ Inscrevendo' : '🔴 Em andamento';
    const playerNames = (t.players || []).map(p => p.userName).join(', ');
    const isCreator = Number(window.localUser?.id) === Number(t.creatorId);
    const isReadyToStart = isRegistering && t.currentPlayers === t.maxPlayers;
    const scheduledLabel = t.scheduledStartAt ? new Date(t.scheduledStartAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
    return `
      <div style="background:var(--surf);border:1.5px solid ${isRegistering ? 'rgba(200,168,75,.4)' : 'rgba(233,69,96,.3)'};border-radius:var(--r2);padding:.85rem;position:relative;overflow:hidden">
        <!-- Barra de progresso de inscrição -->
        <div style="position:absolute;top:0;left:0;height:3px;width:${pct}%;background:${statusColor};transition:width .4s"></div>
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem">
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t.name}</div>
            <div style="font-size:.65rem;color:var(--txt3);margin-top:.15rem">
              <span style="color:${statusColor};font-weight:600">${statusLabel}</span>
              &nbsp;·&nbsp;
              <span style="font-weight:700">${t.currentPlayers}/${t.maxPlayers}</span> jogadores
              &nbsp;·&nbsp;até ${Math.ceil(Math.log2(t.maxPlayers))} rodadas
            </div>
            ${t.prize ? `<div style="font-size:.62rem;color:var(--tg-gold,#c8a84b);margin-top:.2rem">🏆 ${t.prize}</div>` : ''}
            ${scheduledLabel ? `<div style="font-size:.62rem;color:var(--txt2);margin-top:.18rem">🕒 Previsto: ${scheduledLabel}</div>` : ''}
            ${playerNames ? `<div style="font-size:.58rem;color:var(--txt3);margin-top:.25rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">👥 ${playerNames}</div>` : ''}
          </div>
          <div style="flex-shrink:0">
            <div style="display:flex;flex-direction:column;gap:.3rem;align-items:flex-end">
              ${isRegistering
                ? `<button onclick="joinOnlineTournament(${t.id})" style="background:var(--tg-green,#4caf50);color:#fff;border:none;padding:.4rem .8rem;border-radius:var(--r);font-size:.7rem;font-weight:700;cursor:pointer">Inscrever</button>
                   <button onclick="leaveOnlineTournament(${t.id})" style="background:transparent;border:1px solid rgba(255,80,80,.5);color:#ff5050;padding:.3rem .6rem;border-radius:var(--r);font-size:.62rem;font-weight:600;cursor:pointer;white-space:nowrap">✖ Sair</button>`
                : `<span style="font-size:.65rem;color:var(--txt3);padding:.3rem .5rem;border:1px solid var(--bdr);border-radius:var(--r)">🔴 Rodada ${t.currentRound + 1}</span>`
              }
              ${isCreator && isReadyToStart ? `<button onclick="startOnlineTournamentManually(${t.id})" style="background:var(--tg-gold,#c8a84b);color:#201400;border:none;padding:.38rem .65rem;border-radius:var(--r);font-size:.62rem;font-weight:800;cursor:pointer;white-space:nowrap">🎲 Sortear e iniciar</button>` : ''}
              ${isCreator && isRegistering ? `<button onclick="editOnlineTournament(${t.id})" style="background:transparent;border:1px solid rgba(143,212,255,.5);color:#8fd4ff;padding:.3rem .6rem;border-radius:var(--r);font-size:.62rem;font-weight:600;cursor:pointer;white-space:nowrap">✏️ Editar</button><button onclick="cancelOnlineTournament(${t.id})" style="background:transparent;border:1px solid rgba(255,80,80,.5);color:#ff8c8c;padding:.3rem .6rem;border-radius:var(--r);font-size:.62rem;font-weight:600;cursor:pointer;white-space:nowrap">✖ Cancelar</button>` : ''}
              ${isCreator && t.status === 'completed' ? `<button onclick="duplicateOnlineTournament(${t.id})" style="background:transparent;border:1px solid rgba(119,216,151,.5);color:#77d897;padding:.3rem .6rem;border-radius:var(--r);font-size:.62rem;font-weight:700;cursor:pointer;white-space:nowrap">↻ Nova edição</button>` : ''}
              <button onclick="openTournamentBracket(${t.id})" style="background:transparent;border:1px solid rgba(200,168,75,.5);color:var(--tg-gold,#c8a84b);padding:.3rem .6rem;border-radius:var(--r);font-size:.62rem;font-weight:600;cursor:pointer;white-space:nowrap">🏆 Ver Chave</button>
              <button onclick="openPublicTournamentBracket(${t.id})" style="background:transparent;border:1px solid rgba(110,190,255,.48);color:#8fd4ff;padding:.3rem .6rem;border-radius:var(--r);font-size:.62rem;font-weight:600;cursor:pointer;white-space:nowrap">🔗 Página pública</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function startOnlineTournamentManually(tournamentId) {
  if (!sio || !sioConnected || !sioAuthenticated) { toast('Conectando à cancha...', 'info'); return; }
  sio.emit('start_tournament', { tournamentId }, (res) => {
    if (res?.error) { toast(res.error, 'warn'); return; }
    toast('🎲 Chave sorteada e campeonato iniciado!', 'win');
    loadOnlineTournaments();
  });
}

function editOnlineTournament(tournamentId) {
  const tournament = _tournamentsData.find(t => Number(t.id) === Number(tournamentId));
  if (!tournament) return;
  const name = prompt('Nome do torneio:', tournament.name);
  if (name === null) return;
  const prize = prompt('Prêmio personalizado (deixe vazio para remover):', tournament.prize || '');
  if (prize === null) return;
  const capacity = prompt('Quantidade par de vagas (2 a 64):', String(tournament.maxPlayers));
  if (capacity === null) return;
  const currentSchedule = tournament.scheduledStartAt ? new Date(tournament.scheduledStartAt).toISOString().slice(0, 16) : '';
  const scheduledStartAt = prompt('Horário previsto (AAAA-MM-DDTHH:MM, deixe vazio para remover):', currentSchedule);
  if (scheduledStartAt === null) return;
  sio.emit('update_tournament', { tournamentId, name, prize, maxPlayers: Number(capacity), scheduledStartAt: scheduledStartAt || null }, (res) => {
    if (res?.error) { toast(res.error, 'warn'); return; }
    toast('✔ Informações do campeonato atualizadas.', 'win');
    loadOnlineTournaments();
  });
}

function cancelOnlineTournament(tournamentId) {
  const tournament = _tournamentsData.find(t => Number(t.id) === Number(tournamentId));
  const existing = document.getElementById('tournament-cancel-dialog');
  if (existing) existing.remove();
  const dialog = document.createElement('div');
  dialog.id = 'tournament-cancel-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'tournament-cancel-title');
  dialog.style.cssText = 'position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:1rem;background:rgba(6,11,8,.78);backdrop-filter:blur(5px)';
  dialog.innerHTML = `<div style="width:min(100%,430px);background:linear-gradient(145deg,#2a1915,#17100d);border:1px solid rgba(255,120,105,.65);border-radius:16px;padding:1.3rem;color:#fff;box-shadow:0 24px 60px rgba(0,0,0,.55)"><div style="font-size:1.55rem;margin-bottom:.45rem">⚠️</div><h3 id="tournament-cancel-title" style="margin:0;font-size:1.05rem">Cancelar torneio?</h3><p style="margin:.55rem 0 1rem;color:rgba(255,255,255,.72);font-size:.78rem;line-height:1.55">As inscrições de <strong>${escapeRoomText(tournament?.name || 'este torneio')}</strong> serão encerradas e a chave não será sorteada. Esta ação não pode ser desfeita.</p><label style="display:block;font-size:.68rem;color:rgba(255,255,255,.6);margin-bottom:.35rem">Digite <strong style="color:#ffb1a8">CANCELAR</strong> para confirmar</label><input id="tournament-cancel-phrase" autocomplete="off" style="width:100%;box-sizing:border-box;padding:.65rem .7rem;border-radius:9px;border:1px solid rgba(255,255,255,.2);background:#0f0b09;color:#fff;outline:none" /><div style="display:flex;justify-content:flex-end;gap:.55rem;margin-top:1.1rem"><button type="button" id="tournament-cancel-back" style="padding:.5rem .75rem;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:transparent;color:#fff;cursor:pointer">Voltar</button><button type="button" id="tournament-cancel-confirm" disabled style="padding:.5rem .75rem;border-radius:8px;border:0;background:#8d2d28;color:#ffd8d4;font-weight:800;cursor:not-allowed">Cancelar torneio</button></div></div>`;
  document.body.appendChild(dialog);
  const input = dialog.querySelector('#tournament-cancel-phrase');
  const confirmButton = dialog.querySelector('#tournament-cancel-confirm');
  const close = () => dialog.remove();
  dialog.querySelector('#tournament-cancel-back').onclick = close;
  dialog.addEventListener('click', (event) => { if (event.target === dialog) close(); });
  input.addEventListener('input', () => {
    const allowed = input.value.trim().toUpperCase() === 'CANCELAR';
    confirmButton.disabled = !allowed;
    confirmButton.style.background = allowed ? '#c7443e' : '#8d2d28';
    confirmButton.style.color = allowed ? '#fff' : '#ffd8d4';
    confirmButton.style.cursor = allowed ? 'pointer' : 'not-allowed';
  });
  confirmButton.onclick = () => {
    sio.emit('cancel_tournament', { tournamentId }, (res) => {
      if (res?.error) { toast(res.error, 'warn'); return; }
      close();
      toast('Campeonato cancelado. Os inscritos foram avisados.', 'info');
      loadOnlineTournaments();
    });
  };
  setTimeout(() => input.focus(), 0);
}

function duplicateOnlineTournament(tournamentId) {
  const tournament = _tournamentsData.find(t => Number(t.id) === Number(tournamentId));
  if (!tournament) return;
  const existing = document.getElementById('tournament-duplicate-dialog');
  if (existing) existing.remove();
  const scheduled = tournament.scheduledStartAt && new Date(tournament.scheduledStartAt).getTime() > Date.now()
    ? new Date(tournament.scheduledStartAt).toISOString().slice(0, 16)
    : '';
  const dialog = document.createElement('div');
  dialog.id = 'tournament-duplicate-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'tournament-duplicate-title');
  dialog.style.cssText = 'position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:1rem;background:rgba(6,11,8,.78);backdrop-filter:blur(5px)';
  dialog.innerHTML = `<div style="width:min(100%,500px);background:linear-gradient(145deg,#1a2b1d,#0d1710);border:1px solid rgba(119,216,151,.62);border-radius:16px;padding:1.3rem;color:#fff;box-shadow:0 24px 60px rgba(0,0,0,.55)"><div style="font-size:1.45rem;margin-bottom:.35rem">↻</div><h3 id="tournament-duplicate-title" style="margin:0;font-size:1.05rem">Pré-visualizar nova edição</h3><p style="margin:.5rem 0 1rem;color:rgba(255,255,255,.68);font-size:.76rem;line-height:1.5">Revise as configurações antes de abrir as inscrições. A chave e os jogadores do evento anterior não serão copiados.</p><div style="display:grid;gap:.7rem"><label style="font-size:.68rem;color:rgba(255,255,255,.67)">Nome<input id="td-name" value="${escapeRoomText(tournament.name)} — Nova edição" style="margin-top:.25rem;width:100%;box-sizing:border-box;padding:.58rem .65rem;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:#0d1710;color:#fff" /></label><label style="font-size:.68rem;color:rgba(255,255,255,.67)">Prêmio<input id="td-prize" value="${escapeRoomText(tournament.prize || '')}" placeholder="Ex.: Troféu da Cancha" style="margin-top:.25rem;width:100%;box-sizing:border-box;padding:.58rem .65rem;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:#0d1710;color:#fff" /></label><div style="display:grid;grid-template-columns:1fr 1fr;gap:.65rem"><label style="font-size:.68rem;color:rgba(255,255,255,.67)">Vagas<input id="td-capacity" type="number" min="2" max="64" step="2" value="${Number(tournament.maxPlayers)}" style="margin-top:.25rem;width:100%;box-sizing:border-box;padding:.58rem .65rem;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:#0d1710;color:#fff" /></label><label style="font-size:.68rem;color:rgba(255,255,255,.67)">Horário previsto<input id="td-schedule" type="datetime-local" value="${scheduled}" style="margin-top:.25rem;width:100%;box-sizing:border-box;padding:.58rem .65rem;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:#0d1710;color:#fff" /></label></div></div><div style="display:flex;justify-content:flex-end;gap:.55rem;margin-top:1.15rem"><button type="button" id="td-back" style="padding:.5rem .75rem;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:transparent;color:#fff;cursor:pointer">Descartar</button><button type="button" id="td-confirm" style="padding:.5rem .75rem;border-radius:8px;border:0;background:#4d9b63;color:#fff;font-weight:800;cursor:pointer">Confirmar nova edição</button></div></div>`;
  document.body.appendChild(dialog);
  const close = () => dialog.remove();
  dialog.querySelector('#td-back').onclick = close;
  dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
  dialog.querySelector('#td-confirm').onclick = () => {
    const name = dialog.querySelector('#td-name').value.trim();
    const prize = dialog.querySelector('#td-prize').value.trim();
    const maxPlayers = Number(dialog.querySelector('#td-capacity').value);
    const scheduledStartAt = dialog.querySelector('#td-schedule').value || null;
    sio.emit('duplicate_tournament', { tournamentId, name, prize, maxPlayers, scheduledStartAt }, (res) => {
      if (res?.error) { toast(res.error, 'warn'); return; }
      close();
      toast('✔ Nova edição criada com as configurações revisadas.', 'win');
      loadOnlineTournaments();
    });
  };
  setTimeout(() => dialog.querySelector('#td-name').focus(), 0);
}

function openPublicTournamentBracket(tournamentId) {
  window.open(`/?publicTournament=${encodeURIComponent(tournamentId)}`, '_blank', 'noopener');
}

let publicTournamentPoll = null;
function publicTournamentEscape(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}
function renderPublicTournamentBracket(tournament) {
  const title = document.getElementById('public-tournament-title');
  const meta = document.getElementById('public-tournament-meta');
  const status = document.getElementById('public-tournament-status');
  const bracketEl = document.getElementById('public-tournament-bracket');
  if (!title || !meta || !status || !bracketEl) return;
  title.textContent = tournament.name;
  const scheduled = tournament.scheduledStartAt ? ` · Previsto: ${new Date(tournament.scheduledStartAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` : '';
  meta.textContent = `${tournament.currentPlayers}/${tournament.maxPlayers} jogadores · ${tournament.prize ? `Prêmio: ${tournament.prize}` : 'Sem prêmio informado'}${scheduled}`;
  const statusMap = { registering: '🟢 Inscrições abertas', active: '🔴 Rodada em andamento', completed: '🏆 Torneio concluído', cancelled: '⚫ Torneio cancelado' };
  status.textContent = `${statusMap[tournament.status] || 'Atualizando'} · atualizado agora`;
  const rounds = tournament.bracket?.rounds || [];
  if (!rounds.length) {
    bracketEl.innerHTML = '<div style="color:#d7dfd9;font-size:.8rem;padding:1.4rem 0">A chave será sorteada quando o organizador confirmar o início.</div>';
    return;
  }
  bracketEl.innerHTML = rounds.map((round, roundIndex) => `
    <section style="min-width:205px;flex:1">
      <div style="font-size:.68rem;text-transform:uppercase;letter-spacing:.1em;color:var(--tg-gold,#e8c45d);font-weight:800;margin:.3rem 0 .55rem">${roundIndex === rounds.length - 1 ? 'Final' : `Rodada ${roundIndex + 1}`}</div>
      <div style="display:grid;gap:.65rem">${round.map(match => {
        const p1Winner = match.winnerId && match.winnerId === match.p1UserId;
        const p2Winner = match.winnerId && match.winnerId === match.p2UserId;
        return `<article style="border:1px solid rgba(232,196,93,.28);border-radius:10px;background:rgba(6,18,14,.56);overflow:hidden">
          <div style="padding:.42rem .55rem;display:flex;justify-content:space-between;gap:.4rem;${p1Winner ? 'background:rgba(77,170,91,.22)' : ''}"><span>${publicTournamentEscape(match.p1Name || 'A definir')}</span><b>${p1Winner ? '✓' : ''}</b></div>
          <div style="border-top:1px solid rgba(255,255,255,.08);padding:.42rem .55rem;display:flex;justify-content:space-between;gap:.4rem;${p2Winner ? 'background:rgba(77,170,91,.22)' : ''}"><span>${publicTournamentEscape(match.p2Name || (match.p2UserId == null ? 'Avanço automático' : 'A definir'))}</span><b>${p2Winner ? '✓' : ''}</b></div>
          ${match.status === 'done' ? `<div style="padding:.25rem .55rem;font-size:.58rem;color:#9edca9;border-top:1px solid rgba(255,255,255,.08)">Resultado confirmado</div>` : ''}
        </article>`;
      }).join('')}</div>
    </section>`).join('');
}
async function loadPublicTournamentBracket(tournamentId) {
  try {
    const response = await fetch(`/api/public/tournaments/${encodeURIComponent(tournamentId)}`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || !data?.tournament) throw new Error(data?.error || 'Torneio indisponível');
    renderPublicTournamentBracket(data.tournament);
  } catch (error) {
    const status = document.getElementById('public-tournament-status');
    if (status) status.textContent = `Não foi possível carregar a chave pública: ${error.message || 'erro desconhecido'}`;
  }
}
function openPublicTournamentFromUrl() {
  const tournamentId = new URLSearchParams(location.search).get('publicTournament');
  if (!tournamentId) return;
  show('public-tournament-scr');
  loadPublicTournamentBracket(tournamentId);
  clearInterval(publicTournamentPoll);
  publicTournamentPoll = setInterval(() => loadPublicTournamentBracket(tournamentId), 3000);
}
setTimeout(openPublicTournamentFromUrl, 0);

// ── Live Rooms ──
function loadLiveRooms() {
  if (!sio || !sioConnected) return;
  sio.emit('list_live_rooms', {}, (res) => {
    if (!res || res.error) return;
    const el = document.getElementById('sio-live-rooms');
    if (!el) return;
    if (!res.rooms || res.rooms.length === 0) {
      el.innerHTML = '<div style="text-align:center;color:var(--txt3);font-size:.75rem;padding:1rem">👁️ Nenhuma partida ao vivo no momento.<br><span style="font-size:.65rem">Convide amigos e inicie uma partida!</span></div>';
      return;
    }
    el.innerHTML = res.rooms.map(r => {
      const score = r.score ? `${r.score.p1}×${r.score.p2}` : '0×0';
      return `
      <div style="background:var(--surf);border:1.5px solid var(--bdr);border-radius:var(--r2);padding:.7rem;display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-weight:700;font-size:.8rem">🔴 ${r.hostName} vs ${r.guestName}</div>
          <div style="font-size:.6rem;color:var(--txt3)">${r.mode.toUpperCase()} · Placar: ${score} · 👁️ ${r.spectators} assistindo</div>
        </div>
        <button onclick="spectateRoom('${r.code}')" style="background:var(--blue);color:#fff;border:none;padding:.3rem .7rem;border-radius:var(--r);font-size:.65rem;cursor:pointer;font-weight:700">👁️ Assistir</button>
      </div>`;
    }).join('');
  });
}

function spectateRoom(code) {
  if (!sio || !sioConnected) return;
  sio.emit('spectate', { code }, (res) => {
    if (res.error) { toast(res.error, 'warn'); return; }
    toast('Assistindo partida...', 'info');
    show('online-game');
  });
}

// ══════════════════════════════════════════════════════
//  TOURNAMENT BRACKET SCREEN
// ══════════════════════════════════════════════════════

var _currentBracketTournamentId = null;
var _bracketAutoRefreshTimer = null;

function openTournamentBracket(tournamentId) {
  _currentBracketTournamentId = tournamentId;
  show('tournament-bracket');
  loadTournamentBracket(tournamentId);
  // Join tournament socket room for real-time updates
  if (sio && sioConnected) {
    sio.emit('join_tournament_room', { tournamentId });
  }
  // Polling fallback: only when socket is NOT active.
  // When connected, tournament_bracket_updated carries the full bracketData
  // and triggers renderTournamentBracketFromSocket directly — polling would
  // be redundant and could overwrite fresh socket data with stale DB reads.
  clearInterval(_bracketAutoRefreshTimer);
  _bracketAutoRefreshTimer = null;
  if (!sio || !sioConnected) {
    _bracketAutoRefreshTimer = setInterval(() => {
      if (_currentBracketTournamentId) loadTournamentBracket(_currentBracketTournamentId);
    }, 8000);
  }
}

function closeTournamentBracket() {
  clearInterval(_bracketAutoRefreshTimer);
  _bracketAutoRefreshTimer = null;
  if (sio && sioConnected && _currentBracketTournamentId) {
    sio.emit('leave_tournament_room', { tournamentId: _currentBracketTournamentId });
  }
  _currentBracketTournamentId = null;
  show('online-lobby');
  switchOnlineTab('tournaments');
}

function refreshTournamentBracket() {
  if (_currentBracketTournamentId) loadTournamentBracket(_currentBracketTournamentId);
}

async function loadTournamentBracket(tournamentId) {
  try {
    const data = await trpcQuery('online.tournamentBracket', { tournamentId });
    if (!data) {
      document.getElementById('tb-bracket').innerHTML =
        '<div style="text-align:center;color:var(--txt3);padding:2rem">Torneio não encontrado.</div>';
      return;
    }
    renderTournamentBracket(data);
  } catch (e) {
    console.error('[Bracket] load error:', e);
  }
}

function renderTournamentBracket(data) {
  // Update title
  const titleEl = document.getElementById('tb-title');
  if (titleEl) titleEl.textContent = '🏆 ' + data.name;

  // Status badge
  const statusMap = {
    registering: { label: '✅ Inscrições abertas', color: 'var(--tg-green,#4caf50)' },
    active: { label: '🔴 Em andamento', color: '#e94560' },
    completed: { label: '🏆 Encerrado', color: 'var(--tg-gold,#c8a84b)' },
    cancelled: { label: '❌ Cancelado', color: 'var(--txt3)' },
  };
  const st = statusMap[data.status] || { label: data.status, color: 'var(--txt3)' };
  const statusEl = document.getElementById('tb-status');
  if (statusEl) {
    statusEl.textContent = st.label;
    statusEl.style.color = st.color;
  }

  // Prize
  const prizeEl = document.getElementById('tb-prize');
  if (prizeEl) prizeEl.textContent = data.prize ? '🏆 Prêmio: ' + data.prize : '';

  // Round info
  const roundEl = document.getElementById('tb-round-info');
  if (roundEl && data.rounds && data.rounds.length > 0) {
    roundEl.textContent = 'Rodada ' + (data.currentRoundIndex + 1) + ' de ' + data.totalRounds;
  }

  // Champion
  const champEl = document.getElementById('tb-champion');
  const champNameEl = document.getElementById('tb-champion-name');
  if (data.status === 'completed' && data.rounds && data.rounds.length > 0) {
    const lastRound = data.rounds[data.rounds.length - 1];
    const finalMatch = lastRound && lastRound[0];
    if (finalMatch && finalMatch.winnerName) {
      if (champEl) champEl.style.display = 'block';
      if (champNameEl) champNameEl.textContent = finalMatch.winnerName;
    }
  } else {
    if (champEl) champEl.style.display = 'none';
  }

  // Bracket tree
  const bracketEl = document.getElementById('tb-bracket');
  if (!bracketEl) return;

  if (!data.rounds || data.rounds.length === 0) {
    if (data.status === 'registering') {
      const pct = Math.round((data.players.length / data.maxPlayers) * 100);
      bracketEl.innerHTML = `
        <div style="text-align:center;color:var(--txt3);padding:2rem 1rem;width:100%">
          <div style="font-size:2.5rem;margin-bottom:.5rem">⏳</div>
          <div style="font-weight:700;font-size:.9rem;margin-bottom:.3rem">Aguardando jogadores</div>
          <div style="font-size:.75rem;margin-bottom:.8rem">${data.players.length}/${data.maxPlayers} inscritos</div>
          <div style="background:rgba(200,168,75,.15);border-radius:4px;height:8px;width:200px;margin:0 auto;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:var(--tg-gold,#c8a84b);transition:width .4s"></div>
          </div>
          <div style="font-size:.65rem;color:var(--txt3);margin-top:.5rem">O torneio inicia quando todos os jogadores se inscreverem</div>
          ${data.players.length > 0 ? `<div style="margin-top:.8rem;font-size:.65rem;color:var(--txt2)">👥 ${data.players.map(p => p.userName).join(', ')}</div>` : ''}
        </div>
      `;
    } else {
      bracketEl.innerHTML = '<div style="text-align:center;color:var(--txt3);padding:2rem">Chave ainda não gerada.</div>';
    }
    return;
  }

  const roundNames = ['Oitavas', 'Quartas', 'Semifinal', 'Final'];
  const getRoundName = (i, total) => {
    if (total === 1) return 'Final';
    if (i === total - 1) return 'Final';
    if (i === total - 2) return 'Semifinal';
    if (i === total - 3) return 'Quartas';
    return 'Rodada ' + (i + 1);
  };

  const matchHeight = 72;  // px per match card
  const matchGap = 12;     // px gap between matches
  const roundPad = 24;     // top padding per round

  bracketEl.innerHTML = data.rounds.map((round, ri) => {
    const totalRounds = data.rounds.length;
    const isCurrentRound = ri === data.currentRoundIndex && data.status === 'active';
    const roundName = getRoundName(ri, totalRounds);

    // Vertical spacing: matches in later rounds are spaced further apart
    const spacingFactor = Math.pow(2, ri);
    const matchSpacing = (matchHeight + matchGap) * spacingFactor;
    const topOffset = ((matchHeight + matchGap) * spacingFactor - matchHeight) / 2;

    const matchCards = round.map((match, mi) => {
      const top = roundPad + topOffset + mi * matchSpacing;
      const isDone = match.status === 'done' || match.winnerId;
      const isBye = match.status === 'bye' || match.p2UserId === null || match.p2UserId === 0; // null = new sentinel, 0 = legacy fallback
      const isPlaying = match.status === 'playing';

      const borderColor = isDone ? 'rgba(200,168,75,.5)'
        : isPlaying ? '#e94560'
        : isCurrentRound ? 'rgba(200,168,75,.3)'
        : 'var(--bdr)';

      const p1Won = isDone && match.winnerId === match.p1UserId;
      const p2Won = isDone && match.winnerId === match.p2UserId;

      const p1Style = p1Won
        ? 'font-weight:800;color:var(--tg-gold,#c8a84b)'
        : (isDone && !p1Won) ? 'opacity:.45;text-decoration:line-through' : 'font-weight:600';
      const p2Style = p2Won
        ? 'font-weight:800;color:var(--tg-gold,#c8a84b)'
        : (isDone && !p2Won) ? 'opacity:.45;text-decoration:line-through' : 'font-weight:600';

      const scoreStr = isDone && match.scoreP1 !== undefined
        ? `<span style="font-size:.55rem;color:var(--txt3);margin-left:.3rem">${match.scoreP1}×${match.scoreP2}</span>`
        : '';

      const playingBadge = isPlaying
        ? `<div style="position:absolute;top:-6px;right:6px;background:#e94560;color:#fff;font-size:.5rem;font-weight:700;padding:1px 5px;border-radius:4px;animation:pulse 1s infinite">🔴 AO VIVO</div>`
        : '';

      const byeContent = isBye
        ? `<div style="padding:.35rem .5rem;font-size:.7rem;${p1Style}">${match.p1Name}</div>
           <div style="padding:.35rem .5rem;font-size:.7rem;opacity:.3;font-style:italic">BYE — avance automático</div>`
        : `<div style="padding:.35rem .5rem;font-size:.7rem;border-bottom:1px solid var(--bdr);${p1Style}">
             ${p1Won ? '🏆 ' : ''}${match.p1Name}${p1Won ? scoreStr : ''}
           </div>
           <div style="padding:.35rem .5rem;font-size:.7rem;${p2Style}">
             ${p2Won ? '🏆 ' : ''}${match.p2Name}${p2Won ? scoreStr : ''}
           </div>`;

      return `<div style="position:absolute;left:0;top:${top}px;width:160px;background:var(--surf);border:1.5px solid ${borderColor};border-radius:var(--r2);overflow:hidden;position:absolute;top:${top}px">
        ${playingBadge}
        ${byeContent}
      </div>`;
    }).join('');

    // Total height of this column
    const colHeight = roundPad * 2 + round.length * matchSpacing - matchGap + topOffset;

    return `
      <div style="flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:0">
        <!-- Round header -->
        <div style="font-size:.65rem;font-weight:700;color:${isCurrentRound ? '#e94560' : 'var(--txt3)'};text-transform:uppercase;letter-spacing:.05em;padding:.3rem .5rem;background:${isCurrentRound ? 'rgba(233,69,96,.1)' : 'transparent'};border-radius:4px;margin-bottom:.5rem;white-space:nowrap">
          ${isCurrentRound ? '🔴 ' : ''}${roundName}
        </div>
        <!-- Match cards column -->
        <div style="position:relative;width:160px;height:${colHeight}px">
          ${matchCards}
        </div>
      </div>
    `;
  }).join('');
}

// ══════════════════════════════════════════════════════
//  ONLINE GAME SCREEN & RENDERING
// ══════════════════════════════════════════════════════

const SUIT_SYMBOLS = { Espadas: '🗡️', Bastos: '🪵', Copas: '🏆', Ouros: '🪙', espadas: '🗡️', bastos: '🪵', copas: '🏆', ouros: '🪙' };
const CARD_VALUES_DISPLAY = { 1:'A', 2:'2', 3:'3', 4:'4', 5:'5', 6:'6', 7:'7', 10:'S', 11:'C', 12:'R' };
window._ogResolvedTrick = window._ogResolvedTrick || null;
window._ogResolvedTrickTimer = window._ogResolvedTrickTimer || null;

function clearOnlineResolvedTrick() {
  if (window._ogResolvedTrickTimer) clearTimeout(window._ogResolvedTrickTimer);
  window._ogResolvedTrickTimer = null;
  window._ogResolvedTrick = null;
}

function showOnlineResolvedTrick(data) {
  if (!data || !Array.isArray(data.cards) || data.cards.length < 2) return;
  clearOnlineResolvedTrick();
  window._ogResolvedTrick = { cards: data.cards, result: data.result };
  if (sioGameState) renderOnlineGame(sioGameState);
  window._ogResolvedTrickTimer = setTimeout(function() {
    clearOnlineResolvedTrick();
    if (sioGameState) renderOnlineGame(sioGameState);
  }, 1850);
}

const ONLINE_GAME_AVATARS = [
  { id: 'brabao-apartamento', src: '/manus-storage/brabao-apartamento_bc25f853.png', label: 'Brabão de Apartamento' },
  { id: 'gaucho-apartamento', src: '/manus-storage/gaucho-apartamento_3a16a879.png', label: 'Gaúcho de Apartamento' },
  { id: 'gaucho-diferente', src: '/manus-storage/gaucho-diferente_28715407.png', label: 'Gaúcho Diferente' },
  { id: 'gaucho-colorido', src: '/manus-storage/gaucho-colorido_bad96dcc.png', label: 'Gaúcho Colorido' },
  { id: 'prenda-campo', src: '/manus-storage/prenda-campo_c275a75c.png', label: 'Prenda do Campo' },
  { id: 'debochada', src: '/manus-storage/debochada_e2217d75.png', label: 'Debochada' },
  { id: 'truqueiro', src: '/manus-storage/truqueiro_524cf267.png', label: 'Truqueiro' },
  { id: 'gaiteira', src: '/manus-storage/gaiteira_f4a9fc88.png', label: 'Gaiteira' },
  { id: 'churrasqueiro', src: '/manus-storage/churrasqueiro_052a93c8.png', label: 'Churrasqueiro' },
];

function onlineAvatarSeed(value) {
  let hash = 2166136261;
  const text = String(value || 'truco-tche');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function getOnlineAvatarForRole(roomCode, role) {
  const firstIndex = onlineAvatarSeed(roomCode) % ONLINE_GAME_AVATARS.length;
  const secondIndex = (firstIndex + 1) % ONLINE_GAME_AVATARS.length;
  return ONLINE_GAME_AVATARS[role === 'p2' ? secondIndex : firstIndex];
}

function renderOnlinePlayerAvatar(element, avatar, presence, playerName) {
  if (!element || !avatar) return;
  const normalizedPresence = ['online', 'reconnecting', 'offline'].includes(presence) ? presence : 'online';
  element.setAttribute('aria-label', `${playerName}: ${normalizedPresence === 'online' ? 'on-line' : normalizedPresence === 'reconnecting' ? 'reconectando' : 'desconectado'}`);
  element.innerHTML = `<img class="og-avatar-media" src="${avatar.src}" alt="Avatar ${avatar.label}"><span class="og-presence ${normalizedPresence}" aria-hidden="true"></span>`;
}

function emitOnlineGameplayAction(type, payload, callback) {
  if (sioGameState?.isTeamGame) {
    if (type === 'play_card') return sio.emit('team_play_card', payload, callback);
    return sio.emit('team_action', { type, ...payload }, callback);
  }
  return sio.emit(type, payload, callback);
}

function emitOnlineModalAction(type, payload) {
  if (!sio) return;
  if (sioGameState?.isTeamGame) sio.emit('team_action', { type, ...(payload || {}) });
  else sio.emit(type, payload || {});
}

function normalizeTeamStateForTable(state) {
  const myTeam = state.team;
  const opponentTeam = myTeam === 'A' ? 'B' : 'A';
  const participants = Array.isArray(state.participants) ? state.participants : [];
  const opponentName = participants.filter(player => player.team === opponentTeam).map(player => player.userName).join(' · ') || `Equipe ${opponentTeam}`;
  const teammateNames = participants.filter(player => player.team === myTeam && player.role !== state.myRole).map(player => player.userName);
  const hasTeamFlor = Object.entries(state.hasFlor || {}).some(([role, hasFlor]) => state.teams?.[role] === myTeam && hasFlor);
  const table = (state.table || []).map(card => ({ ...card, player: state.teams?.[card.player] === myTeam ? 'p1' : 'p2' }));
  const resolved = Array.isArray(window._ogResolvedTrick?.cards) ? { ...window._ogResolvedTrick, cards: window._ogResolvedTrick.cards.map(card => ({ ...card, player: state.teams?.[card.player] === myTeam ? 'p1' : 'p2' })) } : null;
  if (resolved) window._ogResolvedTrick = resolved;
  const opponentCardCount = participants.filter(player => player.team === opponentTeam).reduce((total, player) => total + Number(state.cardCounts?.[player.role] || 0), 0);
  const isMyTurn = state.turn === state.myRole && state.phase === 'playing';
  return {
    ...state,
    score: { p1: state.score?.[myTeam] || 0, p2: state.score?.[opponentTeam] || 0 },
    myRole: 'p1',
    currentPlayer: isMyTurn ? 'p1' : 'p2',
    handMano: state.teams?.[state.handMano] === myTeam ? 'p1' : 'p2',
    myName: teammateNames.length ? `Equipe ${myTeam} · ${state.myName}` : `Equipe ${myTeam} · ${state.myName}`,
    opponentName: `Equipe ${opponentTeam} · ${opponentName}`,
    table,
    roundWins: (state.roundWins || []).map(result => result === myTeam ? 'p1' : result === opponentTeam ? 'p2' : result),
    opponentCardCount,
    canTruco: isMyTurn && state.trucoLevel < 4 && (!state.lastTrucoCaller || state.teams?.[state.lastTrucoCaller] !== myTeam),
    canEnvido: isMyTurn && !state.envidoResolved && !state.playedFirst?.[state.turn] && !hasTeamFlor,
    canFlor: isMyTurn && Boolean(state.hasFlor?.[state.turn]) && !state.envidoResolved,
    teamOriginal: state,
  };
}

function renderOnlineGame(state) {
  if (state?.isTeamGame) state = normalizeTeamStateForTable(state);
  // ── Computed flags (must be first) ──
  const isMyTurn = state.currentPlayer === state.myRole && state.phase === 'playing';
  const iAmMao = state.handMano === state.myRole;
  // ── Scores ──
  const myScoreEl = document.getElementById('og-score-me');
  const oppScoreEl = document.getElementById('og-score-opp');
  const myScore = state.myRole === 'p1' ? state.score.p1 : state.score.p2;
  const oppScore = state.myRole === 'p1' ? state.score.p2 : state.score.p1;
  if (myScoreEl.textContent !== String(myScore)) {
    myScoreEl.textContent = myScore;
    myScoreEl.classList.remove('bump');
    void myScoreEl.offsetWidth;
    myScoreEl.classList.add('bump');
  }
  if (oppScoreEl.textContent !== String(oppScore)) {
    oppScoreEl.textContent = oppScore;
    oppScoreEl.classList.remove('bump');
    void oppScoreEl.offsetWidth;
    oppScoreEl.classList.add('bump');
  }
  // ── Names + crown (mão) ──
  const nameMe = document.getElementById('og-name-me');
  const nameOpp = document.getElementById('og-name-opp');
  const maoMe = document.getElementById('og-mao-me');
  const maoOpp = document.getElementById('og-mao-opp');
  nameMe.childNodes[0].textContent = state.myName || 'Você';
  nameOpp.childNodes[0].textContent = state.opponentName || 'Adversário';
  maoMe.textContent = iAmMao ? ' 👑' : '';
  maoMe.className = 'og-mao-icon' + (iAmMao ? ' active' : '');
  maoOpp.textContent = !iAmMao ? ' 👑' : '';
  maoOpp.className = 'og-mao-icon' + (!iAmMao ? ' active' : '');
  // ── Avatar active state (glows on current player's turn) ──
  const avatarMe = document.getElementById('og-avatar-me');
  const avatarOpp = document.getElementById('og-avatar-opp');
  if (avatarMe) avatarMe.className = 'og-hdr-avatar' + (isMyTurn ? ' active' : '');
  if (avatarOpp) avatarOpp.className = 'og-hdr-avatar opp' + (!isMyTurn && state.phase === 'playing' ? ' active' : '');
  renderOnlinePlayerAvatar(avatarMe, getOnlineAvatarForRole(state.roomCode, state.myRole), 'online', state.myName || 'Você');
  renderOnlinePlayerAvatar(avatarOpp, getOnlineAvatarForRole(state.roomCode, state.myRole === 'p1' ? 'p2' : 'p1'), window._ogOpponentPresence || 'online', state.opponentName || 'Adversário');
  // ── Turn Timer Bar ──
  const turnTimerEl = document.getElementById('og-turn-timer');
  const turnTimerBar = document.getElementById('og-turn-timer-bar');
  if (turnTimerEl && turnTimerBar) {
    const timedPhase = ['playing', 'truco_neg', 'envido_neg', 'flor_neg'].includes(state.phase);
    if (timedPhase && state.turnTimeoutMs) {
      turnTimerEl.style.display = 'block';
      // Reset and continue from the server-authoritative remaining time.
      if (window._ogTurnTimerInterval) clearInterval(window._ogTurnTimerInterval);
      const totalMs = state.turnTimeoutMs;
      const remainingMs = Math.min(totalMs, Math.max(0, state.turnTimeLeftMs ?? totalMs));
      const startTime = Date.now() - (totalMs - remainingMs);
      turnTimerBar.style.width = '100%';
      turnTimerBar.classList.remove('urgent');
      window._ogTurnTimerInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const pct = Math.max(0, 100 - (elapsed / totalMs) * 100);
        turnTimerBar.style.width = pct + '%';
        if (pct < 25 && !turnTimerBar.classList.contains('urgent')) {
          turnTimerBar.classList.add('urgent');
        }
        if (pct <= 0) clearInterval(window._ogTurnTimerInterval);
      }, 200);
    } else {
      turnTimerEl.style.display = 'none';
      if (window._ogTurnTimerInterval) { clearInterval(window._ogTurnTimerInterval); window._ogTurnTimerInterval = null; }
    }
  }
  // ── Opponent name strip ──
  const oppNameStrip = document.getElementById('og-opp-name-strip');
  if (oppNameStrip) oppNameStrip.textContent = state.opponentName || 'Adversário';
  // ── Vira card ──
  const viraWrap = document.getElementById('og-vira-wrap');
  const viraCard = document.getElementById('og-vira-card');
  const feltVs = document.getElementById('og-felt-vs');
  if (state.vira && viraWrap && viraCard) {
    viraWrap.style.display = 'flex';
    if (feltVs) feltVs.style.display = 'none'; // hide ⚔ when vira is shown
    const viraImg = cimg(state.vira);
    if (viraImg) {
      viraCard.innerHTML = '';
      const img = document.createElement('img');
      img.src = viraImg; img.alt = 'Vira';
      img.style.cssText = 'width:28px;height:44px;border-radius:3px;border:1px solid rgba(255,255,255,.3);object-fit:cover';
      viraCard.appendChild(img);
    } else {
      const vVal = CARD_VALUES_DISPLAY[state.vira.rank] || state.vira.rank;
      const vSuit = SUIT_SYMBOLS[state.vira.suit] || state.vira.suit;
      viraCard.textContent = vVal + ' ' + vSuit;
    }
  }
  // ── Truco badge ──
  const trucoBadge = document.getElementById('og-truco-badge');
  if (trucoBadge) {
    const tLevel = state.trucoLevel || 1;
    if (tLevel > 1) {
      trucoBadge.style.display = 'inline-block';
      trucoBadge.textContent = tLevel === 2 ? 'TRUCO!' : tLevel === 3 ? 'RETRUCO!' : 'VALE 4!';
    } else {
      trucoBadge.style.display = 'none';
    }
  }
  // ── Round pips ──
  for (let i = 0; i < 3; i++) {
    const pip = document.getElementById('og-pip' + i);
    if (!pip) continue;
    const rw = state.roundWins[i];
    pip.className = 'pip';
    if (rw === state.myRole) pip.classList.add('won');
    else if (rw === 'draw') pip.classList.add('draw');
    else if (rw) pip.classList.add('lost');
  }
  // ── Phase indicator ──
  const phEl = document.getElementById('og-phase');
  phEl.textContent = isMyTurn ? '▶ Sua vez' : state.phase === 'playing' ? '⏳ Adversário pensa...' : state.phase;
  phEl.className = 'g-ph ' + (isMyTurn ? 'ph-play' : 'ph-wait');
  // ── Mano label ──
  const manoLabel = document.getElementById('og-mano-label');
  if (manoLabel) {
    manoLabel.style.display = iAmMao ? '' : 'none';
  }
  // ── My hand (using card images like AI game) ──
  const handEl = document.getElementById('og-my-hand');
  handEl.innerHTML = '';
  if (state.myHand) {
    state.myHand.forEach(card => {
      const d = document.createElement('div');
      const isManilha = typeof isMan === 'function' ? isMan(card.rank, card.suit) : false;
      d.className = 'hc' + (isMyTurn ? '' : ' dis') + (isManilha ? ' man' : '');
      d.title = card.rank + ' de ' + card.suit;
      d.setAttribute('aria-label', card.rank + ' de ' + card.suit + (isManilha ? ' (manilha)' : ''));
      d.setAttribute('role', 'button');
      const img = document.createElement('img');
      img.src = cimg(card);
      img.alt = '';
      d.appendChild(img);
      if (isMyTurn) {
        d.onclick = () => {
          // Lock UI: disable all cards until server ACK
          const allCards = handEl.querySelectorAll('.hc');
          allCards.forEach(c => { c.classList.add('dis'); c.onclick = null; });
          emitOnlineGameplayAction('play_card', { cardId: card.id }, (res) => {
            if (res && res.error) {
              toast(res.error, 'warn');
              // Re-render to restore clickability on error
              renderOnlineGame(sioGameState);
              return;
            }
            // On success, server will emit new game_state which re-renders
            syncOnlineStateNow();
          });
        };
      }
      handEl.appendChild(d);
    });
  }
  // ── Opponent hand (face down, using CARD_BACK like AI game) ──
  const oppHandEl = document.getElementById('og-opp-hand');
  oppHandEl.innerHTML = '';
  for (let i = 0; i < (state.opponentCardCount || 0); i++) {
    const d = document.createElement('div');
    d.className = 'ai-bk';
    const img = document.createElement('img');
    img.src = CARD_BACK;
    img.alt = '';
    d.appendChild(img);
    oppHandEl.appendChild(d);
  }
  // ── Table cards (using card images like AI game) ──
  const tableMeEl = document.getElementById('og-table-me');
  const tableOppEl = document.getElementById('og-table-opp');
  tableMeEl.innerHTML = '';
  tableOppEl.innerHTML = '';
  const resolvedTrick = (!state.table || state.table.length === 0) ? window._ogResolvedTrick : null;
  const tableCards = state.table && state.table.length ? state.table : (resolvedTrick ? resolvedTrick.cards : []);
  if (tableCards) {
    tableCards.forEach(tc => {
      const isMe = tc.player === state.myRole;
      const d = document.createElement('div');
      d.className = 'tc';
      if (resolvedTrick && resolvedTrick.result !== 'draw') d.classList.add(tc.player === resolvedTrick.result ? 'trick-winner' : 'trick-loser');
      if (tc.card) {
        const img = document.createElement('img');
        img.src = cimg(tc.card);
        img.alt = '';
        d.appendChild(img);
      }
      (isMe ? tableMeEl : tableOppEl).appendChild(d);
    });
  }
  const trickResultEl = document.getElementById('og-trick-result');
  if (trickResultEl) {
    if (resolvedTrick) {
      const isDraw = resolvedTrick.result === 'draw';
      const isMeWinner = resolvedTrick.result === state.myRole;
      trickResultEl.textContent = isDraw ? '⚖ Empate na vaza' : (isMeWinner ? '🏆 Você ganhou a vaza' : '🏆 Adversário ganhou a vaza');
      trickResultEl.className = 'og-trick-result ' + (isDraw ? 'draw' : (isMeWinner ? 'me' : 'opp'));
      trickResultEl.style.display = '';
    } else {
      trickResultEl.style.display = 'none';
    }
  }
  // ── Action buttons (Truco / Envido / Correr bar) ──
  const actionsEl = document.getElementById('og-actions');
  actionsEl.innerHTML = '';
  if (!resolvedTrick && isMyTurn && state.phase === 'playing') {
    // Truco button
    if (state.canTruco) {
      const trucoBtn = document.createElement('button');
      trucoBtn.className = 'sb sb-truco';
      const tLvl = state.trucoLevel || 1;
      trucoBtn.textContent = tLvl <= 1 ? '🔥 Truco' : tLvl === 2 ? '🔥 Retruco' : '💀 Vale 4';
      trucoBtn.onclick = () => emitOnlineGameplayAction('call_truco', {}, (r) => {
        if (r?.error) return toast(r.error, 'warn');
        syncOnlineStateNow();
      });
      actionsEl.appendChild(trucoBtn);
    }
    // Envido button
    if (state.canEnvido) {
      const envidoBtn = document.createElement('button');
      envidoBtn.className = 'sb sb-envido';
      envidoBtn.textContent = '🎯 Envido';
      envidoBtn.onclick = () => emitOnlineGameplayAction('call_envido', { action: 'envido' }, (r) => {
        if (r?.error) return toast(r.error, 'warn');
        syncOnlineStateNow();
      });
      actionsEl.appendChild(envidoBtn);
    }
    // Flor button
    if (state.canFlor) {
      const florBtn = document.createElement('button');
      florBtn.className = 'sb sb-flor';
      florBtn.textContent = '🌸 Flor';
      florBtn.onclick = () => emitOnlineGameplayAction('call_flor', { action: 'flor' }, (r) => {
        if (r?.error) return toast(r.error, 'warn');
        syncOnlineStateNow();
      });
      actionsEl.appendChild(florBtn);
    }
    // Fold button (Mazo/Correr)
    if (!state.isTeamGame) {
      const foldBtn = document.createElement('button');
      foldBtn.className = 'sb sb-fold';
      foldBtn.textContent = '🏳 Correr';
      foldBtn.onclick = () => sio.emit('fold_hand', {}, (r) => {
        if (r?.error) return toast(r.error, 'warn');
        syncOnlineStateNow();
      });
      actionsEl.appendChild(foldBtn);
    }
  }
}

function showOnlineLayoutPreview() {
  const previewHand = [
    { id: 'preview-10', rank: 10, suit: 'Bastos', tv: 5, ev: 0 },
    { id: 'preview-4', rank: 4, suit: 'Copas', tv: 1, ev: 4 },
    { id: 'preview-7', rank: 7, suit: 'Espadas', tv: 12, ev: 7 },
  ];
  show('online-game');
  renderOnlineGame({
    phase: 'playing', turn: 'p1', currentPlayer: 'p1', myRole: 'p1',
    myName: 'Você', opponentName: 'Gaudério', myHand: previewHand,
    opponentCardCount: 3, table: [], roundWins: [], score: { p1: 4, p2: 3 }, target: 12,
    mano: 'p1', handMano: 'p1', trucoLevel: 1, trucoCaller: null, lastTrucoCaller: null,
    envidoChain: [], envidoBet: 0, envidoCaller: null, envidoResolved: false, envidoPoints: { p1: 0, p2: 0 },
    hasFlor: { p1: false, p2: false }, florChain: [], florBet: 0, florCaller: null,
    trucoPendingEnvido: false, playedFirst: { p1: false, p2: false },
    canTruco: true, canEnvido: true, canFlor: false, canFold: true,
    turnStartedAt: Date.now(), turnTimeoutMs: 30_000,
  });
}

if (new URLSearchParams(window.location.search).has('layoutPreview')) {
  window.addEventListener('load', () => setTimeout(showOnlineLayoutPreview, 0), { once: true });
}

function auditOnlineMobileLayout() {
  const withinViewport = (element) => {
    const rect = element?.getBoundingClientRect();
    return Boolean(rect && rect.left >= -1 && rect.right <= window.innerWidth + 1 && rect.top >= -1 && rect.bottom <= window.innerHeight + 1);
  };
  const cards = Array.from(document.querySelectorAll('#og-my-hand .hc'));
  const hand = document.getElementById('og-my-hand');
  const actions = document.getElementById('og-actions');
  const score = document.querySelector('.og-hdr');
  const table = document.querySelector('.og-mesa');
  const result = {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    scoreVisible: withinViewport(score),
    actionsVisible: withinViewport(actions),
    handVisible: withinViewport(hand),
    tableVisible: withinViewport(table),
    cardsVisible: cards.length === 3 && cards.every(withinViewport),
    actionsCount: actions?.querySelectorAll('button').length || 0,
  };
  document.body.dataset.onlineLayoutAudit = JSON.stringify(result);
  const auditBadge = document.createElement('output');
  auditBadge.id = 'og-layout-audit';
  auditBadge.textContent = `Auditoria mobile: placar ${result.scoreVisible ? '✓' : '✕'} · ações ${result.actionsVisible ? '✓' : '✕'} · mão ${result.handVisible ? '✓' : '✕'} · mesa ${result.tableVisible ? '✓' : '✕'} · cartas ${result.cardsVisible ? '✓' : '✕'}`;
  auditBadge.style.cssText = 'position:fixed;z-index:9999;left:8px;right:8px;bottom:62px;padding:6px 8px;border-radius:8px;background:#102a1ccc;color:#d9ffe2;border:1px solid #6df08b;font:600 10px/1.3 Arial;text-align:center;pointer-events:none';
  document.body.appendChild(auditBadge);
  return result;
}

if (new URLSearchParams(window.location.search).has('layoutAudit')) {
  window.addEventListener('load', () => setTimeout(() => window.__onlineLayoutAudit = auditOnlineMobileLayout(), 120), { once: true });
}

// ── Modals for Truco/Envido/Flor challenges ──
function showOnlineTrucoModal(data) {
  const level = data.level;
  const labels = { 1: 'Truco!', 2: 'Retruco!', 3: 'Vale 4!' };
  let html = `
    <div class="modal-overlay" id="m-online-truco" style="display:flex">
      <div class="modal" style="max-width:340px">
        <div style="font-size:2rem;text-align:center;margin-bottom:.5rem">🃏</div>
        <div style="font-size:1.1rem;font-weight:700;text-align:center;margin-bottom:.3rem">${data.callerName} pediu ${labels[level] || 'Truco!'}</div>
        <div style="font-size:.75rem;color:var(--txt3);text-align:center;margin-bottom:1rem">Vale ${level * 3 || 3} pontos</div>
        <div style="display:flex;gap:.5rem;justify-content:center">
          <button onclick="emitOnlineModalAction('accept_truco');closeOnlineModal('m-online-truco')" style="background:var(--tg-green);color:#fff;border:none;padding:.5rem 1rem;border-radius:var(--r);font-weight:700;cursor:pointer;font-size:.8rem">✅ Aceitar</button>
          ${level < 3 ? `<button onclick="emitOnlineModalAction(sioGameState?.isTeamGame ? 'call_truco' : 'raise_truco');closeOnlineModal('m-online-truco')" style="background:var(--tg-gold);color:#000;border:none;padding:.5rem 1rem;border-radius:var(--r);font-weight:700;cursor:pointer;font-size:.8rem">🔥 ${level === 1 ? 'Retruco!' : 'Vale 4!'}</button>` : ''}
          <button onclick="emitOnlineModalAction('refuse_truco');closeOnlineModal('m-online-truco')" style="background:var(--tg-red);color:#fff;border:none;padding:.5rem 1rem;border-radius:var(--r);font-weight:700;cursor:pointer;font-size:.8rem">❌ Correr</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}

function showOnlineEnvidoModal(data) {
  let html = `
    <div class="modal-overlay" id="m-online-envido" style="display:flex">
      <div class="modal" style="max-width:340px">
        <div style="font-size:2rem;text-align:center;margin-bottom:.5rem">🎯</div>
        <div style="font-size:1.1rem;font-weight:700;text-align:center;margin-bottom:.3rem">${data.callerName} pediu ${data.action}!</div>
        <div style="font-size:.75rem;color:var(--txt3);text-align:center;margin-bottom:1rem">Aposta: ${data.bet} pontos</div>
        <div style="display:flex;gap:.5rem;justify-content:center">
          <button onclick="emitOnlineModalAction('accept_envido');closeOnlineModal('m-online-envido')" style="background:var(--tg-green);color:#fff;border:none;padding:.5rem 1rem;border-radius:var(--r);font-weight:700;cursor:pointer;font-size:.8rem">✅ Aceitar</button>
          <button onclick="emitOnlineModalAction('refuse_envido');closeOnlineModal('m-online-envido')" style="background:var(--tg-red);color:#fff;border:none;padding:.5rem 1rem;border-radius:var(--r);font-weight:700;cursor:pointer;font-size:.8rem">❌ Recusar</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}

function showOnlineFlorModal(data) {
  let html = `
    <div class="modal-overlay" id="m-online-flor" style="display:flex">
      <div class="modal" style="max-width:340px">
        <div style="font-size:2rem;text-align:center;margin-bottom:.5rem">🌸</div>
        <div style="font-size:1.1rem;font-weight:700;text-align:center;margin-bottom:.3rem">Flor!</div>
        <div style="font-size:.75rem;color:var(--txt3);text-align:center;margin-bottom:1rem">Aposta: ${data.bet} pontos</div>
        <div style="display:flex;gap:.5rem;justify-content:center;flex-wrap:wrap">
          <button onclick="emitOnlineModalAction('accept_flor');closeOnlineModal('m-online-flor')" style="background:var(--tg-green);color:#fff;border:none;padding:.5rem 1rem;border-radius:var(--r);font-weight:700;cursor:pointer;font-size:.8rem">✅ Aceitar</button>
          <button onclick="emitOnlineModalAction('refuse_flor');closeOnlineModal('m-online-flor')" style="background:var(--tg-red);color:#fff;border:none;padding:.5rem 1rem;border-radius:var(--r);font-weight:700;cursor:pointer;font-size:.8rem">❌ Recusar</button>
          ${data.action === 'flor' ? `<button onclick="emitOnlineModalAction('call_flor',{action:'contra_flor'});closeOnlineModal('m-online-flor')" style="background:var(--tg-gold);color:#2b1705;border:none;padding:.5rem 1rem;border-radius:var(--r);font-weight:800;cursor:pointer;font-size:.8rem">Contra-Flor</button>` : ''}
          ${data.action === 'contra_flor' ? `<button onclick="emitOnlineModalAction('call_flor',{action:'contra_flor_resto'});closeOnlineModal('m-online-flor')" style="background:var(--tg-gold);color:#2b1705;border:none;padding:.5rem 1rem;border-radius:var(--r);font-weight:800;cursor:pointer;font-size:.8rem">Contra-Flor e o Resto</button>` : ''}
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}

function closeOnlineModal(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function showOnlineGameOver(isWin, data) {
  const html = `
    <div class="modal-overlay" id="m-online-gameover" style="display:flex">
      <div class="modal" style="max-width:380px;text-align:center">
        <div style="font-size:3rem;margin-bottom:.5rem">${isWin ? '🏆' : '😔'}</div>
        <div style="font-size:1.3rem;font-weight:700;margin-bottom:.3rem;color:${isWin ? 'var(--tg-green)' : 'var(--tg-red)'}">${isWin ? 'Vitória!' : 'Derrota'}</div>
        <div style="font-size:1.5rem;font-weight:900;margin:.5rem 0">${data.score.p1} × ${data.score.p2}</div>
        ${data.isWalkover ? '<div style="font-size:.7rem;color:var(--txt3)">Adversário desconectou (W.O.)</div>' : ''}
        <div style="display:flex;gap:.5rem;justify-content:center;margin-top:1rem">
          <button onclick="closeOnlineModal('m-online-gameover');show('online-lobby')" style="background:var(--tg-gold);color:#000;border:none;padding:.5rem 1.2rem;border-radius:var(--r);font-weight:700;cursor:pointer;font-size:.85rem">Voltar ao Lobby</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}

// ── Chat ──
function appendOnlineChat(name, msg, isMine) {
  const chatEl = document.getElementById('og-chat-area');
  if (!chatEl) return;
  const div = document.createElement('div');
  div.className = 'chat-msg ' + (isMine ? 'mine' : 'theirs');
  div.textContent = isMine ? msg : `${name}: ${msg}`;
  chatEl.appendChild(div);
  chatEl.scrollTop = chatEl.scrollHeight;
}

function sendOnlineChat() {
  const inp = document.getElementById('og-chat-input');
  if (!inp || !inp.value.trim() || !sio) return;
  const msg = inp.value.trim();
  sio.emit('chat_msg', { msg });
  appendOnlineChat(sioMyName, msg, true);
  inp.value = '';
}

// Multiplayer online (Socket.io) carregado

// ── Chat Rápido Gaúcho ──
const QUICK_PHRASES = [
  '🤠 Bah, que carta!',
  '👊 Truco neles!',
  '🤷 Tô de boa...',
  '😂 Que sorte!',
  '🤝 Boa partida!',
];
function sendQuickChat(phraseId) {
  if (!sio) return;
  sio.emit('quick_chat', { phraseId });
  // Exibir no meu chat também
  appendOnlineChat(sioMyName, QUICK_PHRASES[phraseId], true);
  showQuickChatBubble(QUICK_PHRASES[phraseId], true);
}
function showQuickChatBubble(text, isMine) {
  const existing = document.getElementById('qc-bubble');
  if (existing) existing.remove();
  const bubble = document.createElement('div');
  bubble.id = 'qc-bubble';
  bubble.textContent = text;
  const side = isMine ? 'right:1rem' : 'left:1rem';
  bubble.style.cssText = [
    'position:absolute', 'bottom:180px', side,
    'background:linear-gradient(135deg,#7c3f00,#b8860b)', 'color:#ffe082',
    'padding:.4rem .9rem', 'border-radius:1.2rem', 'font-size:.78rem',
    'font-weight:700', 'box-shadow:0 3px 12px rgba(0,0,0,.4)',
    'z-index:200', 'max-width:70%', 'word-break:break-word',
    'animation:qcBubblePop .3s cubic-bezier(.34,1.56,.64,1)',
    'pointer-events:none'
  ].join(';');
  const gameEl = document.getElementById('online-game');
  if (gameEl) gameEl.appendChild(bubble);
  setTimeout(() => {
    bubble.style.transition = 'opacity .4s';
    bubble.style.opacity = '0';
    setTimeout(() => bubble.remove(), 450);
  }, 2800);
}
// Adicionar CSS para animação do bubble
(function() {
  const style = document.createElement('style');
  style.textContent = '@keyframes qcBubblePop { from { transform: scale(.7); opacity:0; } to { transform: scale(1); opacity:1; } }';
  document.head.appendChild(style);
})();

// Handler de quick_chat registrado dentro de ensureSocket()

// ═══════════════════════════════════════════════════════════════
// ADMIN PANEL — Sponsors, Stats, Users
// ═══════════════════════════════════════════════════════════════

var _adminUsersPage = 0;
var _adminDeleteUserId = null;

// Show admin button if user is admin
function checkAdminAccess() {
  const user = window.localUser || (typeof AUTH !== 'undefined' ? AUTH.user : null);
  if (!user) { if (typeof window.stopRulesFailureMonitor === 'function') window.stopRulesFailureMonitor(); return; }
  const btn = document.getElementById('admin-btn');
  if (!btn) return;
  // Verifica role=admin OU email do admin principal
  const isAdmin = user.role === 'admin' || (user.email && user.email.toLowerCase() === 'gerentewilliam.pinheiro@gmail.com');
  btn.style.display = isAdmin ? '' : 'none';
  let rulesBtn = document.getElementById('rules-tests-btn');
  if (isAdmin && !rulesBtn) {
    rulesBtn = document.createElement('button');
    rulesBtn.id = 'rules-tests-btn';
    rulesBtn.className = 'hfb';
    rulesBtn.style.cssText = 'background:#246e5e;color:#fff;border-color:#62bda8';
    rulesBtn.textContent = '🧪 Testes';
    rulesBtn.onclick = () => { show('rules-tests-scr'); loadRulesTestReport(); };
    btn.insertAdjacentElement('afterend', rulesBtn);
  }
  if (rulesBtn) rulesBtn.style.display = isAdmin ? '' : 'none';
  if (isAdmin && typeof window.startRulesFailureMonitor === 'function') window.startRulesFailureMonitor();
  else if (!isAdmin && typeof window.stopRulesFailureMonitor === 'function') window.stopRulesFailureMonitor();
}

// Switch admin tabs
let _monitoringAutoInterval = null;

function switchAdminTab(tab, btn) {
  ['sponsors','stats','users','metrics','monitoring'].forEach(t => {
    const el = document.getElementById('admin-tab-' + t);
    if (el) el.style.display = t === tab ? '' : 'none';
  });
  document.querySelectorAll('.admin-tab').forEach(b => {
    b.style.background = 'transparent';
    b.style.color = '#aaa';
    b.style.borderColor = '#444';
  });
  if (btn) {
    btn.style.background = '#e94560';
    btn.style.color = '#fff';
    btn.style.borderColor = '#e94560';
  }
  if (tab === 'stats') loadAdminStats();
  if (tab === 'users') { _adminUsersPage = 0; loadAdminUsers(); }
  // Stop auto-refresh when leaving monitoring tab
  if (tab !== 'monitoring' && _monitoringAutoInterval) {
    clearInterval(_monitoringAutoInterval);
    _monitoringAutoInterval = null;
    const btn2 = document.getElementById('mon-auto-btn');
    if (btn2) { btn2.style.background = '#333'; btn2.style.color = '#aaa'; btn2.textContent = '▶ Auto'; }
  }
}

function toggleMonitoringAuto() {
  const btn = document.getElementById('mon-auto-btn');
  if (_monitoringAutoInterval) {
    clearInterval(_monitoringAutoInterval);
    _monitoringAutoInterval = null;
    if (btn) { btn.style.background = '#333'; btn.style.color = '#aaa'; btn.textContent = '▶ Auto'; }
    toast('Auto-refresh desligado', 'info');
  } else {
    _monitoringAutoInterval = setInterval(loadAdminMonitoring, 10000);
    if (btn) { btn.style.background = '#4ecdc4'; btn.style.color = '#000'; btn.textContent = '⏹ Auto (10s)'; }
    toast('Auto-refresh ligado — atualiza a cada 10s', 'info');
    loadAdminMonitoring();
  }
}

async function loadAdminMonitoring() {
  try {
    const data = await trpcQuery('admin.monitoring');
    const now = new Date();
    const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const lastEl = document.getElementById('mon-last-update');
    if (lastEl) lastEl.textContent = 'Atualizado: ' + timeStr;

    // Summary cards
    const roomsCount = document.getElementById('mon-rooms-count');
    const playersCount = document.getElementById('mon-players-count');
    const todayMatches = document.getElementById('mon-today-matches');
    const tournamentsCount = document.getElementById('mon-tournaments-count');
    if (roomsCount) roomsCount.textContent = (data.activeRooms || []).length;
    if (playersCount) playersCount.textContent = data.onlinePlayersCount || 0;
    if (todayMatches) todayMatches.textContent = data.todayOnlineMatches || 0;
    if (tournamentsCount) tournamentsCount.textContent = (data.activeTournaments || []).length;

    // Active rooms
    const roomsEl = document.getElementById('mon-rooms-list');
    if (roomsEl) {
      if (!data.activeRooms || data.activeRooms.length === 0) {
        roomsEl.innerHTML = '<div style="color:#555;text-align:center;padding:.8rem;font-size:.75rem">🌅 Nenhuma sala ativa no momento</div>';
      } else {
        roomsEl.innerHTML = data.activeRooms.map(r => {
          const isPlaying = r.status === 'playing';
          const statusDot = isPlaying ? '<span style="color:#e94560">●</span>' : '<span style="color:#4ecdc4">●</span>';
          const statusLabel = isPlaying ? 'Jogando' : 'Aguardando';
          const guestLabel = r.guestName || '<em style="color:#555">aguardando...</em>';
          const duration = r.updatedAt ? Math.round((Date.now() - new Date(r.updatedAt).getTime()) / 60000) : 0;
          return `<div style="display:flex;justify-content:space-between;align-items:center;padding:.45rem .6rem;background:#0f0f23;border-radius:6px;border:1px solid #222">
            <div style="flex:1;min-width:0">
              <div style="font-size:.78rem;font-weight:600;color:#fff">${r.hostName} <span style="color:#555">vs</span> ${guestLabel}</div>
              <div style="font-size:.6rem;color:#666;margin-top:.1rem">${statusDot} ${statusLabel} &middot; Sala <code style="color:#4ecdc4">${r.code}</code> &middot; ${r.mode.toUpperCase()}</div>
            </div>
            <div style="font-size:.6rem;color:#555;flex-shrink:0;margin-left:.5rem">${duration}min</div>
          </div>`;
        }).join('');
      }
    }

    // Active tournaments
    const tourEl = document.getElementById('mon-tournaments-list');
    if (tourEl) {
      if (!data.activeTournaments || data.activeTournaments.length === 0) {
        tourEl.innerHTML = '<div style="color:#555;text-align:center;padding:.8rem;font-size:.75rem">🏆 Nenhum torneio ativo</div>';
      } else {
        tourEl.innerHTML = data.activeTournaments.map(t => {
          const statusLabel = t.status === 'registering' ? '✅ Inscrevendo' : '🔴 Em andamento';
          const players = (t.players || []).filter(p => !p.eliminated).map(p => p.userName).join(', ');
          return `<div style="padding:.5rem .6rem;background:#0f0f23;border-radius:6px;border:1px solid #222">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div style="font-size:.78rem;font-weight:600;color:#a29bfe">${t.name}</div>
              <div style="font-size:.6rem;color:#888">${statusLabel}</div>
            </div>
            <div style="font-size:.62rem;color:#666;margin-top:.2rem">${t.currentPlayers}/${t.maxPlayers} jogadores &middot; Rodada ${t.currentRound + 1}/${t.totalRounds}</div>
            ${players ? `<div style="font-size:.58rem;color:#555;margin-top:.15rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">👥 ${players}</div>` : ''}
          </div>`;
        }).join('');
      }
    }

    // Recent online matches
    const matchesEl = document.getElementById('mon-matches-list');
    if (matchesEl) {
      if (!data.recentOnlineMatches || data.recentOnlineMatches.length === 0) {
        matchesEl.innerHTML = '<div style="color:#555;text-align:center;padding:.8rem;font-size:.75rem">🎮 Nenhuma partida online registrada ainda</div>';
      } else {
        matchesEl.innerHTML = data.recentOnlineMatches.map(m => {
          const date = new Date(m.playedAt);
          const timeStr2 = date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
          const dur = m.durationSeconds ? Math.round(m.durationSeconds / 60) + 'min' : '-';
          const wo = m.isWalkover ? ' 🚩WO' : '';
          const tourBadge = m.tournamentId ? ' 🏆' : '';
          return `<div style="display:flex;justify-content:space-between;align-items:center;padding:.4rem .6rem;background:#0f0f23;border-radius:6px;border:1px solid #222">
            <div style="flex:1;min-width:0">
              <div style="font-size:.75rem;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${m.player1Name} <span style="color:#e94560">${m.scoreP1}×${m.scoreP2}</span> ${m.player2Name}${wo}${tourBadge}</div>
              <div style="font-size:.6rem;color:#555;margin-top:.1rem">${timeStr2} &middot; ${m.mode.toUpperCase()} &middot; ${dur}</div>
            </div>
          </div>`;
        }).join('');
      }
    }
  } catch (e) {
    console.error('Admin monitoring error:', e);
    toast('Erro ao carregar monitor', 'error');
  }
}

// ─── SPONSORS ───
function escapeSponsorText(value) {
  return String(value == null ? '' : value).replace(/[&<>'"]/g, function(char) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char];
  });
}

function safeSponsorUrl(value, allowBlob) {
  try {
    const parsed = new URL(String(value || ''));
    return parsed.protocol === 'https:' || (allowBlob && parsed.protocol === 'blob:') ? parsed.href : '';
  } catch (_) {
    return '';
  }
}

async function loadAdminSponsors() {
  const list = document.getElementById('admin-sponsor-list');
  if (!list) return;
  list.innerHTML = '<div style="color:#666;text-align:center;padding:2rem">Carregando...</div>';
  try {
    const sponsors = await trpcQuery('sponsor.listAll');
    if (!sponsors || sponsors.length === 0) {
      list.innerHTML = '<div style="color:#666;text-align:center;padding:2rem">Nenhum patrocinador cadastrado.</div>';
      return;
    }
    list.innerHTML = sponsors.map(s => {
      const mediaUrl = safeSponsorUrl(s.mediaUrl);
      const name = escapeSponsorText(s.name);
      return `
      <div style="background:#1a1a2e;border:1px solid #333;border-radius:10px;padding:.8rem;display:flex;gap:.8rem;align-items:center">
        <div style="width:60px;height:60px;border-radius:8px;overflow:hidden;flex-shrink:0;background:#000">
          ${s.mediaType === 'video'
            ? `<video src="${mediaUrl}" style="width:100%;height:100%;object-fit:cover" muted></video>`
            : `<img src="${mediaUrl}" style="width:100%;height:100%;object-fit:cover" alt="${name}">`}
        </div>
        <div style="flex:1;min-width:0">
          <div style="color:#fff;font-weight:600;font-size:.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${name}</div>
          <div style="color:#888;font-size:.7rem">${s.position === 'top' ? 'Topo' : 'Rodap\u00e9'} \u2022 ${s.active ? '\u2705 Ativo' : '\u274c Inativo'} \u2022 ${s.slideDuration}s${s.dailyImpressionGoal > 0 ? ' \u2022 Meta: ' + s.dailyImpressionGoal.toLocaleString('pt-BR') + '/dia' : ''}${(() => { const t = new Date().toISOString().slice(0,10); if (s.startDate && s.startDate > t) return ' \u2022 \u23f3 Agendada (' + s.startDate + ')'; if (s.endDate && s.endDate < t) return ' \u2022 \u26d4 Encerrada (' + s.endDate + ')'; if (s.startDate || s.endDate) return ' \u2022 \ud83d\udfe2 ' + (s.startDate || '...') + ' a ' + (s.endDate || '...'); return ''; })()}</div>
        </div>
        <div style="display:flex;gap:.3rem">
          <button onclick="editSponsor(${s.id})" style="background:#333;color:#fff;border:none;padding:.4rem .6rem;border-radius:6px;cursor:pointer;font-size:.75rem">\u270f\ufe0f</button>
          <button onclick="adminDeleteSponsor(${s.id})" style="background:#ff4444;color:#fff;border:none;padding:.4rem .6rem;border-radius:6px;cursor:pointer;font-size:.75rem">\ud83d\uddd1\ufe0f</button>
        </div>
      </div>
    `;
    }).join('');
  } catch (e) {
    list.innerHTML = '<div style="color:#ff4444;text-align:center;padding:2rem">Erro ao carregar patrocinadores.</div>';
  }
}

var _editingSponsorId = null;

function openSponsorForm(sponsor) {
  _editingSponsorId = sponsor ? sponsor.id : null;
  document.getElementById('sf-title').textContent = sponsor ? 'Editar Patrocinador' : 'Novo Patrocinador';
  document.getElementById('sf-name').value = sponsor ? sponsor.name : '';
  document.getElementById('sf-link').value = sponsor ? (sponsor.linkUrl || '') : '';
  document.getElementById('sf-position').value = sponsor ? sponsor.position : 'bottom';
  document.getElementById('sf-duration').value = sponsor ? sponsor.slideDuration : 8;
  document.getElementById('sf-active').checked = sponsor ? !!sponsor.active : true;
  const orderEl = document.getElementById('sf-order');
  if (orderEl) orderEl.value = sponsor ? (sponsor.displayOrder || 0) : 0;
  const goalEl = document.getElementById('sf-goal');
  if (goalEl) goalEl.value = sponsor ? (sponsor.dailyImpressionGoal || 0) : 0;
  const startEl = document.getElementById('sf-start-date');
  if (startEl) startEl.value = sponsor ? (sponsor.startDate || '') : '';
  const endEl = document.getElementById('sf-end-date');
  if (endEl) endEl.value = sponsor ? (sponsor.endDate || '') : '';
  const mediaTypeEl = document.getElementById('sf-media-type');
  if (mediaTypeEl) mediaTypeEl.value = sponsor ? (sponsor.mediaType || 'image') : 'image';
  const preview = document.getElementById('sf-media-preview');
  const safeMediaUrl = sponsor ? safeSponsorUrl(sponsor.mediaUrl) : '';
  if (sponsor && safeMediaUrl) {
    preview.style.display = 'block';
    preview.innerHTML = '';
    const media = document.createElement(sponsor.mediaType === 'video' ? 'video' : 'img');
    media.src = safeMediaUrl;
    media.style.cssText = 'max-width:100%;max-height:120px';
    if (sponsor.mediaType === 'video') media.controls = true;
    preview.appendChild(media);
    preview.dataset.url = safeMediaUrl;
    preview.dataset.type = sponsor.mediaType;
  } else {
    preview.style.display = 'none';
    preview.innerHTML = '';
    preview.dataset.url = '';
    preview.dataset.type = 'image';
  }
  const errEl = document.getElementById('sf-error');
  if (errEl) errEl.style.display = 'none';
  // Atualizar preview ao vivo do banner
  if (sponsor && safeMediaUrl) {
    updateBannerPreview(safeMediaUrl, sponsor.mediaType || 'image');
  } else {
    var ph = document.getElementById('sf-preview-placeholder');
    var pc = document.getElementById('sf-preview-content');
    var pl = document.getElementById('sf-preview-label');
    if (ph) ph.style.display = '';
    if (pc) { pc.style.display = 'none'; pc.innerHTML = ''; }
    if (pl) pl.style.display = 'none';
  }
  openModal('m-sponsor-form');
}

async function editSponsor(id) {
  try {
    const sponsor = await trpcQuery('sponsor.getById', { id });
    if (sponsor) openSponsorForm(sponsor);
  } catch (e) {
    toast('Erro ao carregar patrocinador', 'error');
  }
}

// Preview sponsor media before upload
function previewSponsorMedia(input) {
  const file = input.files[0];
  if (!file) return;
  const preview = document.getElementById('sf-media-preview');
  const isVideo = file.type.startsWith('video/');
  const mediaTypeEl = document.getElementById('sf-media-type');
  if (mediaTypeEl) mediaTypeEl.value = isVideo ? 'video' : 'image';
  preview.style.display = 'block';
  const url = URL.createObjectURL(file);
  preview.innerHTML = isVideo
    ? `<video src="${url}" style="max-width:100%;max-height:120px" controls></video>`
    : `<img src="${url}" style="max-width:100%;max-height:120px">`;
  preview.dataset.pendingFile = 'true';
  // Atualizar preview ao vivo do banner
  updateBannerPreview(url, isVideo ? 'video' : 'image');
}
function updateBannerPreview(mediaUrl, mediaType) {
  var placeholder = document.getElementById('sf-preview-placeholder');
  var content = document.getElementById('sf-preview-content');
  var label = document.getElementById('sf-preview-label');
  if (!content) return;
  const safeMediaUrl = safeSponsorUrl(mediaUrl, String(mediaUrl || '').startsWith('blob:'));
  if (!safeMediaUrl) {
    if (placeholder) placeholder.style.display = '';
    content.style.display = 'none';
    content.innerHTML = '';
    if (label) label.style.display = 'none';
    return;
  }
  if (placeholder) placeholder.style.display = 'none';
  content.style.display = 'block';
  if (label) label.style.display = 'block';
  content.innerHTML = '';
  const media = document.createElement(mediaType === 'video' ? 'video' : 'img');
  media.src = safeMediaUrl;
  media.style.cssText = 'max-height:48px;max-width:80%;object-fit:contain;border-radius:4px';
  if (mediaType === 'video') {
    media.autoplay = true;
    media.muted = true;
    media.loop = true;
  }
  content.appendChild(media);
}

// Upload sponsor media to S3
async function uploadSponsorMedia() {
  const input = document.getElementById('sf-media-file');
  const file = input.files[0];
  if (!file) return null;
  const reader = new FileReader();
  return new Promise((resolve, reject) => {
    reader.onload = async function() {
      try {
        const base64 = reader.result.split(',')[1];
        const result = await trpcMutation('sponsor.uploadMedia', {
          fileName: file.name,
          fileData: base64,
          contentType: file.type
        });
        resolve(result.url);
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function saveSponsor() {
  const name = document.getElementById('sf-name').value.trim();
  const preview = document.getElementById('sf-media-preview');
  let mediaUrl = preview.dataset.url || '';
  const mediaType = document.getElementById('sf-media-type').value || 'image';
  const linkUrl = document.getElementById('sf-link').value.trim() || null;
  const position = document.getElementById('sf-position').value;
  const slideDuration = parseInt(document.getElementById('sf-duration').value) || 8;
  const active = document.getElementById('sf-active').checked ? 1 : 0;
  const displayOrder = parseInt(document.getElementById('sf-order').value) || 0;
  const dailyImpressionGoal = parseInt(document.getElementById('sf-goal').value) || 0;
  const startDate = document.getElementById('sf-start-date').value || null;
  const endDate = document.getElementById('sf-end-date').value || null;
  const errEl = document.getElementById('sf-error');

  if (!name) { if(errEl){errEl.textContent='Nome \u00e9 obrigat\u00f3rio';errEl.style.display='';} return; }

  const submitBtn = document.getElementById('sf-submit');
  submitBtn.textContent = 'Salvando...';
  submitBtn.disabled = true;

  try {
    // Upload file if pending
    const fileInput = document.getElementById('sf-media-file');
    if (fileInput.files[0]) {
      mediaUrl = await uploadSponsorMedia();
    }
    if (!mediaUrl) { if(errEl){errEl.textContent='Envie uma imagem ou v\u00eddeo';errEl.style.display='';} submitBtn.textContent='Salvar';submitBtn.disabled=false; return; }

    if (_editingSponsorId) {
      await trpcMutation('sponsor.update', { id: _editingSponsorId, name, mediaUrl, mediaType, linkUrl, position, slideDuration, active, displayOrder, dailyImpressionGoal, startDate, endDate });
      toast('Patrocinador atualizado!', 'success');
    } else {
      await trpcMutation('sponsor.create', { name, mediaUrl, mediaType, linkUrl, position, slideDuration, active, displayOrder, dailyImpressionGoal, startDate, endDate });
      toast('Patrocinador criado!', 'success');
    }
    closeModal('m-sponsor-form');
    loadAdminSponsors();
  } catch (e) {
    toast('Erro ao salvar: ' + (e.message || e), 'error');
    if(errEl){errEl.textContent='Erro: '+(e.message||e);errEl.style.display='';}
  } finally {
    submitBtn.textContent = 'Salvar';
    submitBtn.disabled = false;
  }
}

function closeSponsorForm() {
  closeModal('m-sponsor-form');
}

async function adminDeleteSponsor(id) {
  if (!confirm('Excluir este patrocinador?')) return;
  try {
    await trpcMutation('sponsor.delete', { id });
    toast('Patrocinador exclu\u00eddo', 'success');
    loadAdminSponsors();
  } catch (e) {
    toast('Erro ao excluir', 'error');
  }
}

// ─── STATS ───
async function loadAdminStats() {
  try {
    const stats = await trpcQuery('admin.matchStats');
    document.getElementById('as-daily').textContent = stats.daily.toLocaleString();
    document.getElementById('as-weekly').textContent = stats.weekly.toLocaleString();
    document.getElementById('as-monthly').textContent = stats.monthly.toLocaleString();
    document.getElementById('as-total').textContent = stats.total.toLocaleString();

    // Render chart
    const chartEl = document.getElementById('as-chart');
    if (stats.dailyChart && stats.dailyChart.length > 0) {
      const maxCount = Math.max(...stats.dailyChart.map(d => d.count), 1);
      chartEl.innerHTML = stats.dailyChart.map(d => {
        const h = Math.max(4, (d.count / maxCount) * 90);
        const dayLabel = d.day.slice(5); // MM-DD
        return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px">
          <div style="color:#888;font-size:.55rem">${d.count}</div>
          <div style="width:100%;height:${h}px;background:linear-gradient(180deg,#e94560,#c23152);border-radius:3px 3px 0 0;min-width:8px"></div>
          <div style="color:#666;font-size:.5rem;transform:rotate(-45deg);white-space:nowrap">${dayLabel}</div>
        </div>`;
      }).join('');
    } else {
      chartEl.innerHTML = '<div style="color:#666;text-align:center;width:100%;padding:2rem">Sem dados</div>';
    }

    // Top players
    const topPlayers = await trpcQuery('admin.topPlayers', { limit: 10 });
    const topEl = document.getElementById('as-top-players');
    if (topPlayers && topPlayers.length > 0) {
      topEl.innerHTML = topPlayers.map((p, i) => {
        const medal = i === 0 ? '\ud83e\udd47' : i === 1 ? '\ud83e\udd48' : i === 2 ? '\ud83e\udd49' : `${i+1}.`;
        const winRate = p.winRate != null ? p.winRate + '%' : '-';
        return `<div style="display:flex;align-items:center;gap:.5rem;padding:.4rem .5rem;background:${i<3?'#1e1e3a':'transparent'};border-radius:6px">
          <span style="font-size:.9rem;min-width:24px">${medal}</span>
          <div style="flex:1;min-width:0">
            <div style="color:#fff;font-size:.8rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.name || p.email || 'An\u00f4nimo'}</div>
            <div style="color:#888;font-size:.65rem">${p.email || ''} ${p.city ? '\u2022 ' + p.city : ''}</div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="color:#4ecdc4;font-size:.8rem;font-weight:700">${Number(p.totalMatches).toLocaleString()}</div>
            <div style="color:#888;font-size:.6rem">${Number(p.wins)}V ${Number(p.losses)}D \u2022 ${winRate}</div>
          </div>
        </div>`;
      }).join('');
    } else {
      topEl.innerHTML = '<div style="color:#666;text-align:center;padding:1rem">Nenhum jogador encontrado</div>';
    }
  } catch (e) {
    console.error('Admin stats error:', e);
    toast('Erro ao carregar estat\u00edsticas', 'error');
  }
}

// ─── USERS ───
async function loadAdminUsers() {
  const listEl = document.getElementById('au-list');
  const countEl = document.getElementById('au-count');
  const pagEl = document.getElementById('au-pagination');
  listEl.innerHTML = '<div style="color:#666;text-align:center;padding:2rem">Carregando...</div>';
  try {
    const limit = 20;
    const result = await trpcQuery('admin.listUsers', { limit, offset: _adminUsersPage * limit });
    const users = result.users || [];
    const total = result.total || 0;
    countEl.textContent = `${total} usu\u00e1rio(s) cadastrado(s)`;
    if (users.length === 0) {
      listEl.innerHTML = '<div style="color:#666;text-align:center;padding:2rem">Nenhum usu\u00e1rio encontrado.</div>';
      pagEl.innerHTML = '';
      return;
    }
    listEl.innerHTML = users.map(u => renderAdminUserCard(u)).join('');
    // Pagination
    const totalPages = Math.ceil(total / limit);
    if (totalPages > 1) {
      let pag = '';
      for (let i = 0; i < totalPages && i < 10; i++) {
        const active = i === _adminUsersPage;
        pag += `<button onclick="_adminUsersPage=${i};loadAdminUsers()" style="padding:.3rem .6rem;border-radius:6px;border:1px solid ${active?'#e94560':'#444'};background:${active?'#e94560':'transparent'};color:${active?'#fff':'#aaa'};cursor:pointer;font-family:inherit;font-size:.75rem">${i+1}</button>`;
      }
      pagEl.innerHTML = pag;
    } else {
      pagEl.innerHTML = '';
    }
  } catch (e) {
    listEl.innerHTML = '<div style="color:#ff4444;text-align:center;padding:2rem">Erro ao carregar usu\u00e1rios.</div>';
    console.error('Admin users error:', e);
  }
}

async function adminSearchUsers() {
  const query = document.getElementById('au-search').value.trim();
  if (!query) { _adminUsersPage = 0; loadAdminUsers(); return; }
  const listEl = document.getElementById('au-list');
  const countEl = document.getElementById('au-count');
  const pagEl = document.getElementById('au-pagination');
  listEl.innerHTML = '<div style="color:#666;text-align:center;padding:2rem">Buscando...</div>';
  try {
    const users = await trpcQuery('admin.searchUsers', { query });
    countEl.textContent = `${users.length} resultado(s) para "${query}"`;
    pagEl.innerHTML = '';
    if (users.length === 0) {
      listEl.innerHTML = '<div style="color:#666;text-align:center;padding:2rem">Nenhum usu\u00e1rio encontrado.</div>';
      return;
    }
    listEl.innerHTML = users.map(u => renderAdminUserCard(u)).join('');
  } catch (e) {
    listEl.innerHTML = '<div style="color:#ff4444;text-align:center;padding:2rem">Erro na busca.</div>';
  }
}

function renderAdminUserCard(u) {
  const created = u.createdAt ? new Date(u.createdAt).toLocaleDateString('pt-BR') : '-';
  const lastLogin = u.lastSignedIn ? new Date(u.lastSignedIn).toLocaleDateString('pt-BR') : '-';
  const matches = Number(u.totalMatches || 0);
  const wins = Number(u.wins || 0);
  const losses = Number(u.losses || 0);
  const isAdmin = u.role === 'admin';
  return `<div style="background:#1a1a2e;border:1px solid ${isAdmin?'#e94560':'#333'};border-radius:10px;padding:.7rem;display:flex;gap:.6rem;align-items:center">
    <div style="width:36px;height:36px;border-radius:50%;background:${isAdmin?'#e94560':'#333'};display:flex;align-items:center;justify-content:center;flex-shrink:0">
      <span style="color:#fff;font-size:.8rem;font-weight:700">${(u.name || '?')[0].toUpperCase()}</span>
    </div>
    <div style="flex:1;min-width:0">
      <div style="color:#fff;font-size:.8rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${u.name || 'Sem nome'} ${isAdmin?'<span style="color:#e94560;font-size:.65rem">(ADMIN)</span>':''}</div>
      <div style="color:#888;font-size:.7rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${u.email || '-'}</div>
      <div style="color:#666;font-size:.6rem;margin-top:.15rem">${u.city||''} ${u.state?'\u2022 '+u.state:''} \u2022 Desde ${created} \u2022 \u00daltimo: ${lastLogin}</div>
      <div style="color:#4ecdc4;font-size:.65rem">${matches} partidas \u2022 ${wins}V ${losses}D</div>
    </div>
    ${!isAdmin ? `<button onclick="promptDeleteUser(${u.id},'${(u.name||'').replace(/'/g,"\\'")  }','${(u.email||'').replace(/'/g,"\\'")}')" style="background:#ff4444;color:#fff;border:none;padding:.35rem .5rem;border-radius:6px;cursor:pointer;font-size:.65rem;flex-shrink:0">Excluir</button>` : ''}
  </div>`;
}

function promptDeleteUser(id, name, email) {
  _adminDeleteUserId = id;
  document.getElementById('du-name').textContent = name || 'Sem nome';
  document.getElementById('du-email').textContent = email || '-';
  openModal('m-delete-user');
}

async function confirmDeleteUser() {
  if (!_adminDeleteUserId) return;
  const btn = document.getElementById('du-confirm');
  btn.textContent = 'Excluindo...';
  btn.disabled = true;
  try {
    await trpcMutation('admin.deleteUser', { userId: _adminDeleteUserId });
    toast('Usu\u00e1rio exclu\u00eddo com sucesso', 'success');
    closeModal('m-delete-user');
    _adminDeleteUserId = null;
    // Refresh current view
    const searchVal = document.getElementById('au-search').value.trim();
    if (searchVal) adminSearchUsers(); else loadAdminUsers();
  } catch (e) {
    toast('Erro: ' + (e.message || e), 'error');
  } finally {
    btn.textContent = 'Excluir';
    btn.disabled = false;
  }
}
// ─── SPONSOR METRICS ────
var _metricsData = []; // stored for CSV export
var _metricsChartInstance = null;
async function loadSponsorMetrics() {
  const tbody = document.getElementById('met-tbody');
  const summary = document.getElementById('met-summary');
  if (!tbody || !summary) return;
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:#666">Carregando...</td></tr>';
  summary.innerHTML = '';
  try {
    const fromDate = document.getElementById('met-from')?.value || undefined;
    const toDate = document.getElementById('met-to')?.value || undefined;
    const params = {};
    if (fromDate) params.fromDate = fromDate;
    if (toDate) params.toDate = toDate;
    const [metrics, allSponsors] = await Promise.all([
      trpcQuery('sponsor.metrics', Object.keys(params).length ? params : undefined),
      trpcQuery('sponsor.listAll')
    ]);
    const map = {};
    allSponsors.forEach(s => { map[s.id] = { id: s.id, name: s.name, active: s.active, impressions: 0, clicks: 0 }; });
    metrics.forEach(m => {
      if (!map[m.sponsorId]) map[m.sponsorId] = { id: m.sponsorId, name: 'ID ' + m.sponsorId, active: 0, impressions: 0, clicks: 0 };
      if (m.eventType === 'impression') map[m.sponsorId].impressions = Number(m.total);
      if (m.eventType === 'click') map[m.sponsorId].clicks = Number(m.total);
    });
    let totalImpressions = 0, totalClicks = 0;
    Object.values(map).forEach(v => { totalImpressions += v.impressions; totalClicks += v.clicks; });
    const totalCTR = totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) : '0.00';
    summary.innerHTML = `
      <div style="background:#1a1a2e;border:1px solid #333;border-radius:10px;padding:.8rem;text-align:center">
        <div style="color:#888;font-size:.7rem;margin-bottom:.3rem">Total Impress\u00f5es</div>
        <div style="color:#00d4ff;font-size:1.4rem;font-weight:700">${totalImpressions.toLocaleString('pt-BR')}</div>
      </div>
      <div style="background:#1a1a2e;border:1px solid #333;border-radius:10px;padding:.8rem;text-align:center">
        <div style="color:#888;font-size:.7rem;margin-bottom:.3rem">Total Cliques</div>
        <div style="color:#4ecdc4;font-size:1.4rem;font-weight:700">${totalClicks.toLocaleString('pt-BR')}</div>
      </div>
      <div style="background:#1a1a2e;border:1px solid #333;border-radius:10px;padding:.8rem;text-align:center">
        <div style="color:#888;font-size:.7rem;margin-bottom:.3rem">CTR M\u00e9dio</div>
        <div style="color:#e94560;font-size:1.4rem;font-weight:700">${totalCTR}%</div>
      </div>
      <div style="background:#1a1a2e;border:1px solid #333;border-radius:10px;padding:.8rem;text-align:center">
        <div style="color:#888;font-size:.7rem;margin-bottom:.3rem">Patrocinadores</div>
        <div style="color:#fff;font-size:1.4rem;font-weight:700">${allSponsors.length}</div>
      </div>
    `;
    const ids = Object.keys(map).sort((a,b) => map[b].impressions - map[a].impressions);
    _metricsData = ids.map(id => map[id]);
    if (ids.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:#666">Nenhum patrocinador cadastrado</td></tr>';
      return;
    }
    tbody.innerHTML = ids.map(id => {
      const s = map[id];
      const ctr = s.impressions > 0 ? ((s.clicks / s.impressions) * 100).toFixed(2) : '0.00';
      const statusColor = s.active ? '#4ecdc4' : '#666';
      const statusText = s.active ? 'Ativo' : 'Inativo';
      return `<tr style="border-bottom:1px solid #222">
        <td style="padding:.5rem;color:#fff">${s.name}</td>
        <td style="padding:.5rem;color:#00d4ff;text-align:right">${s.impressions.toLocaleString('pt-BR')}</td>
        <td style="padding:.5rem;color:#4ecdc4;text-align:right">${s.clicks.toLocaleString('pt-BR')}</td>
        <td style="padding:.5rem;color:#e94560;text-align:right;font-weight:600">${ctr}%</td>
        <td style="padding:.5rem;text-align:center"><span style="background:${statusColor}22;color:${statusColor};padding:.2rem .5rem;border-radius:4px;font-size:.7rem;font-weight:600">${statusText}</span></td>
        <td style="padding:.5rem;text-align:center"><button onclick="showDailyChart(${s.id},'${s.name.replace(/'/g,"\\'")}')" style="background:#00d4ff22;color:#00d4ff;border:1px solid #00d4ff44;padding:.2rem .5rem;border-radius:4px;cursor:pointer;font-size:.7rem">\ud83d\udcc8 Gr\u00e1fico</button></td>
      </tr>`;
    }).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:#ff4444">Erro: ' + (e.message || e) + '</td></tr>';
  }
}

// Export metrics as CSV
function exportMetricsCSV() {
  if (!_metricsData || _metricsData.length === 0) {
    toast('Nenhum dado para exportar', 'warn');
    return;
  }
  const header = 'Patrocinador;Impress\u00f5es;Cliques;CTR (%);Status';
  const rows = _metricsData.map(s => {
    const ctr = s.impressions > 0 ? ((s.clicks / s.impressions) * 100).toFixed(2) : '0.00';
    return `${s.name};${s.impressions};${s.clicks};${ctr};${s.active ? 'Ativo' : 'Inativo'}`;
  });
  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const today = new Date().toISOString().slice(0,10);
  a.download = `metricas-patrocinadores-${today}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('CSV exportado!', 'success');
}

// Show daily chart for a specific sponsor
async function showDailyChart(sponsorId, sponsorName) {
  const area = document.getElementById('met-chart-area');
  const canvas = document.getElementById('met-chart-canvas');
  const title = document.getElementById('met-chart-title');
  if (!area || !canvas) return;
  area.style.display = 'block';
  title.textContent = 'Evolu\u00e7\u00e3o Di\u00e1ria \u2014 ' + sponsorName;
  // Load Chart.js if not loaded
  if (typeof Chart === 'undefined') {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  // Destroy previous chart
  if (_metricsChartInstance) {
    _metricsChartInstance.destroy();
    _metricsChartInstance = null;
  }
  try {
    const fromDate = document.getElementById('met-from')?.value || undefined;
    const toDate = document.getElementById('met-to')?.value || undefined;
    const params = { sponsorId };
    if (fromDate) params.fromDate = fromDate;
    if (toDate) params.toDate = toDate;
    const daily = await trpcQuery('sponsor.dailyMetrics', params);
    // Build date map
    const dateMap = {};
    daily.forEach(d => {
      if (!dateMap[d.eventDate]) dateMap[d.eventDate] = { impressions: 0, clicks: 0 };
      if (d.eventType === 'impression') dateMap[d.eventDate].impressions = d.count;
      if (d.eventType === 'click') dateMap[d.eventDate].clicks = d.count;
    });
    const dates = Object.keys(dateMap).sort();
    if (dates.length === 0) {
      area.style.display = 'block';
      canvas.style.display = 'none';
      title.textContent = sponsorName + ' \u2014 Sem dados no per\u00edodo';
      return;
    }
    canvas.style.display = '';
    const labels = dates.map(d => d.slice(5)); // MM-DD
    const impData = dates.map(d => dateMap[d].impressions);
    const clickData = dates.map(d => dateMap[d].clicks);
    const ctx = canvas.getContext('2d');
    _metricsChartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Impress\u00f5es', data: impData, backgroundColor: '#00d4ff66', borderColor: '#00d4ff', borderWidth: 1 },
          { label: 'Cliques', data: clickData, backgroundColor: '#4ecdc466', borderColor: '#4ecdc4', borderWidth: 1 },
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { color: '#888', font: { size: 10 } }, grid: { color: '#222' } },
          y: { beginAtZero: true, ticks: { color: '#888', font: { size: 10 } }, grid: { color: '#222' } }
        },
        plugins: {
          legend: { labels: { color: '#ccc', font: { size: 11 } } }
        }
      }
    });
  } catch (e) {
    title.textContent = 'Erro: ' + (e.message || e);
  }
}
// Call checkAdminAccess on page load and after login
if (typeof window._origUpdateHomeCTA === 'undefined') {
  window._origUpdateHomeCTA = window.updateHomeCTA || function(){};
}
const _prevUpdateHomeCTA = window.updateHomeCTA;
window.updateHomeCTA = function() {
  if (_prevUpdateHomeCTA) _prevUpdateHomeCTA();
  checkAdminAccess();
};
/// Also check on DOMContentLoaded
document.addEventListener('DOMContentLoaded', function() {
  setTimeout(checkAdminAccess, 500);
});

// ═══════════════════════════════════════════════════════════════
// SPONSOR CAROUSEL — Rotativo nos jogos
// ═══════════════════════════════════════════════════════════════

var _sponsorsCache = null;
var _sponsorTimers = {};

// Track sponsor impression or click (fire-and-forget)
function trackSponsorEvent(sponsorId, eventType) {
  try {
    trpcMutation('sponsor.trackEvent', { sponsorId: sponsorId, eventType: eventType }).catch(function() {});
  } catch(e) { /* ignore */ }
}

async function loadSponsorsForGame() {
  try {
    if (!_sponsorsCache) {
      _sponsorsCache = await trpcQuery('sponsor.listActive');
    }
    return _sponsorsCache || [];
  } catch (e) {
    console.warn('Failed to load sponsors:', e);
    return [];
  }
}

function renderSponsorBanner(containerId, sponsors, position) {
  const container = document.getElementById(containerId);
  if (!container || !sponsors || sponsors.length === 0) {
    if (container) container.style.display = 'none';
    return;
  }

  // Filter by position
  const filtered = sponsors.filter(s => s.position === position);
  if (filtered.length === 0) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';
  let currentIndex = 0;

  function showSponsor(index) {
    const s = filtered[index];
    const linkUrl = safeSponsorUrl(s.linkUrl);
    const mediaUrl = safeSponsorUrl(s.mediaUrl);
    const name = escapeSponsorText(s.name);
    const linkStart = linkUrl ? `<a href="${linkUrl}" target="_blank" rel="noopener noreferrer" class="sponsor-slide" data-sponsor-id="${s.id}">` : `<div class="sponsor-slide" data-sponsor-id="${s.id}">`;
    const linkEnd = linkUrl ? '</a>' : '</div>';
    const mediaHtml = s.mediaType === 'video'
      ? `<video src="${mediaUrl}" autoplay muted loop playsinline style="max-height:48px;max-width:80%;object-fit:contain;border-radius:4px"></video>`
      : `<img src="${mediaUrl}" alt="${name}" style="max-height:48px;max-width:80%;object-fit:contain;border-radius:4px">`;
    container.innerHTML = `${linkStart}${mediaHtml}<span class="sponsor-label">Patrocínio</span>${linkEnd}`;
    // Track impression
    trackSponsorEvent(s.id, 'impression');
    // Track click
    const clickEl = container.querySelector('[data-sponsor-id]');
    if (clickEl) {
      clickEl.addEventListener('click', function() {
        trackSponsorEvent(s.id, 'click');
      });
    }
  }

  showSponsor(0);

  // Clear previous timer for this container
  if (_sponsorTimers[containerId]) {
    clearInterval(_sponsorTimers[containerId]);
  }

  // Rotate if multiple sponsors
  if (filtered.length > 1) {
    const duration = (filtered[0].slideDuration || 8) * 1000;
    _sponsorTimers[containerId] = setInterval(() => {
      currentIndex = (currentIndex + 1) % filtered.length;
      showSponsor(currentIndex);
    }, duration);
  }
}

function stopSponsorBanners() {
  Object.keys(_sponsorTimers).forEach(key => {
    clearInterval(_sponsorTimers[key]);
    delete _sponsorTimers[key];
  });
}

async function startSponsorBanners(context) {
  const sponsors = await loadSponsorsForGame();
  if (context === 'ai') {
    renderSponsorBanner('sponsor-banner-top', sponsors, 'top');
    renderSponsorBanner('sponsor-banner-game-bottom', sponsors, 'bottom');
  } else if (context === 'online') {
    renderSponsorBanner('sponsor-banner-online-top', sponsors, 'top');
    renderSponsorBanner('sponsor-banner-online-bottom', sponsors, 'bottom');
  }
}

// Invalidate cache when admin updates sponsors
function invalidateSponsorCache() {
  _sponsorsCache = null;
}

// Hook into game start functions
(function() {
  // Hook into show() to detect when game screens are shown
  const _origShow = window.show;
  if (_origShow) {
    window.show = function(id) {
      _origShow(id);
      if (id === 'game') {
        startSponsorBanners('ai');
      } else if (id === 'online-game') {
        startSponsorBanners('online');
      } else {
        // Stop banners when leaving game screens
        stopSponsorBanners();
      }
    };
  }
})();


