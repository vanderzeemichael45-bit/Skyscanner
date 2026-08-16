# Wijzigingen

## Candidate 3.8.1

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

Stable 3.7.1 is niet gewijzigd.
