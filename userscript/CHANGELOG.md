# Wijzigingen

## Candidate 4.0.0

- Zoek gewone weekenden vanaf vrijdag 21:30 en het laatste maandweekend al vanaf donderdag 21:30.
- Voeg een volledig eigen vertrek-/retourperiode met eigen tijden toe.
- Filter terugvluchten op verwachte thuiskomst uiterlijk 23:00, inclusief luchthavenrit en marge.
- Prioriteer kansrijke routes en beperk dure controles binnen late vertrekvensters.
- Markeer grote verschillen tussen indicatieve en concrete vluchtprijzen.
- Leg tijd tot eerste resultaat, correcte eindfase en zichtbare topresultaten vast in diagnoses.
- Synchroniseer de nieuwe beschikbaarheidsregels met de Python-radar.

## Candidate 3.9.0

- Schaal verborgen workers terug op lichtere apparaten en bij databesparing.
- Verlaag de harde maxima van 9/9/6 naar 6/6/4 workers.
- Scheid caches van oudere parser-versies.
- Verklein vluchtcaches automatisch wanneer `localStorage` vol raakt en probeer de oorspronkelijke opslag daarna opnieuw.
- Voorkom dat `fetch` en `XMLHttpRequest` bij dubbele injectie opnieuw worden omwikkeld.
- Ruim verborgen worker-iframes op bij stoppen en bij het verlaten van de pagina.
- Voeg een privacybewuste JSON-diagnose-download toe.
- Voeg syntax-, logica- en architectuurtests toe.
- Dedupliceer bestemmingen vóór de limiet per luchthaven, zodat dubbele Skyscanner-kaarten geen andere stad verdringen.
- Gebruik het Candidate-bestand op GitHub als automatisch Tampermonkey-updatekanaal.
- Bereken een transparant geschat reistotaal voor alle reizigers en markeer onbekende bagagekosten.
- Trek bestemmingstransfers en de terugvluchtbuffer af van de bruikbare weekendtijd.
- Ondersteun optioneel maximaal één overstap.
- Toon tijdens het zoeken al voorlopige topresultaten en begin het eindscherm met vijf aanbevelingen.
- Herken cookie-, captcha-, rate-limit- en toegangsblokkades afzonderlijk.
- Deel kernregels met `radar.py` via `src/rules.json` en test Skyscanner-fixtures.

Stable 3.7.1 is niet gewijzigd.
