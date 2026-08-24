# Weekend Wegwijzer

Tampermonkey-weekendzoeker voor Skyscanner.

## Kanalen

- `stable/Weekend-Wegwijzer.user.js`: stabiele versie 4.0.5.
- `candidate/Weekend-Wegwijzer.user.js`: testkanaal, momenteel 4.0.8 met een betrouwbare gecombineerde vlucht- en ReisWijzer-actie.

## Candidate installeren

Open `candidate/Weekend-Wegwijzer.user.js` in Tampermonkey en vervang alleen een bestaande Candidate-installatie. Stable blijft afzonderlijk beschikbaar.

## Controleren

Gebruik `npm run validate`. Dit controleert syntax, pure zoeklogica, metadata en veiligheidsinvarianten.

## 4.0.8

- De vlucht opent in een nieuw tabblad en het huidige tabblad schakelt naar ReisWijzer, zodat een pop-upblokkade nooit de tweede pagina tegenhoudt.

## 4.0.7

- De primaire vluchtactie opent tegelijk de Skyscanner-ticketpagina en de complete luchthavenreis in ReisWijzer.
- De losse Skyscanner-link blijft beschikbaar als secundaire keuze.

## 4.0.6

- Een gekozen vlucht kan nu veilig naar ReisWijzer worden doorgestuurd om de luchthavenreis voor te bereiden.
- Vluchtprijs en OV-tarief blijven zichtbaar gescheiden.

## 4.0.5

- Eigen datums die exact een weekend vormen krijgen dezelfde persoonlijke weekendregels als de automatische scan.
- Afwijkende doordeweekse perioden blijven vrij van automatische tijdslimieten.

## 4.0.4

- De standaardlijst combineert de goedkoopste optie, het langste verblijf en de beste balans.
- De resultaatkop toont geen interne cacheteller meer.
- De automatische thuiskomsttijd gebruikt stappen van vijf minuten en valt bij ongeldige opslag terug op 23:00.

## 4.0.3

- Resultaatfilters beperken zich tot prijs, verblijfsduur en luchthaven.
- Eigen perioden tonen geen niet-ingestelde weekendtijdslimiet meer.

## 4.0.2

- Eigen reisperioden hebben standaard geen vertrek- of thuiskomsttijdslimiet.
- Automatische weekenden houden de persoonlijke vrijdag- en maandagregels aan.

## 4.0.1

- herstelde land- en stadsuitlezing na de introductie van diagnose-resultaatsnapshots.

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
