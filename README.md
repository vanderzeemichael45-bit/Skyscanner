# Last-Minute Weekend Radar — Playwright prototype

Dit is de eerste cloud-versie van de Weekend Optimizer. Hij gebruikt dezelfde kernregels als de Tampermonkey-versie:

- vertrek vanaf AMS, EIN, RTM en GRQ;
- drie scenario's: vrijdag→maandag, vrijdag→zondag en zaterdag→maandag;
- op een normale vrijdag alleen vertrek vanaf 21:00;
- op de laatste vrijdag van de maand vervalt die tijdsgrens;
- ruime voorselectie tot €250;
- score op prijs, verblijfsduur, heen-/terugtijd en rechtstreeks;
- maximaal één winnaar per bestemming;
- de beste drie bestemmingen worden nogmaals iets langer geverifieerd.

## Eerste test op GitHub

1. Maak op GitHub een **private repository**, bijvoorbeeld `weekend-radar`.
2. Upload de inhoud van deze map. Let erop dat `.github/workflows/radar.yml` exact op die plek staat.
3. Open in GitHub het tabblad **Actions**.
4. Kies **Weekend Radar**.
5. Klik **Run workflow**.
6. Laat `weekend_date` leeg voor komend weekend, of vul bijvoorbeeld `2026-08-22` in.
7. Open na afloop de workflow-run. Onder **Artifacts** staat `weekend-radar-results` met `latest.json`.

## Lokaal testen

```bash
python -m pip install -r requirements.txt
python -m playwright install chromium
python radar.py --date 2026-08-22 --headed
```

Zonder `--headed` draait de browser headless.

## Nog bewust niet toegevoegd

De eerste GitHub-versie draait alleen handmatig. Zodra één volledige cloudscan stabiel werkt, voegen we de planning 06:07 / 12:07 / 18:07 Europe/Amsterdam, prijshistorie en meldingen toe.

## Als Skyscanner niet laadt

Bekijk de log in GitHub Actions. De radar probeert geen CAPTCHA's of andere toegangscontroles te omzeilen. Als Skyscanner in een cloudbrowser een andere pagina of blokkade toont, moeten we de aanpak daarop aanpassen zonder zulke controles te omzeilen.
