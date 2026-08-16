# Weekend Wegwijzer

Tampermonkey-weekendzoeker voor Skyscanner.

## Kanalen

- `stable/Weekend-Wegwijzer.user.js`: oorspronkelijke, bevestigde versie 3.7.1.
- `candidate/Weekend-Wegwijzer.user.js`: verbeterde testversie 4.0.0.

## Candidate installeren

Open `candidate/Weekend-Wegwijzer.user.js` in Tampermonkey en vervang alleen een bestaande Candidate-installatie. Stable blijft afzonderlijk beschikbaar.

## Controleren

Gebruik `npm run validate`. Dit controleert syntax, pure zoeklogica, metadata en veiligheidsinvarianten.

## 4.0.0

- beschikbaarheidsprofiel voor normale en lange maandweekenden;
- eigen heen- en terugreisdatums met tijdvensters;
- thuiskomstgrens op basis van landing, luchthavenrit en marge;
- efficiëntere late scans, prijswaarschuwingen en rijkere diagnoses.

## 3.9.0

- adaptieve workerlimieten om browser en Skyscanner minder zwaar te belasten;
- versiegescheiden vluchtcaches;
- automatisch verkleinen van caches wanneer browseropslag vol raakt;
- idempotente fetch- en XHR-interceptie;
- opruimen van verborgen workers bij stoppen of verlaten van de pagina;
- downloadbare diagnose zonder volledige URL of browsergegevens;
- testexport die in de browser uitgeschakeld blijft.
- automatische installatie- en update-URL via de GitHub-repository.
- deur-tot-deurprijsmodel met expliciete onbekende bagagekosten;
- effectieve weekendtijd na transfers en luchthavenbuffer;
- instelbare luchthavenreis en maximaal één overstap;
- progressieve aanbevelingen, blokkadedetectie en gedeelde regels met de Python-radar.
