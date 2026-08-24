# Wijzigingen

## Candidate 4.0.8

- Omzeil de browserblokkade op een tweede nieuw tabblad: de vlucht opent nieuw en het huidige tabblad gaat betrouwbaar naar ReisWijzer.

## Candidate 4.0.7

- Open vanuit één knop zowel de concrete Skyscanner-vlucht als de complete luchthavenreis in ReisWijzer.
- Houd “Alleen vlucht bekijken” als rustige secundaire keuze.

## Candidate 4.0.6

- Voeg op vluchtkaarten een knop toe om de heen- en terugreis naar de luchthaven in ReisWijzer voor te bereiden.
- Draag alleen gevalideerde vluchtmomenten, luchthaven, reizigers en de afzonderlijke vluchtprijs over via een compacte URL-fragmentpayload.
- Houd de vluchtprijs strikt gescheiden van de OV-tariefberekening.

## Stable 4.0.5

- Promoveer de volledig geteste Candidate 4.0.5 naar het stable updatekanaal.
- Behoud Candidate 4.0.5 als afzonderlijk testkanaal voor toekomstige wijzigingen.

## Candidate 4.0.5

- Herken vrijdag–maandag en zaterdag–maandag ook binnen `Eigen periode` als weekend.
- Pas bij een normaal vrijdagweekend automatisch de grens van 21:30 en maandag 23:00 toe.
- Behoud de vrije laatste vrijdag en herken het lange donderdag–maandagweekend.
- Laat afwijkende doordeweekse eigen perioden zonder automatische tijdsgrenzen.

## Candidate 4.0.4

- Start met één gecombineerde lijst: goedkoopste, langste verblijf en beste balans staan bovenaan zonder dubbelen.
- Behoud de losse sorteringen als optionele alternatieven.
- Verwijder de technische teller `direct geladen` uit de resultaatkop.
- Herstel ongeldige opgeslagen thuistijden naar 23:00 en gebruik stappen van vijf minuten.

## Candidate 4.0.3

- Verwijder de verouderde resultaatfilters `Vr → ma` en `Za → ma`.
- Toon bij een eigen periode alleen expliciet gekozen vertrek- en thuiskomsttijden.

## Candidate 4.0.2

- Laat tijdsbeperkingen bij een eigen reisperiode standaard leeg en optioneel.
- Voorkom dat eigen, niet-weekenddata automatisch de weekendregels van 21:30 en 23:00 erven.
- Pas een tijdsgrens bij eigen data alleen toe wanneer die expliciet is ingevuld.

## Candidate 4.0.1

- Herstel de land-naar-staduitlezing voor zowel eigen perioden als automatische weekendscans.
- Verplaats de diagnose-resultaatsnapshot naar het echte einde van de scan.
- Voeg een regressietest toe voor het uitlezen van steden vanaf een landpagina.

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
