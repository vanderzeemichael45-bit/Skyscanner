# Last-Minute Weekend Radar — Playwright v0.2

Dit is de tweede cloudtest van de Weekend Optimizer. De zoekregels zijn nog dezelfde als in de Tampermonkey-versie, maar v0.2 is vooral bedoeld om het verschil tussen je gewone browser en GitHub Actions zichtbaar te maken.

## Tampermonkey: Weekend Wegwijzer

Naast de Python/Playwright-radar bevat deze repository nu ook het afzonderlijke Tampermonkey-project in [`userscript/`](userscript/README.md):

- Stable `3.7.1` blijft de ongewijzigde, eerder gebruikte versie.
- Candidate `3.9.0` bevat daarnaast deur-tot-deurkosten, effectieve weekendtijd, progressieve resultaten en optioneel één overstap.
- Candidate heeft een eigen automatisch Tampermonkey-updatekanaal via GitHub.

Beide implementaties blijven bewust gescheiden: de Python-radar draait in GitHub Actions, terwijl Weekend Wegwijzer in je eigen browser op Skyscanner draait.

## Wat is nieuw in v0.2?

- Playwright start **Chromium in de nieuwe headless-modus** (`channel="chromium"`) in plaats van de aparte Chromium headless shell.
- GitHub installeert daarom de volledige Chromium-build met `--no-shell`.
- De console-uitvoer is ongebufferd, zodat je tijdens de run live voortgang ziet.
- Bij een pagina die niet goed laadt worden automatisch debugbestanden gemaakt:
  - een volledige screenshot (`.png`);
  - de HTML van de pagina (`.html`);
  - een tekstbestand met URL, paginatitel, aantallen van belangrijke selectors en een stuk van de zichtbare paginatekst (`.txt`).
- De workflow uploadt naast `weekend-radar-results` ook `weekend-radar-debug` wanneer er debugbestanden zijn.
- Een normale zichtbare cookieknop wordt indien nodig geaccepteerd; er wordt geen botdetectie omzeild.

## Zoekregels

De radar gebruikt dezelfde kernregels als het prototype:

- vertrek vanaf AMS, EIN, RTM en GRQ;
- vrijdag → maandag, vrijdag → zondag en zaterdag → maandag;
- op een normale vrijdag alleen vertrek vanaf 21:00;
- op de laatste vrijdag van de maand vervalt die tijdsgrens;
- ruime voorselectie tot €250;
- score op prijs, verblijfsduur, heen-/terugtijd en rechtstreeks;
- maximaal één winnaar per bestemming;
- de beste drie bestemmingen worden nogmaals langer geverifieerd.

## GitHub bijwerken

Vervang in je bestaande repository in ieder geval deze bestanden door de v0.2-versies:

- `radar.py`
- `.github/workflows/radar.yml`
- `README.md`

`requirements.txt` kan ongewijzigd blijven.

## Eerste v0.2-test

1. Open in GitHub **Actions → Weekend Radar**.
2. Kies **Run workflow**.
3. Laat `weekend_date` leeg voor het komende weekend.
4. Start de workflow.
5. Kijk bij **Radar draaien**. De voortgang hoort nu live te verschijnen.

Na afloop:

- `weekend-radar-results` bevat `results/latest.json`;
- als een pagina niet goed kon worden uitgelezen, verschijnt ook `weekend-radar-debug`.

Download bij een mislukte scan vooral het debug-artifact en kijk eerst naar de `.png`. Daarmee zien we letterlijk welke pagina GitHub/Chromium van Skyscanner heeft gekregen.

## Lokaal draaien

```bash
python -m pip install -r requirements.txt
python -m playwright install --with-deps --no-shell chromium
python radar.py
```

Een specifiek weekend:

```bash
python radar.py --date 2026-08-22
```
