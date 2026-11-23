"""Partidas de 24 pontos com uma sessão Chromium por participante.

Use uma aplicação local e um banco descartável. O teste cadastra dez jogadores.
Instale com 'python -m pip install playwright' e 'playwright install chromium'.
Execute 'python scripts/e2e-team-browser.py' com BASE_URL (padrão localhost:3000).
CHROMIUM_PATH permite usar um Chromium já instalado.
"""
import json
import os
import re
import time
import uuid

from playwright.sync_api import TimeoutError as PlaywrightTimeout, expect, sync_playwright


BASE = os.environ.get("BASE_URL", "http://localhost:3000").rstrip("/")
TIMEOUT = 15_000
VIEW = """() => {
    const s = window.sioGameState;
    if (!s?.isTeamGame) return null;
    return {room: s.roomCode, role: s.myRole, team: s.team, turn: s.turn,
            score: s.score, phase: s.phase, truco: s.trucoLevel, hand: s.myHand.map(c => c.id),
            cards: s.table.map(c => c.card.id), rounds: s.roundWins};
}"""


def open_player(browser, mode, seat, contexts, errors):
    context = browser.new_context(
        viewport={"width": 393, "height": 852}, is_mobile=True, has_touch=True,
        permissions=["clipboard-read", "clipboard-write"],
        extra_http_headers={"X-Forwarded-Proto": "https"},
    )
    contexts.append(context)
    response = context.request.post(BASE + "/api/trpc/localAuth.register", data={
        "json": {"name": f"Teste {mode} {seat}", "email": f"{uuid.uuid4().hex}@test.local",
                 "pin": "123456", "city": "Pelotas", "state": "RS"}
    })
    assert response.ok, f"Cadastro do assento {seat}: HTTP {response.status}"
    page = context.new_page()
    page.set_default_timeout(TIMEOUT)
    page.on("pageerror", lambda error: errors.add(f"p{seat}: {error}"))
    page.route("https://fonts.**", lambda route: route.abort())
    page.goto(BASE, wait_until="domcontentloaded")
    page.wait_for_function("window.localUser?.id && window.sioAuthenticated")
    page.get_by_role("button", name="Abrir Mesa Presencial").click()
    return page


def run_table(browser, count, contexts, errors):
    mode = "2v2" if count == 4 else "3v3"
    print(f"{mode} — cadastrando {count} jogadores", flush=True)
    pages = [open_player(browser, mode, seat, contexts, errors) for seat in range(1, count + 1)]
    host = pages[0]
    host.locator("#in-person-mode").select_option(mode)
    host.get_by_role("button", name="Criar Mesa Presencial").click()
    host.bring_to_front()
    host.get_by_role("button", name="Copiar convite").click()
    invite = host.evaluate("navigator.clipboard.readText()")
    room = json.loads(invite)["roomCode"]
    for seat, page in enumerate(pages[1:], 2):
        page.locator("#in-person-invite-input").fill(invite)
        page.locator('[onclick="joinInPersonFromInput()"]').click()
        if seat < count:
            expect(host.locator("#in-person-participants")).to_contain_text(f"{seat}/{count}")

    for seat, page in enumerate(pages, 1):
        expect(page.locator("#og-my-hand .hc:visible")).to_have_count(3, timeout=TIMEOUT)
        page.wait_for_function("Array.from(document.querySelectorAll('#og-team-seats .og-seat-card img')).some(img => img.naturalWidth > 0)")
        state = page.evaluate(VIEW)
        assert state and state["room"] == room and state["role"] == f"p{seat}"
        assert state["team"] == ("A" if seat % 2 else "B")
        expect(page.locator("#home-active-rooms")).to_be_hidden()
        expect(page.locator("#og-team-seats .og-seat:visible")).to_have_count(count)
        expect(page.locator(f"[data-seat='p{seat}'] .og-seat-label")).to_contain_text("Você")
        expect(page.locator("#og-team-seats .og-seat[aria-current=true]")).to_have_attribute("data-seat", "p1")
        expect(page.locator("#og-my-hand .card-caption:visible")).to_have_count(3)
        for locator in ("#og-team-board", "#og-my-hand"):
            assert page.locator(locator).evaluate("el => el.getBoundingClientRect().right <= innerWidth + 1 && el.getBoundingClientRect().left >= 0")

    print(f"{mode} — todos entraram por convite e receberam três cartas", flush=True)

    # Recuperação com uma carta já jogada e sem outro participante atuando.
    host.locator("#og-my-hand .hc:not(.dis)").first.click()
    last = pages[-1]
    last.wait_for_function("window.sioGameState?.table?.length === 1")
    before = last.evaluate(VIEW)
    print(f"{mode} — primeira carta recebida por p{count}, recarregando a página", flush=True)
    last.reload(wait_until="domcontentloaded")
    try:
        last.wait_for_function("window.sioGameState?.isTeamGame")
    except PlaywrightTimeout as error:
        raise AssertionError(f"p{count} não recuperou o estado de equipe em {TIMEOUT // 1000}s") from error
    assert last.evaluate(VIEW) == before, f"{mode}: estado diferente após recarregar p{count}"
    expect(last.locator("#online-game")).to_be_visible()
    expect(last.locator("#og-team-seats [data-seat=p1] .card-caption")).to_be_visible(timeout=TIMEOUT)
    expect(last.locator("#og-team-seats .og-seat[aria-current=true]")).to_have_attribute("data-seat", "p2")
    print(f"{mode} — assento p{count} recuperou mão, turno, placar e carta na mesa", flush=True)

    first_trick_checked = False
    deadline = time.monotonic() + 600
    while time.monotonic() < deadline:
        state = host.evaluate(VIEW)
        if state and state["phase"] == "game_over":
            expect(host.locator("#m-online-gameover")).to_be_visible(timeout=TIMEOUT)
            break
        if not state or state["phase"] != "playing":
            host.wait_for_timeout(50)
            continue
        actor = pages[int(state["turn"][1:]) - 1]
        if state["truco"] == 1:
            actor.locator("#og-actions .sb-truco").click()
            host.wait_for_function("sioGameState.phase === 'truco_neg'")
            responder = pages[int(host.evaluate(VIEW)["turn"][1:]) - 1]
            responder.locator("#m-online-truco").get_by_role("button", name="Aceitar").click()
            host.wait_for_function("sioGameState.phase === 'playing' && sioGameState.trucoLevel === 2")
        actor.locator("#og-my-hand .hc:not(.dis)").first.click()
        host.wait_for_function("prior => sioGameState.phase !== 'playing' || JSON.stringify(sioGameState.table.map(t => t.card.id)) !== JSON.stringify(prior)", arg=state["cards"])
        if not first_trick_checked and host.evaluate(VIEW)["rounds"]:
            expect(host.locator("#og-team-seats .og-seat-card.tc:visible")).to_have_count(count)
            expect(host.locator("#og-team-result")).to_contain_text("última vaza")
            winning_cards = 0 if host.evaluate(VIEW)["rounds"][-1] == "draw" else 1
            expect(host.locator("#og-team-seats .og-winning-card")).to_have_count(winning_cards)
            first_trick_checked = True
    else:
        raise AssertionError(f"{mode}: tempo esgotado antes de 24 pontos")

    final = host.evaluate(VIEW)
    assert first_trick_checked, "A primeira vaza deve aparecer nos assentos"
    assert final["phase"] == "game_over" and max(final["score"].values()) == 24
    winner = max(final["score"], key=final["score"].get)
    for page in pages:
        state = page.evaluate(VIEW)
        assert state["score"] == final["score"]
        modal = page.locator("#m-online-gameover")
        expect(modal).to_contain_text("Vitória" if state["team"] == winner else "Derrota")
        text = modal.inner_text()
        score = re.search(r"(\d+)\s*[×x]\s*(\d+)", text)
        assert score and sorted(map(int, score.groups())) == sorted(final["score"].values()), text
    assert not errors, "Exceções JavaScript durante a partida"
    print(f"{mode} — resultado confirmado pelos {count} jogadores: {final['score']}", flush=True)


if __name__ == "__main__":
    failed = False
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=os.getenv("CHROMIUM_PATH"))
        for count in (4, 6):
            contexts, errors = [], set()
            try:
                run_table(browser, count, contexts, errors)
            except Exception as exc:
                failed = True
                print(f"{count} assentos — FALHOU: {exc}", flush=True)
                for error in sorted(errors):
                    print("  " + error)
            finally:
                for context in contexts:
                    context.close()
        browser.close()
    raise SystemExit(int(failed))
