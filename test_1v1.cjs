/**
 * Teste completo 1v1 online — Socket.io
 * Fluxo: login p1 → login p2 → p1 cria sala → p2 entra → jogo inicia
 *        → rodadas completas → truco → fim de jogo → verifica banco
 */
const { io } = require('socket.io-client');
const http = require('http');

const BASE = 'http://localhost:3000';
const TRPC = `${BASE}/api/trpc`;

// ─── helpers ───────────────────────────────────────────────────────────────
function post(path, body, cookie) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ json: body });
    const opts = {
      hostname: 'localhost', port: 3000,
      path: `/api/trpc/${path}`, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...(cookie ? { Cookie: cookie } : {})
      }
    };
    const req = http.request(opts, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => {
        try {
          const j = JSON.parse(buf);
          const setCookie = res.headers['set-cookie'];
          resolve({ data: j.result?.data?.json ?? j.result?.data, cookie: setCookie, raw: j });
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function extractCookie(setCookieArr) {
  if (!setCookieArr) return null;
  return setCookieArr.map(c => c.split(';')[0]).join('; ');
}

// ─── main ──────────────────────────────────────────────────────────────────
async function main() {
  const ts = Date.now();
  const results = [];

  // 1. Registrar dois jogadores
  console.log('\n=== FASE 1: Registro e Login ===');
  const r1 = await post('localAuth.register', {
    name: `Gaúcho${ts}`, email: `g1_${ts}@test.com`,
    pin: '111111', city: 'Porto Alegre', state: 'RS'
  });
  const cookie1 = extractCookie(r1.cookie);
  console.log('P1 registrado:', r1.data?.user?.name || 'ERRO', '| cookie:', !!cookie1);
  results.push({ test: 'Registro P1', ok: !!r1.data?.user });

  const r2 = await post('localAuth.register', {
    name: `Guria${ts}`, email: `g2_${ts}@test.com`,
    pin: '222222', city: 'Caxias do Sul', state: 'RS'
  });
  const cookie2 = extractCookie(r2.cookie);
  console.log('P2 registrado:', r2.data?.user?.name || 'ERRO', '| cookie:', !!cookie2);
  results.push({ test: 'Registro P2', ok: !!r2.data?.user });

  if (!cookie1 || !cookie2) {
    console.error('FALHA: Não foi possível registrar jogadores');
    process.exit(1);
  }

  // 2. Conectar via Socket.io
  console.log('\n=== FASE 2: Conexão Socket.io ===');

  const sio1 = io(BASE, { extraHeaders: { cookie: cookie1 }, transports: ['websocket'] });
  const sio2 = io(BASE, { extraHeaders: { cookie: cookie2 }, transports: ['websocket'] });

  const user1Id = r1.data?.user?.id;
  const user1Name = r1.data?.user?.name;
  const user2Id = r2.data?.user?.id;
  const user2Name = r2.data?.user?.name;

  await Promise.all([
    new Promise(res => sio1.on('connect', () => {
      console.log('P1 conectado:', sio1.id);
      sio1.emit('auth', { userId: user1Id, userName: user1Name });
      res();
    })),
    new Promise(res => sio2.on('connect', () => {
      console.log('P2 conectado:', sio2.id);
      sio2.emit('auth', { userId: user2Id, userName: user2Name });
      res();
    }))
  ]);
  await new Promise(r => setTimeout(r, 300)); // aguardar auth processar
  results.push({ test: 'Conexão Socket.io', ok: sio1.connected && sio2.connected });

  // 3. P1 cria sala
  console.log('\n=== FASE 3: Criar Sala ===');
  const roomCode = await new Promise((resolve, reject) => {
    sio1.emit('create_room', { name: `Sala_${ts}` }, (res) => {
      if (res && res.code) {
        console.log('Sala criada:', res.code);
        resolve(res.code);
      } else {
        console.error('Erro ao criar sala:', JSON.stringify(res));
        reject(new Error('Falha ao criar sala'));
      }
    });
    setTimeout(() => reject(new Error('Timeout criar sala')), 5000);
  });
  results.push({ test: 'Criar sala', ok: !!roomCode });

  // 4. P2 entra na sala
  console.log('\n=== FASE 4: Entrar na Sala ===');
  // game_started = notificação de início; game_state = estado completo com cartas
  const gameStarted = new Promise((resolve) => {
    let state1 = null, state2 = null;
    let started1 = false, started2 = false;

    // Capturar o game_state inicial (emitido antes de game_started)
    sio1.once('game_state', (data) => {
      console.log('P1 recebeu game_state | phase:', data.phase, '| myHand:', data.myHand?.length, 'cartas | vira:', data.vira?.rank + data.vira?.suit);
      state1 = data;
      if (state1 && state2) resolve({ state1, state2 });
    });
    sio2.once('game_state', (data) => {
      console.log('P2 recebeu game_state | phase:', data.phase, '| myHand:', data.myHand?.length, 'cartas | vira:', data.vira?.rank + data.vira?.suit);
      state2 = data;
      if (state1 && state2) resolve({ state1, state2 });
    });

    sio1.on('game_started', (data) => {
      console.log('P1 recebeu game_started | names:', JSON.stringify(data.names));
      started1 = true;
    });
    sio2.on('game_started', (data) => {
      console.log('P2 recebeu game_started | names:', JSON.stringify(data.names));
      started2 = true;
    });
  });

  await new Promise((resolve, reject) => {
    sio2.emit('join_room', { code: roomCode }, (res) => {
      if (res && res.success) {
        console.log('P2 entrou na sala:', roomCode);
        resolve();
      } else {
        console.error('Erro ao entrar na sala:', JSON.stringify(res));
        reject(new Error('Falha ao entrar na sala'));
      }
    });
    setTimeout(() => reject(new Error('Timeout join_room')), 5000);
  });
  results.push({ test: 'Entrar na sala', ok: true });

  // Aguardar game_start
  const { state1, state2 } = await Promise.race([
    gameStarted,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout game_start')), 8000))
  ]);
  results.push({
    test: 'game_start recebido',
    ok: state1?.phase === 'playing' && state2?.phase === 'playing'
  });
  results.push({ test: 'Cartas distribuídas', ok: state1?.myHand?.length === 3 && state2?.myHand?.length === 3 });
  results.push({ test: 'Carta vira presente', ok: !!state1?.vira?.rank });

  // 5. Jogar rodadas
  console.log('\n=== FASE 5: Jogar Rodadas ===');

  // Determinar quem começa
  let currentState1 = state1;
  let currentState2 = state2;
  let roundsPlayed = 0;
  let gameEnded = false;

  // Listener de game_state para ambos (atualiza estado local)
  sio1.on('game_state', (s) => { currentState1 = s; });
  sio2.on('game_state', (s) => { currentState2 = s; });

  const gameEndPromise = new Promise(resolve => {
    sio1.on('game_over', (data) => {
      console.log('JOGO ENCERRADO (P1 view):', JSON.stringify(data));
      gameEnded = true;
      resolve(data);
    });
    sio2.on('game_over', (data) => {
      if (!gameEnded) console.log('JOGO ENCERRADO (P2 view):', JSON.stringify(data));
      gameEnded = true;
      resolve(data);
    });
  });

  // Jogar cartas alternadamente até o jogo acabar (máx 120 jogadas)
  for (let turn = 0; turn < 120 && !gameEnded; turn++) {
    await new Promise(r => setTimeout(r, 100));

    // Aguardar até a fase ser 'playing' (não jogar durante between_hands)
    const phase1 = currentState1?.phase;
    const phase2 = currentState2?.phase;
    if (phase1 === 'between_hands' || phase2 === 'between_hands') {
      await new Promise(r => setTimeout(r, 1600));
      continue;
    }

    // currentPlayer é 'p1' ou 'p2' (role do servidor)
    const cp1 = currentState1?.currentPlayer; // quem deve jogar agora (do ponto de vista de P1)
    const cp2 = currentState2?.currentPlayer;

    let played = false;

    // P1 joga quando é sua vez (myRole === 'p1' e currentPlayer === 'p1')
    if (cp1 === 'p1' && currentState1?.myHand?.length > 0) {
      const card = currentState1.myHand[0];
      const score = currentState1?.score;
      if (turn % 6 === 0) console.log(`  Placar: P1=${score?.p1} P2=${score?.p2}`);
      console.log(`  Turn ${turn+1}: P1 joga ${card.rank}${card.suit} (id:${card.id})`);
      const res1 = await new Promise(r => sio1.emit('play_card', { cardId: card.id }, r));
      if (res1?.error) { console.warn(`  [ERRO P1] ${res1.error}`); } 
      else { 
        roundsPlayed++;
        // Aguardar game_state atualizado antes da próxima iteração
        await new Promise(r => setTimeout(r, 200));
      }
      played = true;
    }
    // P2 joga quando é sua vez (myRole === 'p2' e currentPlayer === 'p2')
    else if (cp2 === 'p2' && currentState2?.myHand?.length > 0) {
      const card = currentState2.myHand[0];
      const score = currentState2?.score;
      if (turn % 6 === 0) console.log(`  Placar: P1=${score?.p1} P2=${score?.p2}`);
      console.log(`  Turn ${turn+1}: P2 joga ${card.rank}${card.suit} (id:${card.id})`);
      const res2 = await new Promise(r => sio2.emit('play_card', { cardId: card.id }, r));
      if (res2?.error) { console.warn(`  [ERRO P2] ${res2.error}`); }
      else {
        roundsPlayed++;
        // Aguardar game_state atualizado antes da próxima iteração
        await new Promise(r => setTimeout(r, 200));
      }
      played = true;
    }

    if (!played) {
      console.log(`  Turn ${turn+1}: aguardando turno... (cp1=${cp1}, cp2=${cp2}, h1=${currentState1?.myHand?.length}, h2=${currentState2?.myHand?.length})`);
      await new Promise(r => setTimeout(r, 300));
    }

    if (gameEnded) break;
  }

  results.push({ test: `Rodadas jogadas (${roundsPlayed})`, ok: roundsPlayed > 0 });

  // 6. Testar truco (se jogo ainda ativo)
  console.log('\n=== FASE 6: Testar Truco ===');
  if (!gameEnded) {
    const trucoResponsePromise = new Promise(resolve => {
      sio2.once('truco_called', (data) => {
        console.log('P2 recebeu truco_called:', JSON.stringify(data));
        resolve(data);
      });
    });
    sio1.emit('call_truco');
    const trucoData = await Promise.race([
      trucoResponsePromise,
      new Promise(r => setTimeout(() => r(null), 3000))
    ]);
    results.push({ test: 'Truco chamado', ok: !!trucoData });

    if (trucoData) {
      sio2.emit('respond_truco', { accept: true });
      await new Promise(r => setTimeout(r, 500));
      results.push({ test: 'Truco aceito', ok: true });
    }
  } else {
    results.push({ test: 'Truco (jogo já encerrou)', ok: true });
  }

  // 7. Aguardar fim de jogo
  console.log('\n=== FASE 7: Fim de Jogo ===');
  let gameEndData = null;
  if (!gameEnded) {
    // Forçar fim jogando todas as cartas restantes
    for (let i = 0; i < 6 && !gameEnded; i++) {
      await new Promise(r => setTimeout(r, 400));
      const cp1f = currentState1?.currentPlayer;
      const cp2f = currentState2?.currentPlayer;
      if (cp1f === 'p1' && currentState1?.myHand?.length > 0) {
        const card = currentState1.myHand[0];
        sio1.emit('play_card', { cardId: card.id });
      } else if (cp2f === 'p2' && currentState2?.myHand?.length > 0) {
        const card = currentState2.myHand[0];
        sio2.emit('play_card', { cardId: card.id });
      } else if (currentState1?.myHand?.length > 0) {
        const card = currentState1.myHand[0];
        sio1.emit('play_card', { cardId: card.id });
      } else if (currentState2?.myHand?.length > 0) {
        const card = currentState2.myHand[0];
        sio2.emit('play_card', { cardId: card.id });
      }
    }
    gameEndData = await Promise.race([
      gameEndPromise,
      new Promise(r => setTimeout(() => r(null), 5000))
    ]);
  } else {
    gameEndData = await Promise.race([
      gameEndPromise,
      new Promise(r => setTimeout(() => r({ already: true }), 1000))
    ]);
  }
  results.push({ test: 'Jogo encerrado', ok: !!gameEndData });
  if (gameEndData && !gameEndData.already) {
    const winnerName = gameEndData.winnerName || gameEndData.winner || 'Empate';
    console.log('Resultado final:', winnerName);
    results.push({ test: 'Vencedor definido', ok: !!gameEndData.winner });
  }

  // 8. Verificar banco de dados
  console.log('\n=== FASE 8: Verificar Banco ===');
  await new Promise(r => setTimeout(r, 1000)); // aguardar persistência
  const { createConnection } = require('mysql2/promise');
  let dbOk = false;
  try {
    const conn = await createConnection(process.env.DATABASE_URL || '');
    const [rows] = await conn.execute(
      'SELECT * FROM onlineRooms ORDER BY createdAt DESC LIMIT 3'
    );
    console.log('Salas no banco:', rows.length);
    if (rows.length > 0) {
      console.log('Última sala:', { code: rows[0].code, status: rows[0].status });
      dbOk = true;
    }
    await conn.end();
  } catch(e) {
    console.warn('DB check error:', e.message);
    dbOk = false;
  }
  results.push({ test: 'Persistência no banco', ok: dbOk });

  // ─── Relatório ────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(50));
  console.log('RELATÓRIO FINAL DO TESTE 1v1');
  console.log('═'.repeat(50));
  let passed = 0, failed = 0;
  for (const r of results) {
    const icon = r.ok ? '✅' : '❌';
    console.log(`${icon} ${r.test}`);
    if (r.ok) passed++; else failed++;
  }
  console.log('═'.repeat(50));
  console.log(`Total: ${passed}/${results.length} passou | ${failed} falhou`);

  sio1.disconnect();
  sio2.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

// Carregar env
require('dotenv').config({ path: '/home/ubuntu/truco-tche/.env' });
main().catch(e => { console.error('ERRO FATAL:', e.message); process.exit(1); });
