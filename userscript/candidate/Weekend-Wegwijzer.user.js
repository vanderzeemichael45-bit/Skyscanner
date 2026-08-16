// ==UserScript==
// @name         Weekend Wegwijzer Candidate
// @namespace    weekend-wegwijzer-candidate
// @version      4.0.2
// @description  Candidate 4.0.2: eigen reisperioden zonder automatische weekendtijdslimieten
// @match        https://www.skyscanner.nl/*
// @grant        none
// @run-at       document-start
// @downloadURL  https://raw.githubusercontent.com/vanderzeemichael45-bit/Skyscanner/main/userscript/candidate/Weekend-Wegwijzer.user.js
// @updateURL    https://raw.githubusercontent.com/vanderzeemichael45-bit/Skyscanner/main/userscript/candidate/Weekend-Wegwijzer.user.js
// ==/UserScript==

(function () {
    'use strict';

    /* ============================================================
       CONFIG
       ============================================================ */

    const CONFIG = {
        airports: ['AMS', 'EIN', 'RTM', 'GRQ'],

        topCount: 5,
        initialResultCount: 5,
        progressiveResultStep: 5,

        /*
         * SPEED:
         * lichte pagina's sneller parallel,
         * concrete vluchtpagina's voorzichtig.
         */
        // Bovengrenzen; effectiveWorkerLimit schaalt terug op lichtere apparaten.
        exploreWorkers: 6,
        countryWorkers: 6,
        flightWorkers: 4,

        /*
         * BREDE SCAN
         */
        countryCandidatesPerAirport: 10,
        maxCountryCandidateCount: 40,

        cityCandidatesPerAirport: 25,
        maxCityCandidateCount: 100,

        /*
         * Binnen €7 van de bodemprijs kiezen we liever
         * een vlucht met meer tijd op bestemming.
         */
        nearPriceTolerance: 7,

        /*
         * Normale vrijdag:
         * vertrek pas vanaf 21:30.
         *
         * Laatste vrijdag van de maand:
         * hele vrijdag telt mee.
         */
        fridayEarliestDeparture: '21:30',
        thursdayEarliestDeparture: '21:30',
        defaultHomeDeadline: '23:00',
        defaultHomeArrivalMarginMinutes: 30,

        // Late vertrekvensters hebben aantoonbaar minder opbrengst; controleer eerst de kansrijkste routes.
        lateCountryCandidatesPerAirport: 6,
        lateMaxCountryCandidateCount: 24,
        lateCityCandidatesPerAirport: 12,
        lateMaxCityCandidateCount: 60,

        /*
         * Indicatieve prijzen bepalen alleen prioriteit.
         * Ze sluiten nooit kandidaten uit.
         */
        enableIndicativePruning: false,

        exploreTimeoutMs: 17000,
        countryTimeoutMs: 17000,

        /*
         * Betrouwbare instellingen uit 3.6.
         */
        flightTimeoutMs: 30000,
        parentTimeoutPaddingMs: 8000,

        maxFlightAttempts: 2,

        retryDelayMs: 1000,
        retryJitterMs: 1000,

        retryPriorityBase: 100000,

        pollIntervalMs: 300,

        minimumFlightObserveMs: 1200,
        flightStableRounds: 3,

        workerWidth: 1280,
        workerHeight: 900,

        multiWeekendCount: 6,

        cache: {
            exploreTtlMs: 30 * 60 * 1000,
            countryTtlMs: 30 * 60 * 1000,
            flightTtlMs: 10 * 60 * 1000,

            maxExploreEntries: 100,
            maxCountryEntries: 180,
            maxFlightEntries: 160,

            maxFlightsPerRoute: 120
        },

        storage: {
            settings: 'weekendWegwijzer_settings',
            favorites: 'weekendWegwijzer_favorites',
            history: 'weekendWegwijzer_history',

            // Cacheversie voorkomt dat gewijzigde parsers oude resultaten hergebruiken.
            cacheExplore: 'weekendWegwijzer_cache_explore_v400',
            cacheCountry: 'weekendWegwijzer_cache_country_v400',
            cacheFlight: 'weekendWegwijzer_cache_flight_v400',

            panel: 'weekendWegwijzer_panel'
        }
    };


    /* ============================================================
       STATE
       ============================================================ */

    let activeScan = null;

    let panelState =
        loadJson(
            CONFIG.storage.panel,
            {
                minimized: false,
                left: null,
                top: null
            }
        );


    /* ============================================================
       OPSLAG
       ============================================================ */

    function loadJson(key, fallback) {
        try {
            const raw =
                localStorage.getItem(key);

            return raw
                ? JSON.parse(raw)
                : fallback;

        } catch {
            return fallback;
        }
    }


    function clearOldestCacheHalf() {
        for (const key of [
            CONFIG.storage.cacheExplore,
            CONFIG.storage.cacheCountry,
            CONFIG.storage.cacheFlight
        ]) {
            const store = loadJson(key, {});
            const entries = Object.entries(store)
                .sort(([, a], [, b]) => (b?.time || 0) - (a?.time || 0))
                .slice(0, Math.max(1, Math.floor(Object.keys(store).length / 2)));
            try {
                localStorage.setItem(key, JSON.stringify(Object.fromEntries(entries)));
            } catch {}
        }
    }

    function saveJson(key, value) {
        const serialized = JSON.stringify(value);

        try {
            localStorage.setItem(key, serialized);
            return true;
        } catch (error) {
            // Instellingen en favorieten mogen niet verdwijnen wanneer vluchtcaches vol raken.
            clearOldestCacheHalf();
            try {
                localStorage.setItem(key, serialized);
                return true;
            } catch {
                console.warn('[Weekend Wegwijzer] Opslaan mislukt', key, error);
                return false;
            }
        }
    }


    function defaultSettings() {
        return {
            airports:
                [...CONFIG.airports],

            maxBudget: 0,

            minStayHours: 0,

            earliestReturn: '',

            homeDeadline: CONFIG.defaultHomeDeadline,
            homeArrivalMarginMinutes: CONFIG.defaultHomeArrivalMarginMinutes,

            sortMode: 'price',

            travelers: 1,
            baggage: 'personal',
            baggageCostPerTraveler: 0,
            bookingFees: 0,
            maxStops: 0,
            destinationTransferMinutes: 45,
            returnAirportBufferMinutes: 120,
            airportAccess: Object.fromEntries(
                CONFIG.airports.map(airport => [airport, { minutes: 0, cost: 0 }])
            ),

            compactMode: false
        };
    }


    function loadSettings() {
        return {
            ...defaultSettings(),

            ...loadJson(
                CONFIG.storage.settings,
                {}
            )
        };
    }


    function saveSettings(settings) {
        saveJson(
            CONFIG.storage.settings,
            settings
        );
    }


    /* ============================================================
       ALGEMENE HULPFUNCTIES
       ============================================================ */

    const sleep =
        ms =>
            new Promise(
                resolve =>
                    setTimeout(resolve, ms)
            );


    function normalize(text) {
        return String(text || '')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
    }


    function normalizeAscii(text) {
        return normalize(text)
            .normalize('NFD')
            .replace(
                /[\u0300-\u036f]/g,
                ''
            );
    }


    function escapeHtml(text) {
        return String(text ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }


    function parsePrice(text) {
        const match =
            String(text || '')
                .match(
                    /€\s*([\d.,]+)/
                );

        if (!match) {
            return null;
        }

        const value =
            Number(
                match[1]
                    .replace(/\./g, '')
                    .replace(',', '.')
            );

        return Number.isFinite(value)
            ? value
            : null;
    }


    function euro(
        value,
        decimals = true
    ) {
        if (!Number.isFinite(value)) {
            return '€—';
        }

        const hasDecimals =
            decimals &&
            Math.abs(
                value -
                Math.round(value)
            ) > 0.001;

        return new Intl.NumberFormat(
            'nl-NL',
            {
                style: 'currency',
                currency: 'EUR',

                minimumFractionDigits:
                    hasDecimals
                        ? 2
                        : 0,

                maximumFractionDigits:
                    hasDecimals
                        ? 2
                        : 0
            }
        ).format(value);
    }


    function timeToMinutes(time) {
        const match =
            String(time || '')
                .match(
                    /(\d{1,2}):(\d{2})/
                );

        if (!match) {
            return null;
        }

        return (
            Number(match[1]) * 60 +
            Number(match[2])
        );
    }


    function isoTime(iso) {
        const match =
            String(iso || '')
                .match(
                    /T(\d{2}:\d{2})/
                );

        return match
            ? match[1]
            : '';
    }


    function localIsoNumber(iso) {
        const value = String(iso || '');
        if (/([zZ]|[+-]\d{2}:?\d{2})$/.test(value)) {
            const timestamp = Date.parse(value);
            return Number.isFinite(timestamp) ? timestamp : null;
        }

        const match =
            value
                .match(
                    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/
                );

        if (!match) {
            return null;
        }

        return Date.UTC(
            Number(match[1]),
            Number(match[2]) - 1,
            Number(match[3]),
            Number(match[4]),
            Number(match[5])
        );
    }


    function calculateStayHours(
        arrivalIso,
        returnDepartureIso
    ) {
        const start =
            localIsoNumber(
                arrivalIso
            );

        const end =
            localIsoNumber(
                returnDepartureIso
            );

        if (
            start === null ||
            end === null ||
            end <= start
        ) {
            return 0;
        }

        return Math.round(
            (
                (end - start) /
                3600000
            ) * 10
        ) / 10;
    }

    function airportAccessFor(settings, airport) {
        const access = settings?.airportAccess?.[airport] || {};
        return {
            minutes: Math.max(0, Number(access.minutes) || 0),
            cost: Math.max(0, Number(access.cost) || 0)
        };
    }

    function effectiveStayHours(stayHours, settings) {
        const transferMinutes = Math.max(0, Number(settings?.destinationTransferMinutes) || 0);
        const bufferMinutes = Math.max(0, Number(settings?.returnAirportBufferMinutes) || 0);
        return Math.max(0, Math.round((stayHours - ((transferMinutes * 2 + bufferMinutes) / 60)) * 10) / 10);
    }

    function priceModel(flightPrice, airport, settings) {
        const travelers = Math.max(1, Math.round(Number(settings?.travelers) || 1));
        const access = airportAccessFor(settings, airport);
        const baggageCost = Math.max(0, Number(settings?.baggageCostPerTraveler) || 0);
        const bookingFees = Math.max(0, Number(settings?.bookingFees) || 0);
        const baggageKnown = settings?.baggage === 'personal' || baggageCost > 0;
        const total = flightPrice * travelers + access.cost + baggageCost * travelers + bookingFees;
        return {
            travelers,
            access,
            baggageKnown,
            total: Math.round(total * 100) / 100,
            incomplete: !baggageKnown
        };
    }


    function formatHours(hours) {
        return `${
            Math.round(
                hours * 10
            ) / 10
        } uur`;
    }


    function formatElapsed(ms) {
        const seconds =
            Math.max(
                0,
                Math.round(ms / 1000)
            );

        const minutes =
            Math.floor(
                seconds / 60
            );

        const rest =
            seconds % 60;

        return minutes
            ? `${minutes}m ${rest}s`
            : `${rest} sec`;
    }


    function elapsedBetween(
        start,
        end
    ) {
        if (
            !Number.isFinite(start) ||
            !Number.isFinite(end)
        ) {
            return 0;
        }

        return Math.max(
            0,
            end - start
        );
    }


    /* ============================================================
       MENSELIJKE TIJDSLABELS
       ============================================================ */

    function arrivalLabel(flight) {
        const arrival =
            timeToMinutes(
                flight.outboundArrival
            );

        if (arrival === null) {
            return null;
        }

        if (arrival < 12 * 60) {
            return {
                icon: '☀️',
                text: 'Vroege aankomst',
                kind: 'good'
            };
        }

        if (arrival < 18 * 60) {
            return {
                icon: '🕒',
                text: 'Aankomst overdag',
                kind: 'neutral'
            };
        }

        if (arrival < 22 * 60) {
            return {
                icon: '🌆',
                text: 'Avondaankomst',
                kind: 'neutral'
            };
        }

        return {
            icon: '🌙',
            text: 'Late aankomst',
            kind: 'warning'
        };
    }


    function returnLabel(flight) {
        const departure =
            timeToMinutes(
                flight.inboundDeparture
            );

        if (departure === null) {
            return null;
        }

        if (departure < 10 * 60) {
            return {
                icon: '🌅',
                text: 'Vroege terugvlucht',
                kind: 'warning'
            };
        }

        if (departure < 16 * 60) {
            return {
                icon: '🕒',
                text: 'Middag terug',
                kind: 'neutral'
            };
        }

        if (departure < 19 * 60) {
            return {
                icon: '✅',
                text: 'Goede terugtijd',
                kind: 'good'
            };
        }

        return {
            icon: '🌙',
            text: 'Late terugvlucht',
            kind: 'good'
        };
    }


    function timingBadgeStyle(kind) {
        if (kind === 'good') {
            return `
                background:rgba(34,197,94,.13);
                border:1px solid rgba(34,197,94,.12);
            `;
        }

        if (kind === 'warning') {
            return `
                background:rgba(245,158,11,.13);
                border:1px solid rgba(245,158,11,.12);
            `;
        }

        return `
            background:rgba(255,255,255,.07);
            border:1px solid rgba(255,255,255,.04);
        `;
    }


    function timingBadgesHtml(result) {
        return [
            arrivalLabel(result),
            returnLabel(result)
        ]
            .filter(Boolean)
            .map(
                label => `
                    <span style="
                        padding:3px 6px;
                        border-radius:5px;
                        font-size:10px;
                        ${timingBadgeStyle(
                            label.kind
                        )}
                    ">
                        ${label.icon}
                        ${escapeHtml(
                            label.text
                        )}
                    </span>
                `
            )
            .join('');
    }


    /* ============================================================
       RESULTAAT OPENEN
       ============================================================ */

    function shouldHideInterface() {
        return (
            location.hash ===
            '#ww-opened'
        );
    }


    function openSkyscannerResult(url) {
        try {
            const target =
                new URL(
                    url,
                    location.origin
                );

            target.hash =
                'ww-opened';

            window.open(
                target.href,
                '_blank',
                'noopener'
            );

        } catch {
            window.open(
                url,
                '_blank',
                'noopener'
            );
        }
    }


    /* ============================================================
       EUROPA
       ============================================================ */

    const EUROPE_COUNTRIES =
        new Set([
            'albanie',
            'albania',
            'andorra',
            'armenie',
            'armenia',
            'azerbeidzjan',
            'azerbaijan',
            'belgie',
            'belgium',
            'bosnie en herzegovina',
            'bosnia and herzegovina',
            'bulgarije',
            'bulgaria',
            'cyprus',
            'denemarken',
            'denmark',
            'duitsland',
            'germany',
            'estland',
            'estonia',
            'finland',
            'frankrijk',
            'france',
            'georgie',
            'georgia',
            'griekenland',
            'greece',
            'hongarije',
            'hungary',
            'ierland',
            'ireland',
            'ijsland',
            'iceland',
            'italie',
            'italy',
            'kosovo',
            'kroatie',
            'croatia',
            'letland',
            'latvia',
            'liechtenstein',
            'litouwen',
            'lithuania',
            'luxemburg',
            'luxembourg',
            'malta',
            'moldavie',
            'moldova',
            'monaco',
            'montenegro',
            'nederland',
            'netherlands',
            'noord-macedonie',
            'north macedonia',
            'macedonie',
            'noorwegen',
            'norway',
            'oekraine',
            'ukraine',
            'oostenrijk',
            'austria',
            'polen',
            'poland',
            'portugal',
            'roemenie',
            'romania',
            'san marino',
            'servie',
            'serbia',
            'slowakije',
            'slovakia',
            'slovenie',
            'slovenia',
            'spanje',
            'spain',
            'tsjechie',
            'czechia',
            'czech republic',
            'turkije',
            'turkiye',
            'turkey',
            'vaticaanstad',
            'vatican city',
            'verenigd koninkrijk',
            'united kingdom',
            'groot-brittannie',
            'zweden',
            'sweden',
            'zwitserland',
            'switzerland',
            'faeroer',
            'faroe islands',
            'jersey',
            'guernsey',
            'isle of man'
        ]);


    function isEuropeanCountry(country) {
        return EUROPE_COUNTRIES.has(
            normalizeAscii(country)
        );
    }


    /* ============================================================
       DATUMS
       ============================================================ */

    function atNoon(date) {
        const d =
            new Date(date);

        d.setHours(
            12,
            0,
            0,
            0
        );

        return d;
    }


    function addDays(
        date,
        amount
    ) {
        const d =
            atNoon(date);

        d.setDate(
            d.getDate() +
            amount
        );

        return d;
    }


    function nextSaturday(
        from = new Date()
    ) {
        const d =
            atNoon(from);

        let delta =
            (
                6 -
                d.getDay() +
                7
            ) % 7;

        if (delta === 0) {
            delta = 7;
        }

        return addDays(
            d,
            delta
        );
    }


    function getSaturdayForSelectedWeekend(
        selected
    ) {
        const d =
            atNoon(selected);

        switch (d.getDay()) {
            case 5:
                return addDays(d, 1);

            case 6:
                return d;

            case 0:
                return addDays(d, -1);

            case 1:
                return addDays(d, -2);

            default:
                return nextSaturday(d);
        }
    }


    function isLastFridayOfMonth(date) {
        if (
            date.getDay() !== 5
        ) {
            return false;
        }

        return (
            addDays(
                date,
                7
            ).getMonth() !==
            date.getMonth()
        );
    }


    function toSkyDate(date) {
        return (
            String(
                date.getFullYear()
            ).slice(-2) +

            String(
                date.getMonth() + 1
            ).padStart(2, '0') +

            String(
                date.getDate()
            ).padStart(2, '0')
        );
    }


    function toInputDate(date) {
        return [
            date.getFullYear(),

            String(
                date.getMonth() + 1
            ).padStart(2, '0'),

            String(
                date.getDate()
            ).padStart(2, '0')
        ].join('-');
    }


    function formatDate(date) {
        return new Intl.DateTimeFormat(
            'nl-NL',
            {
                weekday: 'short',
                day: 'numeric',
                month: 'short'
            }
        ).format(date);
    }


    function formatWeekend(saturday) {
        const friday =
            addDays(
                saturday,
                -1
            );

        const monday =
            addDays(
                saturday,
                2
            );

        return (
            `${formatDate(friday)} → ` +
            `${formatDate(monday)}`
        );
    }


    function weekendKey(saturday) {
        return toInputDate(
            saturday
        );
    }


    function createScenarios(saturday, settings = {}) {
        if (settings.customWindow?.active) {
            const custom = settings.customWindow;
            return [{
                id: 'custom',
                label: 'Eigen periode',
                outbound: toSkyDate(new Date(`${custom.outboundDate}T12:00:00`)),
                inbound: toSkyDate(new Date(`${custom.inboundDate}T12:00:00`)),
                earliestOutbound: custom.earliestDeparture || '',
                homeDeadline: custom.homeDeadline || '',
                fridayDeparture: false,
                fridayFree: false,
                custom: true
            }];
        }

        const friday =
            addDays(
                saturday,
                -1
            );

        const monday =
            addDays(
                saturday,
                2
            );

        const fridayFree =
            isLastFridayOfMonth(
                friday
            );

        const scenarios = [];

        if (fridayFree) {
            const thursday = addDays(friday, -1);
            scenarios.push({
                id: 'thu-mon',
                label: 'Donderdagavond → maandag',
                outbound: toSkyDate(thursday),
                inbound: toSkyDate(monday),
                earliestOutbound: CONFIG.thursdayEarliestDeparture,
                homeDeadline: settings.homeDeadline || CONFIG.defaultHomeDeadline,
                fridayDeparture: false,
                fridayFree: true
            });
        }

        scenarios.push(
            {
                id: 'fri-mon',

                label:
                    'Vrijdag → maandag',

                outbound:
                    toSkyDate(friday),

                inbound:
                    toSkyDate(monday),

                fridayDeparture:
                    true,

                earliestOutbound: fridayFree ? '' : CONFIG.fridayEarliestDeparture,

                homeDeadline: settings.homeDeadline || CONFIG.defaultHomeDeadline,

                fridayFree
            },

            {
                id: 'sat-mon',

                label:
                    'Zaterdag → maandag',

                outbound:
                    toSkyDate(saturday),

                inbound:
                    toSkyDate(monday),

                homeDeadline:
                    settings.homeDeadline || CONFIG.defaultHomeDeadline,

                fridayDeparture:
                    false,

                fridayFree
            }
        );

        return scenarios;
    }


    function upcomingSaturdays(amount) {
        const first =
            nextSaturday();

        return Array.from(
            {
                length: amount
            },

            (_, index) =>
                addDays(
                    first,
                    index * 7
                )
        );
    }


    function saturdaysInMonth(
        year,
        month
    ) {
        const output = [];

        const date =
            new Date(
                year,
                month,
                1,
                12
            );

        while (
            date.getMonth() ===
            month
        ) {
            if (
                date.getDay() === 6
            ) {
                output.push(
                    atNoon(date)
                );
            }

            date.setDate(
                date.getDate() + 1
            );
        }

        return output;
    }


    /* ============================================================
       URLS
       ============================================================ */

    function buildExploreUrl(
        airport,
        scenario,
        settings
    ) {
        const params =
            new URLSearchParams({
                adultsv2: '1',
                cabinclass: 'economy',
                childrenv2: '',
                ref: 'home',
                rtn: '1',

                outboundaltsenabled:
                    'false',

                inboundaltsenabled:
                    'false',

                preferdirects:
                    settings.maxStops === 0 ? 'true' : 'false'
            });

        if (settings.maxStops === 0) {
            params.set('stops', 'direct');
        }

        return (
            'https://www.skyscanner.nl/' +
            'transport/vluchten-van/' +
            `${airport.toLowerCase()}/` +
            `${scenario.outbound}/` +
            `${scenario.inbound}/?` +
            params.toString()
        );
    }


    function ensureSearchUrl(url, maxStops = WORKER_JOB?.maxStops ?? 0) {
        try {
            const parsed =
                new URL(
                    url,
                    location.origin
                );

            parsed.searchParams.set('preferdirects', maxStops === 0 ? 'true' : 'false');

            if (maxStops === 0) parsed.searchParams.set('stops', 'direct');
            else parsed.searchParams.delete('stops');

            parsed.searchParams.set(
                'outboundaltsenabled',
                'false'
            );

            parsed.searchParams.set(
                'inboundaltsenabled',
                'false'
            );

            return parsed.href;

        } catch {
            return url;
        }
    }


    function cacheUrl(url) {
        try {
            const parsed =
                new URL(
                    url,
                    location.origin
                );

            parsed.hash = '';

            for (const key of [...parsed.searchParams.keys()]) {
                if (/^(ref|utm_|associateid|campaign|tracking|market|locale)/i.test(key)) {
                    parsed.searchParams.delete(key);
                }
            }

            parsed.searchParams.sort();

            return parsed.href;

        } catch {
            return String(url);
        }
    }


    /* ============================================================
       CACHE
       ============================================================ */

    function cacheConfig(type) {
        if (type === 'explore') {
            return {
                key:
                    CONFIG.storage
                        .cacheExplore,

                ttl:
                    CONFIG.cache
                        .exploreTtlMs,

                max:
                    CONFIG.cache
                        .maxExploreEntries
            };
        }

        if (type === 'country') {
            return {
                key:
                    CONFIG.storage
                        .cacheCountry,

                ttl:
                    CONFIG.cache
                        .countryTtlMs,

                max:
                    CONFIG.cache
                        .maxCountryEntries
            };
        }

        return {
            key:
                CONFIG.storage
                    .cacheFlight,

            ttl:
                CONFIG.cache
                    .flightTtlMs,

            max:
                CONFIG.cache
                    .maxFlightEntries
        };
    }


    function trimCache(
        store,
        ttl,
        max
    ) {
        const now =
            Date.now();

        return Object.fromEntries(
            Object
                .entries(store)
                .filter(
                    ([, entry]) =>
                        entry &&
                        now -
                        entry.time <
                        ttl
                )
                .sort(
                    (
                        [, a],
                        [, b]
                    ) =>
                        b.time -
                        a.time
                )
                .slice(
                    0,
                    max
                )
        );
    }


    function getCached(
        type,
        key
    ) {
        const config =
            cacheConfig(type);

        let store =
            loadJson(
                config.key,
                {}
            );

        store =
            trimCache(
                store,
                config.ttl,
                config.max
            );

        saveJson(
            config.key,
            store
        );

        return (
            store[key]?.data ||
            null
        );
    }


    function prepareCacheData(
        type,
        data
    ) {
        if (
            type !== 'flight' ||
            !Array.isArray(
                data?.results
            )
        ) {
            return data;
        }

        return {
            ...data,

            results:
                [...data.results]
                    .sort(
                        (a, b) =>
                            a.price -
                            b.price
                    )
                    .slice(
                        0,
                        CONFIG.cache
                            .maxFlightsPerRoute
                    )
        };
    }


    function setCached(
        type,
        key,
        data
    ) {
        const config =
            cacheConfig(type);

        let store =
            loadJson(
                config.key,
                {}
            );

        store[key] = {
            time:
                Date.now(),

            data:
                prepareCacheData(
                    type,
                    data
                )
        };

        store =
            trimCache(
                store,
                config.ttl,
                config.max
            );

        saveJson(
            config.key,
            store
        );
    }


    /* ============================================================
       GEBALANCEERDE KANDIDAATSELECTIE
       ============================================================ */

    function selectBalancedCandidates(
        items,
        airports,
        perAirportLimit,
        totalLimit
    ) {
        const selected = [];

        for (
            const airport
            of airports
        ) {
            const airportItems = [];
            const airportSeen = new Set();

            for (const item of items
                .filter(candidate =>
                    candidate.airport === airport &&
                    Number.isFinite(candidate.price)
                )
                .sort((a, b) => a.price - b.price)) {
                const key = [
                    normalize(item.city || item.country),
                    cacheUrl(item.link)
                ].join('|');

                if (airportSeen.has(key)) continue;
                airportSeen.add(key);
                airportItems.push(item);

                if (airportItems.length >= perAirportLimit) break;
            }

            selected.push(
                ...airportItems
            );
        }

        const unique = [];
        const seen = new Set();

        for (
            const item
            of selected.sort(
                (a, b) =>
                    a.price -
                    b.price
            )
        ) {
            const key =
                [
                    item.airport,

                    normalize(
                        item.city ||
                        item.country
                    ),

                    cacheUrl(
                        item.link
                    )
                ].join('|');

            if (
                seen.has(key)
            ) {
                continue;
            }

            seen.add(key);

            unique.push(item);

            if (
                unique.length >=
                totalLimit
            ) {
                break;
            }
        }

        return unique;
    }


    /* ============================================================
       WORKER HASH
       ============================================================ */

    function parseWorkerJob() {
        const prefix =
            '#weekendWegwijzer=';

        if (
            !location.hash
                .startsWith(prefix)
        ) {
            return null;
        }

        try {
            return JSON.parse(
                decodeURIComponent(
                    location.hash.slice(
                        prefix.length
                    )
                )
            );

        } catch {
            return null;
        }
    }


    const WORKER_JOB =
        parseWorkerJob();


    /* ============================================================
       JSON INTERCEPTOR
       ============================================================ */

    const JSON_CAPTURE = {
        complete: null,
        largestCount: 0
    };


    function isRadarUrl(url) {
        return String(url || '')
            .includes(
                '/g/radar/api/v2/' +
                'web-unified-search/'
            );
    }


    function captureJson(data) {
        try {
            const itineraries =
                data?.itineraries;

            const results =
                itineraries?.results;

            if (
                !itineraries ||
                !Array.isArray(results)
            ) {
                return;
            }

            if (
                itineraries
                    ?.context
                    ?.status ===
                'complete' &&

                results.length >=
                JSON_CAPTURE
                    .largestCount
            ) {
                JSON_CAPTURE
                    .largestCount =
                    results.length;

                JSON_CAPTURE
                    .complete =
                    data;
            }

        } catch {}
    }


    const INTERCEPTOR_MARK = Symbol.for('weekendWegwijzer.interceptor.v380');

    try {
        const originalFetch =
            window.fetch;

        if (originalFetch && !originalFetch[INTERCEPTOR_MARK]) {
            const wrappedFetch =
                async function (...args) {
                    const response =
                        await originalFetch.apply(
                            this,
                            args
                        );

                    try {
                        const url =
                            String(
                                args[0]?.url ||
                                args[0] ||
                                ''
                            );

                        if (
                            isRadarUrl(url)
                        ) {
                            response
                                .clone()
                                .json()
                                .then(
                                    captureJson
                                )
                                .catch(
                                    () => {}
                                );
                        }

                    } catch {}

                    return response;
                };

            Object.defineProperty(wrappedFetch, INTERCEPTOR_MARK, { value: true });
            window.fetch = wrappedFetch;
        }

    } catch {}


    try {
        const xhrPrototype = XMLHttpRequest.prototype;
        const originalOpen = xhrPrototype.open;

        if (!originalOpen[INTERCEPTOR_MARK]) {
            const wrappedOpen =
            function (
                method,
                url,
                ...rest
            ) {
                this.__wwUrl =
                    String(
                        url || ''
                    );

                return originalOpen.call(
                    this,
                    method,
                    url,
                    ...rest
                );
            };
            Object.defineProperty(wrappedOpen, INTERCEPTOR_MARK, { value: true });
            xhrPrototype.open = wrappedOpen;
        }

        const originalSend = xhrPrototype.send;

        if (!originalSend[INTERCEPTOR_MARK]) {
            const wrappedSend =
            function (...args) {
                if (
                    isRadarUrl(
                        this.__wwUrl
                    )
                ) {
                    this.addEventListener(
                        'load',
                        () => {
                            try {
                                let data;

                                if (
                                    this.responseType ===
                                    'json'
                                ) {
                                    data =
                                        this.response;

                                } else {
                                    data =
                                        JSON.parse(
                                            this.responseText
                                        );
                                }

                                captureJson(data);

                            } catch {}
                        }
                    );
                }

                return originalSend.apply(
                    this,
                    args
                );
            };
            Object.defineProperty(wrappedSend, INTERCEPTOR_MARK, { value: true });
            xhrPrototype.send = wrappedSend;
        }

    } catch {}


    /* ============================================================
       WORKER COMMUNICATIE
       ============================================================ */

    function workerReply(
        status,
        payload = {}
    ) {
        if (
            !WORKER_JOB ||
            window.parent === window
        ) {
            return;
        }

        window.parent.postMessage(
            {
                source:
                    'weekendWegwijzerWorker',

                scanToken:
                    WORKER_JOB.scanToken,

                jobId:
                    WORKER_JOB.jobId,

                status,

                payload
            },

            location.origin
        );
    }


    /* ============================================================
       EXPLORE PARSER
       ============================================================ */

    function readCountries(airport) {
        return [
            ...document.querySelectorAll(
                '[data-testid="place-card"]'
            )
        ]
            .map(
                card => {
                    const country =
                        card
                            .querySelector('h2')
                            ?.innerText
                            ?.trim();

                    const price =
                        parsePrice(
                            card.innerText
                        );

                    return {
                        airport,
                        country,
                        price,

                        link:
                            ensureSearchUrl(
                                card.href
                            )
                    };
                }
            )
            .filter(
                item =>
                    item.country &&
                    Number.isFinite(
                        item.price
                    ) &&
                    item.link &&
                    isEuropeanCountry(
                        item.country
                    )
            );
    }


    /* ============================================================
       LAND → STEDEN
       ============================================================ */

    function readCities(
        airport,
        country
    ) {
        const output = [];

        const links =
            document.querySelectorAll(
                'a[data-testid="flights-link"]'
            );

        for (
            const link
            of links
        ) {
            const container =
                link.closest(
                    '[data-testid="description-container"]'
                );

            if (!container) {
                continue;
            }

            const city =
                container
                    .querySelector('h2')
                    ?.innerText
                    ?.trim();

            const price =
                parsePrice(
                    link.getAttribute(
                        'aria-label'
                    ) ||
                    link.innerText
                );

            if (
                !city ||
                !Number.isFinite(price)
            ) {
                continue;
            }

            output.push({
                airport,
                country,
                city,
                price,

                link:
                    ensureSearchUrl(
                        link.href
                    )
            });
        }

        return output;
    }


    function hasNoResults() {
        const text =
            normalize(
                document.body
                    ?.innerText
            );

        return (
            text.includes(
                'geen resultaten'
            ) ||
            text.includes(
                'geen vluchten'
            )
        );
    }

    function classifyPageState() {
        const text = normalize(document.body?.innerText);
        const title = normalize(document.title);
        if (/captcha|robot|verify you are human|bevestig dat je een mens bent/.test(`${title} ${text}`)) return 'BOT_CHECK';
        if (/access denied|toegang geweigerd|forbidden|temporarily blocked/.test(`${title} ${text}`)) return 'ACCESS_BLOCKED';
        if (/too many requests|te veel verzoeken|rate limit/.test(`${title} ${text}`)) return 'RATE_LIMITED';
        if (/cookies accepteren|accept all cookies|cookievoorkeuren/.test(text) && text.length < 5000) return 'COOKIE_WALL';
        return null;
    }


    async function waitForStableDomList(
        reader,
        timeout
    ) {
        const started =
            Date.now();

        let previousSignature = '';
        let stableRounds = 0;
        let latest = [];

        while (
            Date.now() -
            started <
            timeout
        ) {
            const pageState = classifyPageState();
            if (pageState) throw new Error(`__PAGE_STATE__:${pageState}`);

            const results =
                reader() || [];

            if (
                results.length
            ) {
                latest =
                    results;

                const signature =
                    results
                        .map(
                            result =>
                                `${
                                    result.city ||
                                    result.country ||
                                    ''
                                }:${result.price}`
                        )
                        .join('|');

                if (
                    signature ===
                    previousSignature
                ) {
                    stableRounds++;

                } else {
                    previousSignature =
                        signature;

                    stableRounds = 0;
                }

                if (
                    stableRounds >= 2
                ) {
                    return latest;
                }
            }

            if (
                hasNoResults()
            ) {
                return [];
            }

            await sleep(
                CONFIG.pollIntervalMs
            );
        }

        return latest.length
            ? latest
            : null;
    }


    /* ============================================================
       JSON VLUCHTEN
       ============================================================ */

    function carrierName(leg) {
        const carriers =
            leg
                ?.carriers
                ?.marketing;

        if (
            !Array.isArray(
                carriers
            ) ||
            !carriers.length
        ) {
            return '?';
        }

        return (
            carriers[0]?.name ||
            carriers[0]?.displayCode ||
            carriers[0]?.id ||
            '?'
        );
    }


    function compactJsonFlights(data, allowedStops = WORKER_JOB?.maxStops ?? 0) {
        const results =
            data
                ?.itineraries
                ?.results;

        if (
            !Array.isArray(results)
        ) {
            return [];
        }

        const output = [];

        for (
            const result
            of results
        ) {
            const legs =
                result?.legs;

            if (
                !Array.isArray(legs) ||
                legs.length < 2
            ) {
                continue;
            }

            const outbound =
                legs[0];

            const inbound =
                legs[1];

            const maxStops = Math.max(0, Number(allowedStops) || 0);
            if (Number(outbound?.stopCount) > maxStops || Number(inbound?.stopCount) > maxStops) {
                continue;
            }

            const price =
                Number(
                    result
                        ?.price
                        ?.raw
                );

            if (
                !Number.isFinite(
                    price
                )
            ) {
                continue;
            }

            output.push({
                price:
                    Math.round(
                        price * 100
                    ) / 100,

                outboundDeparture:
                    isoTime(
                        outbound?.departure
                    ),

                outboundArrival:
                    isoTime(
                        outbound?.arrival
                    ),

                inboundDeparture:
                    isoTime(
                        inbound?.departure
                    ),

                inboundArrival:
                    isoTime(
                        inbound?.arrival
                    ),

                outboundDepartureIso:
                    outbound?.departure,

                outboundArrivalIso:
                    outbound?.arrival,

                inboundDepartureIso:
                    inbound?.departure,

                inboundArrivalIso:
                    inbound?.arrival,

                outboundFrom:
                    outbound
                        ?.origin
                        ?.name ||
                    outbound
                        ?.origin
                        ?.id ||
                    '?',

                outboundTo:
                    outbound
                        ?.destination
                        ?.name ||
                    outbound
                        ?.destination
                        ?.id ||
                    '?',

                inboundFrom:
                    inbound
                        ?.origin
                        ?.name ||
                    inbound
                        ?.origin
                        ?.id ||
                    '?',

                inboundTo:
                    inbound
                        ?.destination
                        ?.name ||
                    inbound
                        ?.destination
                        ?.id ||
                    '?',

                outboundAirline:
                    carrierName(
                        outbound
                    ),

                inboundAirline:
                    carrierName(
                        inbound
                    ),

                outboundStops: Number(outbound?.stopCount) || 0,
                inboundStops: Number(inbound?.stopCount) || 0,

                source:
                    'JSON'
            });
        }

        return output;
    }


    /* ============================================================
       DOM VLUCHTEN
       ============================================================ */

    function parseDescriptor(text, allowedStops = WORKER_JOB?.maxStops ?? 0) {
        if (!text) {
            return null;
        }

        const priceMatch =
            text.match(
                /Totale kosten\s*€\s*([\d.,]+)/i
            ) ||
            text.match(
                /€\s*([\d.,]+)/
            );

        if (!priceMatch) {
            return null;
        }

        const price =
            Number(
                priceMatch[1]
                    .replace(/\./g, '')
                    .replace(',', '.')
            );

        if (
            !Number.isFinite(
                price
            )
        ) {
            return null;
        }

        const routes =
            [
                ...text.matchAll(
                    /Vertrekt uit\s+(.+?)\s+om\s+(\d{1,2}:\d{2}),\s*komt aan in\s+(.+?)\s+om\s+(\d{1,2}:\d{2})/gi
                )
            ];

        if (
            routes.length < 2
        ) {
            return null;
        }

        const direct =
            text.match(
                /Rechtstreekse vlucht/gi
            ) || [];

        const maxStops = Math.max(0, Number(allowedStops) || 0);
        if (maxStops === 0 && direct.length < 2) {
            return null;
        }

        const outbound =
            routes[0];

        const inbound =
            routes[
                routes.length - 1
            ];

        return {
            price:
                Math.round(
                    price * 100
                ) / 100,

            outboundFrom:
                outbound[1].trim(),

            outboundDeparture:
                outbound[2],

            outboundTo:
                outbound[3].trim(),

            outboundArrival:
                outbound[4],

            inboundFrom:
                inbound[1].trim(),

            inboundDeparture:
                inbound[2],

            inboundTo:
                inbound[3].trim(),

            inboundArrival:
                inbound[4],

            outboundAirline:
                text.match(
                    /Heenvlucht met\s+(.+?)(?:\.|,|\n)/i
                )?.[1]
                ?.trim() ||
                '?',

            inboundAirline:
                text.match(
                    /Retourvlucht met\s+(.+?)(?:\.|,|\n)/i
                )?.[1]
                ?.trim() ||
                '?',

            outboundStops: direct.length >= 1 ? 0 : 1,
            inboundStops: direct.length >= 2 ? 0 : 1,

            source:
                'DOM'
        };
    }


    function readDomFlights() {
        const output = [];

        const descriptors =
            document.querySelectorAll(
                '[class*="FlightsTicketA11yDescriptor"]'
            );

        for (
            const descriptor
            of descriptors
        ) {
            const parsed =
                parseDescriptor(
                    descriptor.textContent ||
                    descriptor.innerText
                );

            if (parsed) {
                output.push(
                    parsed
                );
            }
        }

        const seen =
            new Set();

        return output.filter(
            flight => {
                const key =
                    [
                        flight.price,
                        flight.outboundDeparture,
                        flight.outboundArrival,
                        flight.inboundDeparture,
                        flight.inboundArrival
                    ].join('|');

                if (
                    seen.has(key)
                ) {
                    return false;
                }

                seen.add(key);

                return true;
            }
        );
    }


    function skyDateToIso(
        yymmdd,
        time
    ) {
        if (
            !/^\d{6}$/.test(
                String(yymmdd)
            )
        ) {
            return null;
        }

        const year =
            2000 +
            Number(
                String(yymmdd)
                    .slice(0, 2)
            );

        const month =
            String(yymmdd)
                .slice(2, 4);

        const day =
            String(yymmdd)
                .slice(4, 6);

        return (
            `${year}-${month}-${day}` +
            `T${time}:00`
        );
    }


    function addIsoDatesToDomFlight(
        flight
    ) {
        return {
            ...flight,

            outboundDepartureIso:
                skyDateToIso(
                    WORKER_JOB.outbound,
                    flight.outboundDeparture
                ),

            outboundArrivalIso:
                skyDateToIso(
                    WORKER_JOB.outbound,
                    flight.outboundArrival
                ),

            inboundDepartureIso:
                skyDateToIso(
                    WORKER_JOB.inbound,
                    flight.inboundDeparture
                ),

            inboundArrivalIso:
                skyDateToIso(
                    WORKER_JOB.inbound,
                    flight.inboundArrival
                )
        };
    }


    /* ============================================================
       HYBRIDE VLUCHTWORKER
       ============================================================ */

    async function waitForHybridFlights() {
        const started =
            Date.now();

        let previousSignature = '';
        let stableRounds = 0;
        let bestDom = [];

        while (
            Date.now() -
            started <
            CONFIG.flightTimeoutMs
        ) {
            const pageState = classifyPageState();
            if (pageState) return { results: [], source: pageState };

            if (
                JSON_CAPTURE.complete
            ) {
                const jsonFlights =
                    compactJsonFlights(
                        JSON_CAPTURE.complete
                    );

                if (
                    jsonFlights.length
                ) {
                    return {
                        results:
                            jsonFlights,

                        source:
                            'JSON'
                    };
                }
            }

            const domFlights =
                readDomFlights();

            if (
                domFlights.length
            ) {
                bestDom =
                    domFlights;

                const sorted =
                    [...domFlights]
                        .sort(
                            (a, b) =>
                                a.price -
                                b.price
                        );

                const signature =
                    [
                        sorted.length,
                        sorted[0]?.price,
                        sorted[0]
                            ?.outboundDeparture,
                        sorted[0]
                            ?.inboundDeparture
                    ].join('|');

                if (
                    signature ===
                    previousSignature
                ) {
                    stableRounds++;

                } else {
                    previousSignature =
                        signature;

                    stableRounds = 0;
                }

                if (
                    Date.now() -
                    started >=
                    CONFIG
                        .minimumFlightObserveMs &&

                    stableRounds >=
                    CONFIG
                        .flightStableRounds
                ) {
                    return {
                        results:
                            bestDom.map(
                                addIsoDatesToDomFlight
                            ),

                        source:
                            'DOM'
                    };
                }
            }

            if (
                hasNoResults()
            ) {
                return {
                    results: [],
                    source:
                        'NO_RESULT'
                };
            }

            await sleep(
                CONFIG.pollIntervalMs
            );
        }

        if (
            bestDom.length
        ) {
            return {
                results:
                    bestDom.map(
                        addIsoDatesToDomFlight
                    ),

                source:
                    'DOM'
            };
        }

        return {
            results: [],
            source:
                'TIMEOUT'
        };
    }


    /* ============================================================
       WORKER MAIN
       ============================================================ */

    async function workerMain() {
        try {
            if (
                document.readyState ===
                'loading'
            ) {
                await new Promise(
                    resolve =>
                        document
                            .addEventListener(
                                'DOMContentLoaded',
                                resolve,
                                {
                                    once: true
                                }
                            )
                );
            }

            if (
                WORKER_JOB.type ===
                'explore'
            ) {
                workerReply(
                    'done',
                    {
                        results:
                            await waitForStableDomList(
                                () =>
                                    readCountries(
                                        WORKER_JOB.airport
                                    ),

                                CONFIG
                                    .exploreTimeoutMs
                            ) ||
                            []
                    }
                );

                return;
            }

            if (
                WORKER_JOB.type ===
                'country'
            ) {
                workerReply(
                    'done',
                    {
                        results:
                            await waitForStableDomList(
                                () =>
                                    readCities(
                                        WORKER_JOB.airport,
                                        WORKER_JOB.country
                                    ),

                                CONFIG
                                    .countryTimeoutMs
                            ) ||
                            []
                    }
                );

                return;
            }

            if (
                WORKER_JOB.type ===
                'flight'
            ) {
                workerReply(
                    'done',
                    await waitForHybridFlights()
                );

                return;
            }

            workerReply(
                'error',
                {
                    reason:
                        'unknown-job'
                }
            );

        } catch (error) {
            workerReply(
                'error',
                {
                    reason:
                        error?.message ||
                        String(error)
                }
            );
        }
    }


    if (WORKER_JOB) {
        workerMain();
        return;
    }


    /* ============================================================
       PARENT IFRAME JOB CONTROLLER
       ============================================================ */

    const pendingJobs =
        new Map();


    window.addEventListener(
        'message',
        event => {
            if (
                event.origin !==
                location.origin
            ) {
                return;
            }

            const message =
                event.data;

            if (
                message?.source !==
                'weekendWegwijzerWorker'
            ) {
                return;
            }

            const pending =
                pendingJobs.get(
                    message.jobId
                );

            if (
                !pending ||
                message.scanToken !==
                pending.scanToken
            ) {
                return;
            }

            clearTimeout(
                pending.timeout
            );

            pending.iframe.remove();

            pendingJobs.delete(
                message.jobId
            );

            if (
                message.status ===
                'done'
            ) {
                pending.resolve(
                    message.payload
                );

            } else {
                pending.resolve({
                    results: [],
                    source:
                        String(message?.payload?.reason || '').startsWith('__PAGE_STATE__:')
                            ? String(message.payload.reason).split(':')[1]
                            : 'ERROR',

                    error:
                        message
                            ?.payload
                            ?.reason ||
                        'worker-error'
                });
            }
        }
    );


    function createWorkerJob(
        type,
        url,
        payload,
        scanToken
    ) {
        return new Promise(
            resolve => {
                const jobId =
                    Date.now() +
                    '-' +
                    Math.random()
                        .toString(36)
                        .slice(2);

                const workerUrl =
                    new URL(
                        url
                    );

                workerUrl.hash =
                    'weekendWegwijzer=' +
                    encodeURIComponent(
                        JSON.stringify({
                            ...payload,
                            type,
                            jobId,
                            scanToken
                        })
                    );

                const iframe =
                    document.createElement(
                        'iframe'
                    );

                Object.assign(
                    iframe.style,
                    {
                        position:
                            'fixed',

                        width:
                            `${CONFIG.workerWidth}px`,

                        height:
                            `${CONFIG.workerHeight}px`,

                        left:
                            '-20000px',

                        top:
                            '-20000px',

                        opacity:
                            '0',

                        pointerEvents:
                            'none',

                        border:
                            '0',

                        zIndex:
                            '-1'
                    }
                );

                const timeoutBase =
                    type === 'flight'
                        ? CONFIG
                            .flightTimeoutMs
                        : type === 'country'
                            ? CONFIG
                                .countryTimeoutMs
                            : CONFIG
                                .exploreTimeoutMs;

                const timeout =
                    setTimeout(
                        () => {
                            pendingJobs.delete(
                                jobId
                            );

                            iframe.remove();

                            resolve({
                                results: [],
                                source:
                                    'PARENT_TIMEOUT'
                            });
                        },

                        timeoutBase +
                        CONFIG
                            .parentTimeoutPaddingMs
                    );

                pendingJobs.set(
                    jobId,
                    {
                        iframe,
                        resolve,
                        timeout,
                        scanToken
                    }
                );

                iframe.src =
                    workerUrl.href;

                document.body.appendChild(
                    iframe
                );
            }
        );
    }


    /* ============================================================
       CACHE + WORKER
       ============================================================ */

    async function cachedWorkerJob(
        type,
        url,
        payload,
        scanToken,
        {
            forceFresh = false
        } = {}
    ) {
        const key =
            cacheUrl(url);

        if (!forceFresh) {
            const cached =
                getCached(
                    type,
                    key
                );

            if (cached) {
                if (
                    activeScan?.stats
                ) {
                    activeScan
                        .stats
                        .cacheHits++;
                }

                return {
                    ...cached,

                    sourceOriginal:
                        cached.source,

                    source:
                        'CACHE'
                };
            }
        }

        const result =
            await createWorkerJob(
                type,
                url,
                payload,
                scanToken
            );

        if (
            result &&
            ![
                'TIMEOUT',
                'PARENT_TIMEOUT',
                'ERROR',
                'CANCELLED'
            ].includes(
                result.source
            )
        ) {
            setCached(
                type,
                key,
                result
            );
        }

        return result;
    }


    function isTimeoutResponse(response) {
        return (
            response?.source ===
                'TIMEOUT' ||

            response?.source ===
                'PARENT_TIMEOUT'
        );
    }


    /* ============================================================
       PRIORITY QUEUE
       ============================================================ */

    function effectiveWorkerLimit(configured) {
        const hardware = Number(navigator.hardwareConcurrency) || 4;
        const connection = navigator.connection;
        const constrained = Boolean(connection?.saveData) || /(^|-)2g$/.test(connection?.effectiveType || '');
        const deviceLimit = constrained ? 2 : Math.max(2, Math.floor(hardware / 2));
        return Math.max(1, Math.min(configured, deviceLimit));
    }

    class PriorityQueue {
        constructor(limit) {
            this.limit =
                effectiveWorkerLimit(limit);

            this.running =
                0;

            this.queue =
                [];

            this.idleWaiters =
                [];

            this.order =
                0;
        }


        add(
            handler,
            priority = 100
        ) {
            return new Promise(
                (resolve, reject) => {
                    this.queue.push({
                        handler,
                        priority,
                        resolve,
                        reject,

                        order:
                            this.order++
                    });

                    this.queue.sort(
                        (a, b) =>
                            a.priority -
                            b.priority ||

                            a.order -
                            b.order
                    );

                    this.pump();
                }
            );
        }


        pump() {
            while (
                this.running <
                this.limit &&
                this.queue.length
            ) {
                const task =
                    this.queue.shift();

                this.running++;

                Promise
                    .resolve()
                    .then(
                        task.handler
                    )
                    .then(
                        task.resolve,
                        task.reject
                    )
                    .finally(
                        () => {
                            this.running--;

                            this.pump();

                            this.checkIdle();
                        }
                    );
            }

            this.checkIdle();
        }


        checkIdle() {
            if (
                this.running === 0 &&
                this.queue.length === 0
            ) {
                const waiters =
                    this.idleWaiters
                        .splice(0);

                waiters.forEach(
                    resolve =>
                        resolve()
                );
            }
        }


        onIdle() {
            if (
                this.running === 0 &&
                this.queue.length === 0
            ) {
                return Promise.resolve();
            }

            return new Promise(
                resolve =>
                    this.idleWaiters
                        .push(resolve)
            );
        }


        cancelQueued() {
            const queued =
                this.queue.splice(0);

            queued.forEach(
                task =>
                    task.resolve({
                        results: [],
                        source:
                            'CANCELLED'
                    })
            );

            this.checkIdle();
        }
    }


    /* ============================================================
       VLUCHTFILTERS TIJDENS SCAN
       ============================================================ */

    function isAllowedByWeekend(
        flight,
        scenario
    ) {
        if (scenario.earliestOutbound) {
            const actual =
                timeToMinutes(
                    flight
                        .outboundDeparture
                );

            const minimum =
                timeToMinutes(scenario.earliestOutbound);

            if (
                actual === null ||
                actual < minimum
            ) {
                return false;
            }
        }

        return true;
    }


    function minutesToClock(minutes) {
        if (!Number.isFinite(minutes)) return '—';
        const normalized = ((Math.round(minutes) % 1440) + 1440) % 1440;
        return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
    }


    function formatAvailability(saturday, settings = {}) {
        const custom = settings.customWindow;
        if (!custom?.active) return formatWeekend(saturday);
        const outbound = new Date(`${custom.outboundDate}T12:00:00`);
        const inbound = new Date(`${custom.inboundDate}T12:00:00`);
        return `${formatDate(outbound)} ${custom.earliestDeparture ? `vanaf ${custom.earliestDeparture}` : ''} → ${formatDate(inbound)} · thuis vóór ${custom.homeDeadline || settings.homeDeadline}`;
    }


    function expectedHomeArrivalMinutes(flight, settings) {
        let landing = timeToMinutes(flight.inboundArrival);
        if (landing === null) return null;

        if (flight.inboundArrivalIso && /^\d{6}$/.test(flight.scenarioInbound || '')) {
            const sky = flight.scenarioInbound;
            const dateMatch = String(flight.inboundArrivalIso)
                .match(/^(\d{4})-(\d{2})-(\d{2})/);

            if (dateMatch) {
                const plannedDay = Date.UTC(
                    Number(`20${sky.slice(0, 2)}`),
                    Number(sky.slice(2, 4)) - 1,
                    Number(sky.slice(4, 6))
                );
                const actualDay = Date.UTC(
                    Number(dateMatch[1]),
                    Number(dateMatch[2]) - 1,
                    Number(dateMatch[3])
                );
                const dayOffset = Math.max(0, Math.round((actualDay - plannedDay) / 86400000));
                landing += dayOffset * 1440;
            }
        }

        const access = airportAccessFor(settings, flight.airport);
        const margin = Math.max(0, Number(settings.homeArrivalMarginMinutes) || 0);
        return landing + access.minutes + margin;
    }


    function enrichFlight(
        flight,
        city,
        scenario,
        settings
    ) {
        const stayHours = calculateStayHours(
            flight.outboundArrivalIso,
            flight.inboundDepartureIso
        );
        const pricing = priceModel(flight.price, city.airport, settings);
        const indicativePrice = Number(city.price);
        const priceDifference = Number.isFinite(indicativePrice)
            ? Math.abs(Number(flight.price) - indicativePrice)
            : null;
        const priceVolatile = priceDifference !== null &&
            priceDifference >= Math.max(25, indicativePrice * 0.2);
        const expectedHomeMinutes = expectedHomeArrivalMinutes(
            { ...flight, airport: city.airport, scenarioInbound: scenario.inbound },
            settings
        );

        return {
            ...flight,

            airport:
                city.airport,

            city:
                city.city,

            country:
                city.country,

            scenarioId:
                scenario.id,

            scenarioLabel:
                scenario.label,

            scenarioHomeDeadline:
                scenario.custom
                    ? (scenario.homeDeadline || '')
                    : (scenario.homeDeadline || settings.homeDeadline),

            customScenario:
                Boolean(scenario.custom),

            scenarioInbound:
                scenario.inbound,

            fridayFree:
                scenario.fridayFree,

            link:
                city.link,

            stayHours,
            effectiveStayHours: effectiveStayHours(stayHours, settings),
            totalPrice: pricing.total,
            priceIncomplete: pricing.incomplete,
            baggageKnown: pricing.baggageKnown,
            accessMinutes: pricing.access.minutes,
            accessCost: pricing.access.cost,
            travelers: pricing.travelers,
            indicativePrice: Number.isFinite(indicativePrice) ? indicativePrice : null,
            priceDifference,
            priceVolatile,
            expectedHomeMinutes
        };
    }


    function passesSearchFilters(
        flight,
        settings
    ) {
        if (
            settings.maxBudget >
            0 &&
            (flight.totalPrice ?? flight.price) >
            settings.maxBudget
        ) {
            return false;
        }

        if (
            settings.minStayHours >
            0 &&
            (flight.effectiveStayHours ?? flight.stayHours) <
            settings.minStayHours
        ) {
            return false;
        }

        if (
            settings.earliestReturn
        ) {
            const actual =
                timeToMinutes(
                    flight
                        .inboundDeparture
                );

            const minimum =
                timeToMinutes(
                    settings
                        .earliestReturn
                );

            if (
                actual === null ||
                actual < minimum
            ) {
                return false;
            }
        }

        const homeDeadline = flight.customScenario
            ? flight.scenarioHomeDeadline
            : (flight.scenarioHomeDeadline || settings.homeDeadline);

        if (homeDeadline) {
            const expectedHome = expectedHomeArrivalMinutes(flight, settings);
            const latest = timeToMinutes(homeDeadline);

            if (
                expectedHome === null ||
                latest === null ||
                expectedHome > latest
            ) {
                return false;
            }
        }

        return true;
    }


    /* ============================================================
       VLUCHTSELECTIE
       ============================================================ */

    function returnMinutes(flight) {
        return (
            timeToMinutes(
                flight.inboundDeparture
            ) ||
            0
        );
    }


    function compareCheapest(
        a,
        b
    ) {
        return (
            (a.totalPrice ?? a.price) -
            (b.totalPrice ?? b.price) ||

            (b.effectiveStayHours ?? b.stayHours) -
            (a.effectiveStayHours ?? a.stayHours) ||

            returnMinutes(b) -
            returnMinutes(a)
        );
    }


    function compareStay(
        a,
        b
    ) {
        return (
            (b.effectiveStayHours ?? b.stayHours) -
            (a.effectiveStayHours ?? a.stayHours) ||

            a.price -
            b.price ||

            returnMinutes(b) -
            returnMinutes(a)
        );
    }


    function flightKey(flight) {
        return [
            flight.price,
            flight.airport,
            flight.scenarioId,
            flight.outboundDeparture,
            flight.inboundDeparture
        ].join('|');
    }


    /*
     * 3.7.1:
     *
     * Bewaar meer dan alleen goedkoopste + aanbevolen.
     * Resultaatfilters hebben later meerdere varianten nodig.
     */
    function selectRouteVariants(
        flights
    ) {
        if (!flights.length) {
            return [];
        }

        const sortedByPrice =
            [...flights]
                .sort(
                    compareCheapest
                );

        const cheapest =
            sortedByPrice[0];

            const near =
                flights.filter(
                    flight =>
                    (flight.totalPrice ?? flight.price) <=
                    (cheapest.totalPrice ?? cheapest.price) +
                    CONFIG
                        .nearPriceTolerance
            );

        const bestStay =
            [...near]
                .sort(
                    compareStay
                )[0];

        const longestStay =
            [...flights]
                .sort(
                    compareStay
                )[0];

        const cheapOptions =
            sortedByPrice.slice(
                0,
                8
            );

        const result = [];
        const seen = new Set();

        for (
            const flight
            of [
                cheapest,
                bestStay,
                longestStay,
                ...cheapOptions
            ]
        ) {
            if (!flight) {
                continue;
            }

            const key =
                flightKey(
                    flight
                );

            if (
                seen.has(key)
            ) {
                continue;
            }

            seen.add(key);

            result.push(
                flight
            );
        }

        return result;
    }


    function groupDestinations(flights) {
        const groups =
            new Map();

        for (
            const flight
            of flights
        ) {
            const key =
                normalize(
                    flight.city
                );

            if (!key) {
                continue;
            }

            if (
                !groups.has(key)
            ) {
                groups.set(
                    key,
                    []
                );
            }

            groups
                .get(key)
                .push(
                    flight
                );
        }

        const output = [];

        for (
            const variants
            of groups.values()
        ) {
            const cheapest =
                [...variants]
                    .sort(
                        compareCheapest
                    )[0];

            if (!cheapest) {
                continue;
            }

            const near =
                variants.filter(
                    flight =>
                        (flight.totalPrice ?? flight.price) <=
                        (cheapest.totalPrice ?? cheapest.price) +
                        CONFIG
                            .nearPriceTolerance
                );

            const recommended =
                [...near]
                    .sort(
                        compareStay
                    )[0] ||
                cheapest;

            const alternatives =
                variants
                    .filter(
                        flight =>
                            flightKey(
                                flight
                            ) !==
                            flightKey(
                                recommended
                            )
                    )
                    .sort(
                        compareCheapest
                    );

            output.push({
                ...recommended,

                floorPrice:
                    cheapest.price,

                floorTotalPrice:
                    cheapest.totalPrice ?? cheapest.price,

                cheapestVariant:
                    cheapest,

                recommendationExtra:
                    Math.round(
                        (
                            (recommended.totalPrice ?? recommended.price) -
                            (cheapest.totalPrice ?? cheapest.price)
                        ) *
                        100
                    ) / 100,

                extraHours:
                    Math.round(
                        Math.max(
                            0,

                            (recommended.effectiveStayHours ?? recommended.stayHours) -
                            (cheapest.effectiveStayHours ?? cheapest.stayHours)
                        ) *
                        10
                    ) / 10,

                rawDealValue:
                    (recommended.effectiveStayHours ?? recommended.stayHours) /
                    Math.max(
                        recommended.totalPrice ?? recommended.price,
                        1
                    ),

                /*
                 * Alle bewaarde varianten blijven beschikbaar.
                 */
                allVariants:
                    variants,

                alternatives
            });
        }

        return output;
    }


    function dealLabel(score) {
        if (
            score >= 90
        ) {
            return 'Topdeal';
        }

        if (
            score >= 75
        ) {
            return 'Sterke deal';
        }

        if (
            score >= 55
        ) {
            return 'Prima deal';
        }

        return 'Normale deal';
    }


    function sortDestinations(
        grouped,
        mode
    ) {
        const maxDeal =
            Math.max(
                0,

                ...grouped.map(
                    result =>
                        result
                            .rawDealValue ||
                        0
                )
            );

        const scored =
            grouped.map(
                result => {
                    const score =
                        maxDeal > 0
                            ? Math.round(
                                (
                                    result
                                        .rawDealValue /
                                    maxDeal
                                ) *
                                100
                            )
                            : 0;

                    return {
                        ...result,

                        dealScore:
                            score,

                        dealLabel:
                            dealLabel(
                                score
                            )
                    };
                }
            );

        if (
            mode === 'stay'
        ) {
            return scored.sort(
                (a, b) =>
                    (b.effectiveStayHours ?? b.stayHours) -
                    (a.effectiveStayHours ?? a.stayHours) ||

                    (a.floorTotalPrice ?? a.floorPrice) -
                    (b.floorTotalPrice ?? b.floorPrice)
            );
        }

        if (
            mode === 'deal'
        ) {
            return scored.sort(
                (a, b) =>
                    b.dealScore -
                    a.dealScore ||

                    (a.floorTotalPrice ?? a.floorPrice) -
                    (b.floorTotalPrice ?? b.floorPrice)
            );
        }

        return scored.sort(
            (a, b) =>
                (a.floorTotalPrice ?? a.floorPrice) -
                (b.floorTotalPrice ?? b.floorPrice) ||

                a.price -
                b.price ||

                b.stayHours -
                a.stayHours
        );
    }

    function addRecommendationTags(results) {
        if (!results.length) return results;
        const cheapest = [...results].sort((a, b) => (a.floorTotalPrice ?? a.floorPrice) - (b.floorTotalPrice ?? b.floorPrice))[0];
        const longest = [...results].sort((a, b) => (b.effectiveStayHours ?? b.stayHours) - (a.effectiveStayHours ?? a.stayHours))[0];
        const bestDeal = [...results].sort((a, b) => b.dealScore - a.dealScore)[0];
        const knownAccess = results.filter(result => result.accessMinutes > 0);
        const nearest = [...knownAccess].sort((a, b) => a.accessMinutes - b.accessMinutes)[0];
        return results.map(result => ({
            ...result,
            recommendationTags: [
                result === cheapest ? 'Goedkoopste totaal' : '',
                result === longest ? 'Meeste tijd op bestemming' : '',
                result === bestDeal ? 'Beste balans' : '',
                result === nearest ? 'Dichtstbijzijnde luchthaven' : ''
            ].filter(Boolean)
        }));
    }


    /* ============================================================
       RESULTAATFILTERS 3.7.1
       ============================================================ */

    /* ============================================================
   RESULTAATFILTERS 3.7.2
   ============================================================ */

function createResultFilters() {
    return {
        under100: false,
        over48: false,

        /*
         * Geen selectie = beide weekendtypes toegestaan.
         *
         * Mogelijke waarden:
         * fri-mon
         * sat-mon
         */
        weekendTypes: [],

        airports: []
    };
}


function filtersActive(filters) {
    return (
        filters.under100 ||
        filters.over48 ||
        filters.weekendTypes.length > 0 ||
        filters.airports.length > 0
    );
}


/*
 * Verzamel alle bewaarde varianten van één bestemming.
 *
 * Hierdoor kan bijvoorbeeld Ibiza:
 *
 * normaal       → €90 za-ma
 * filter vr-ma  → €116 vr-ma
 */
function getDestinationVariants(result) {
    const candidates =
        [
            ...(result.allVariants || []),

            result,

            result.cheapestVariant,

            ...(result.alternatives || [])
        ];


    const output = [];
    const seen =
        new Set();


    for (
        const variant
        of candidates
    ) {
        if (
            !variant ||
            !Number.isFinite(
                variant.totalPrice ?? variant.price
            )
        ) {
            continue;
        }


        const key =
            flightKey(
                variant
            );


        if (
            seen.has(key)
        ) {
            continue;
        }


        seen.add(key);

        output.push(
            variant
        );
    }


    return output;
}


/*
 * Controleer één concrete vlucht tegen de actieve
 * RESULTAATfilters.
 */
function variantPassesResultFilters(
    variant,
    filters
) {
    /*
     * PRIJS
     */
    if (
        filters.under100 &&
        (variant.totalPrice ?? variant.price) >= 100
    ) {
        return false;
    }


    /*
     * VERBLIJFSDUUR
     */
    if (
        filters.over48 &&
        (variant.effectiveStayHours ?? variant.stayHours) < 48
    ) {
        return false;
    }


    /*
     * WEEKENDTYPE
     *
     * Geen selectie:
     * alles toegestaan.
     *
     * Alleen vr-ma:
     * alleen vrijdag-maandag.
     *
     * Alleen za-ma:
     * alleen zaterdag-maandag.
     *
     * Beide:
     * beide toegestaan.
     */
    if (
        filters.weekendTypes.length &&
        !filters.weekendTypes.includes(
            variant.scenarioId
        )
    ) {
        return false;
    }


    /*
     * VERTREKLUCHTHAVEN
     */
    if (
        filters.airports.length &&
        !filters.airports.includes(
            variant.airport
        )
    ) {
        return false;
    }


    return true;
}


/*
 * Kies binnen de varianten die bij de filters passen
 * opnieuw de beste vlucht.
 *
 * Zelfde filosofie als de gewone Wegwijzer:
 *
 * - zoek goedkoopste passende variant;
 * - kijk maximaal €7 daarboven;
 * - kies binnen die marge meeste tijd op bestemming.
 */
function chooseFilteredVariant(
    result,
    filters
) {
    const variants =
        getDestinationVariants(
            result
        );


    const matching =
        variants.filter(
            variant =>
                variantPassesResultFilters(
                    variant,
                    filters
                )
        );


    if (
        !matching.length
    ) {
        return null;
    }


    const cheapest =
        [...matching]
            .sort(
                compareCheapest
            )[0];


    const near =
        matching.filter(
            variant =>
                (variant.totalPrice ?? variant.price) <=
                (cheapest.totalPrice ?? cheapest.price) +
                CONFIG
                    .nearPriceTolerance
        );


    const recommended =
        [...near]
            .sort(
                compareStay
            )[0] ||
        cheapest;


    const alternatives =
        matching
            .filter(
                variant =>
                    flightKey(
                        variant
                    ) !==
                    flightKey(
                        recommended
                    )
            )
            .sort(
                compareCheapest
            );


    return {
        ...result,
        ...recommended,

        /*
         * De getoonde bodemprijs hoort nu bij de
         * daadwerkelijk actieve filters.
         */
        floorPrice:
            cheapest.price,

        floorTotalPrice:
            cheapest.totalPrice ?? cheapest.price,

        cheapestVariant:
            cheapest,

        recommendationExtra:
            Math.round(
                (
                    (recommended.totalPrice ?? recommended.price) -
                    (cheapest.totalPrice ?? cheapest.price)
                ) *
                100
            ) / 100,

        extraHours:
            Math.round(
                Math.max(
                    0,

                    (recommended.effectiveStayHours ?? recommended.stayHours) -
                    (cheapest.effectiveStayHours ?? cheapest.stayHours)
                ) *
                10
            ) / 10,

        rawDealValue:
            (recommended.effectiveStayHours ?? recommended.stayHours) /
            Math.max(
                recommended.totalPrice ?? recommended.price,
                1
            ),

        alternatives,

        allVariants:
            matching,

        filteredVariant:
            true,

        originalFloorPrice:
            result.floorPrice
    };
}


function applyResultFilters(
    results,
    filters
) {
    if (
        !filtersActive(
            filters
        )
    ) {
        return results;
    }


    const output = [];


    for (
        const result
        of results
    ) {
        const filtered =
            chooseFilteredVariant(
                result,
                filters
            );


        if (filtered) {
            output.push(
                filtered
            );
        }
    }


    return output;
}
    /* ============================================================
       FAVORIETEN
       ============================================================ */

    function loadFavorites() {
        return loadJson(
            CONFIG.storage.favorites,
            {}
        );
    }


    function favoriteId(result) {
        return (
            `${normalize(result.city)}|` +
            `${normalize(result.country)}`
        );
    }


    function isFavorite(result) {
        return Boolean(
            loadFavorites()[
                favoriteId(result)
            ]
        );
    }


    function toggleFavorite(result) {
        const favorites =
            loadFavorites();

        const id =
            favoriteId(result);

        if (
            favorites[id]
        ) {
            delete favorites[id];

        } else {
            favorites[id] = {
                city:
                    result.city,

                country:
                    result.country,

                lastPrice:
                    result.floorPrice,

                link:
                    result.link,

                saved:
                    Date.now()
            };
        }

        saveJson(
            CONFIG.storage.favorites,
            favorites
        );

        return Boolean(
            favorites[id]
        );
    }


    /* ============================================================
       PRIJSHISTORIE
       ============================================================ */

    function loadHistory() {
        return loadJson(
            CONFIG.storage.history,
            {}
        );
    }


    function historyId(
        saturday,
        result
    ) {
        return (
            `${weekendKey(saturday)}|` +
            `${normalize(result.city)}`
        );
    }


    function addHistoryData(
        saturday,
        grouped
    ) {
        const history =
            loadHistory();

        return grouped.map(
            result => {
                const id =
                    historyId(
                        saturday,
                        result
                    );

                const entries =
                    history[id] ||
                    [];

                const previous =
                    entries.length
                        ? entries[
                            entries.length - 1
                        ].price
                        : null;

                return {
                    ...result,

                    previousPrice:
                        previous,

                    priceDifference:
                        Number.isFinite(
                            previous
                        )
                            ? Math.round(
                                (
                                    result.floorPrice -
                                    previous
                                ) *
                                100
                            ) / 100
                            : null
                };
            }
        );
    }


    function saveCurrentPrices(
        saturday,
        grouped
    ) {
        const history =
            loadHistory();

        for (
            const result
            of grouped
        ) {
            const id =
                historyId(
                    saturday,
                    result
                );

            if (
                !Array.isArray(
                    history[id]
                )
            ) {
                history[id] = [];
            }

            const entries =
                history[id];

            const last =
                entries[
                    entries.length - 1
                ];

            if (
                !last ||
                Math.abs(
                    last.price -
                    result.floorPrice
                ) > 0.001
            ) {
                entries.push({
                    time:
                        Date.now(),

                    price:
                        result.floorPrice
                });
            }

            history[id] =
                entries.slice(
                    -20
                );
        }

        saveJson(
            CONFIG.storage.history,
            history
        );
    }


    function priceChangeHtml(result) {
        if (
    result.filteredVariant &&
    Number.isFinite(
        result.originalFloorPrice
    ) &&
    Math.abs(
        result.floorPrice -
        result.originalFloorPrice
    ) > 0.001
) {
    return '';
}
        const difference =
            result.priceDifference;

        if (
            !Number.isFinite(
                difference
            ) ||
            difference === 0
        ) {
            return '';
        }

        if (
            difference < 0
        ) {
            return `
                <span style="
                    padding:3px 6px;
                    border-radius:5px;
                    background:rgba(34,197,94,.15);
                    font-size:10px;
                ">
                    ↓
                    ${euro(
                        Math.abs(
                            difference
                        )
                    )}
                    sinds vorige scan
                </span>
            `;
        }

        return `
            <span style="
                padding:3px 6px;
                border-radius:5px;
                background:rgba(245,158,11,.15);
                font-size:10px;
            ">
                ↑
                ${euro(difference)}
                sinds vorige scan
            </span>
        `;
    }


    /* ============================================================
       WEEKEND STATE
       ============================================================ */

    function createWeekendState(
        saturday,
        settings
    ) {
        const scenarios =
            createScenarios(
                saturday,
                settings
            );

        const scenarioStates =
            new Map();

        scenarios.forEach(
            scenario => {
                scenarioStates.set(
                    scenario.id,
                    {
                        scenario,

                        exploreResults: [],

                        countriesTotal: 0,
                        countriesCompleted: 0,

                        discoveredCities: [],

                        cityKeys:
                            new Set(),

                        scheduledCityKeys:
                            new Set(),

                        scheduledFlights: 0,

                        completedFlights: 0
                    }
                );
            }
        );

        return {
            saturday,
            settings,
            scenarios,
            scenarioStates,
            flights: []
        };
    }


    /* ============================================================
       STATS + TIMINGS + TRACE
       ============================================================ */

    function emptyStats() {
        return {
            exploreTotal: 0,
            exploreDone: 0,

            countryTotal: 0,
            countryDone: 0,

            flightScheduled: 0,
            flightDone: 0,
            flightFirstPassDone: 0,

            json: 0,
            dom: 0,

            noResult: 0,

            timeout: 0,
            error: 0,
            blocked: 0,

            cacheHits: 0,

            retries: 0,
            retryRecovered: 0,
            retryFailed: 0,

            uniqueFound: 0
        };
    }


    function emptyTimings() {
        return {
            firstResultAt: null,

            exploreStarted: null,
            exploreEnded: null,

            countryStarted: null,
            countryEnded: null,

            flightStarted: null,
            flightEnded: null
        };
    }


    function traceCountry(data) {
        if (
            !activeScan?.trace
        ) {
            return;
        }

        activeScan
            .trace
            .countries
            .push({
                time:
                    Date.now(),

                ...data
            });
    }


    function traceCity(data) {
        if (
            !activeScan?.trace
        ) {
            return;
        }

        activeScan
            .trace
            .cities
            .push({
                time:
                    Date.now(),

                ...data
            });
    }


    function updateCityTrace(
        predicate,
        patch
    ) {
        if (
            !activeScan?.trace
        ) {
            return;
        }

        const item =
            [
                ...activeScan
                    .trace
                    .cities
            ]
                .reverse()
                .find(
                    predicate
                );

        if (item) {
            Object.assign(
                item,
                patch
            );
        }
    }


    function registerSource(source) {
        if (!activeScan) {
            return;
        }

        const stats =
            activeScan.stats;

        if (
            source === 'JSON'
        ) {
            stats.json++;

        } else if (
            source === 'DOM'
        ) {
            stats.dom++;

        } else if (
            source === 'NO_RESULT'
        ) {
            stats.noResult++;

        } else if (
            source === 'TIMEOUT' ||
            source === 'PARENT_TIMEOUT'
        ) {
            stats.timeout++;

        } else if (
            source === 'ERROR'
        ) {
            stats.error++;

        } else if (['BOT_CHECK', 'ACCESS_BLOCKED', 'RATE_LIMITED', 'COOKIE_WALL'].includes(source)) {
            stats.blocked++;
        }
    }


    function updateUniqueCount(states) {
        if (!activeScan) {
            return;
        }

        activeScan
            .stats
            .uniqueFound =
            states.reduce(
                (
                    total,
                    state
                ) =>
                    total +
                    groupDestinations(
                        state.flights
                    ).length,

                0
            );
    }

    function updateProgressivePreview(states) {
        const target = document.querySelector('#weekend-wegwijzer #ww-progressive-preview');
        if (!target) return;
        const partial = states.flatMap(state => groupDestinations(state.flights));
        const ranked = addRecommendationTags(sortDestinations(partial, 'deal')).slice(0, 3);
        if (!ranked.length) return;
        if (activeScan && !activeScan.timings.firstResultAt) {
            activeScan.timings.firstResultAt = Date.now();
        }
        target.style.display = 'block';
        const canFinish = (activeScan?.stats?.uniqueFound || 0) >= CONFIG.topCount;
        target.innerHTML = `<strong>Al gevonden</strong>${ranked.map(result => `
            <div style="display:flex;justify-content:space-between;gap:8px;margin-top:5px">
                <span>${escapeHtml(result.city)} · ${formatHours(result.effectiveStayHours ?? result.stayHours)}</span>
                <strong>${euro(result.floorTotalPrice ?? result.floorPrice)}</strong>
            </div>`).join('')}${canFinish ? `
                <button id="ww-finish-early" type="button" style="width:100%;margin-top:8px;padding:7px;border:0;border-radius:7px;cursor:pointer;font-weight:700">
                    Toon deze resultaten nu
                </button>` : ''}`;

        target.querySelector('#ww-finish-early')?.addEventListener('click', () => {
            if (!activeScan || activeScan.finishEarly) return;
            activeScan.finishEarly = true;
            activeScan.phase = 'finishing';
            activeScan.queue?.cancelQueued();
            target.querySelector('#ww-finish-early')?.remove();
        });
    }


    /* ============================================================
       PANEEL
       ============================================================ */

    function getPanel() {
        let panel =
            document.getElementById(
                'weekend-wegwijzer'
            );

        if (panel) {
            return panel;
        }

        panel =
            document.createElement(
                'div'
            );

        panel.id =
            'weekend-wegwijzer';

        Object.assign(
            panel.style,
            {
                position:
                    'fixed',

                width:
                    '540px',

                maxWidth:
                    'calc(100vw - 20px)',

                maxHeight:
                    '84vh',

                overflow:
                    'hidden',

                zIndex:
                    '999999',

                padding:
                    '0',

                color:
                    '#fff',

                background:
                    'linear-gradient(180deg, rgba(10,22,43,.985), rgba(17,30,53,.985))',

                border:
                    '1px solid rgba(255,255,255,.08)',

                borderRadius:
                    '16px',

                boxShadow:
                    '0 16px 45px rgba(0,0,0,.38)',

                fontFamily:
                    'Arial,sans-serif',

                fontSize:
                    '14px',

                lineHeight:
                    '1.45'
            }
        );

        if (
            Number.isFinite(
                panelState.left
            ) &&
            Number.isFinite(
                panelState.top
            )
        ) {
            panel.style.left =
                `${panelState.left}px`;

            panel.style.top =
                `${panelState.top}px`;

        } else {
            panel.style.right =
                '18px';

            panel.style.top =
                '70px';
        }

        document.body.appendChild(
            panel
        );

        makePanelDraggable(
            panel
        );

        return panel;
    }


    function headerHtml(subtitle) {
        return `
            <div
                id="ww-dragbar"
                style="
                    display:flex;
                    align-items:center;
                    justify-content:space-between;
                    gap:10px;
                    padding:13px 14px;
                    cursor:move;
                    user-select:none;
                    border-bottom:1px solid rgba(255,255,255,.06);
                "
            >
                <div style="
                    display:flex;
                    align-items:center;
                    gap:10px;
                    min-width:0;
                ">
                    <div style="
                        width:38px;
                        height:38px;
                        min-width:38px;
                        display:flex;
                        align-items:center;
                        justify-content:center;
                        border-radius:11px;
                        background:rgba(255,255,255,.1);
                        font-size:21px;
                    ">
                        ✈
                    </div>

                    <div style="
                        min-width:0;
                    ">
                        <div style="
                            font-size:20px;
                            font-weight:800;
                            white-space:nowrap;
                        ">
                            Weekend Wegwijzer
                        </div>

                        <div style="
                            font-size:11px;
                            opacity:.65;
                            overflow:hidden;
                            white-space:nowrap;
                            text-overflow:ellipsis;
                        ">
                            ${escapeHtml(
                                subtitle
                            )}
                        </div>
                    </div>
                </div>

                <button
                    id="ww-minimize"
                    style="
                        width:34px;
                        height:34px;
                        min-width:34px;
                        border:0;
                        border-radius:8px;
                        cursor:pointer;
                        color:#fff;
                        background:rgba(255,255,255,.09);
                        font-size:20px;
                    "
                >
                    ${
                        panelState.minimized
                            ? '+'
                            : '−'
                    }
                </button>
            </div>

            <div
                id="ww-content"
                style="
                    display:${
                        panelState.minimized
                            ? 'none'
                            : 'block'
                    };
                    max-height:calc(84vh - 66px);
                    overflow-y:auto;
                    padding:16px;
                "
            >
        `;
    }


    function closeContent() {
        return '</div>';
    }


    function setupPanelControls(panel) {
        const button =
            panel.querySelector(
                '#ww-minimize'
            );

        const content =
            panel.querySelector(
                '#ww-content'
            );

        if (
            !button ||
            !content
        ) {
            return;
        }

        button.onclick =
            event => {
                event.stopPropagation();

                panelState.minimized =
                    !panelState.minimized;

                content.style.display =
                    panelState.minimized
                        ? 'none'
                        : 'block';

                button.textContent =
                    panelState.minimized
                        ? '+'
                        : '−';

                saveJson(
                    CONFIG.storage.panel,
                    panelState
                );
            };
    }


    function makePanelDraggable(panel) {
        let dragging = false;

        let startX = 0;
        let startY = 0;

        let startLeft = 0;
        let startTop = 0;

        panel.addEventListener(
            'mousedown',
            event => {
                const dragbar =
                    event.target.closest(
                        '#ww-dragbar'
                    );

                if (
                    !dragbar ||
                    event.target.closest(
                        'button'
                    )
                ) {
                    return;
                }

                const rect =
                    panel
                        .getBoundingClientRect();

                panel.style.right =
                    'auto';

                panel.style.left =
                    `${rect.left}px`;

                panel.style.top =
                    `${rect.top}px`;

                dragging =
                    true;

                startX =
                    event.clientX;

                startY =
                    event.clientY;

                startLeft =
                    rect.left;

                startTop =
                    rect.top;

                event.preventDefault();
            }
        );

        window.addEventListener(
            'mousemove',
            event => {
                if (!dragging) {
                    return;
                }

                const left =
                    Math.max(
                        0,

                        Math.min(
                            window.innerWidth -
                            panel.offsetWidth,

                            startLeft +
                            event.clientX -
                            startX
                        )
                    );

                const top =
                    Math.max(
                        0,

                        Math.min(
                            window.innerHeight -
                            60,

                            startTop +
                            event.clientY -
                            startY
                        )
                    );

                panel.style.left =
                    `${left}px`;

                panel.style.top =
                    `${top}px`;
            }
        );

        window.addEventListener(
            'mouseup',
            () => {
                if (!dragging) {
                    return;
                }

                dragging =
                    false;

                const rect =
                    panel
                        .getBoundingClientRect();

                panelState.left =
                    rect.left;

                panelState.top =
                    rect.top;

                saveJson(
                    CONFIG.storage.panel,
                    panelState
                );
            }
        );
    }


    /* ============================================================
       INSTELLINGEN
       ============================================================ */

    function settingsHtml(settings) {
        return `
            <details style="
                margin-top:10px;
                padding:11px;
                border-radius:11px;
                background:rgba(255,255,255,.055);
            ">
                <summary style="
                    cursor:pointer;
                    font-weight:700;
                ">
                    ⚙ Zoekinstellingen
                </summary>

                <div style="
                    margin-top:11px;
                    font-size:10px;
                    opacity:.55;
                ">
                    VERTREKLUCHTHAVENS
                </div>

                <div style="
                    display:flex;
                    flex-wrap:wrap;
                    gap:12px;
                    margin-top:5px;
                ">
                    ${
                        CONFIG.airports
                            .map(
                                airport => `
                                    <label style="
                                        display:flex;
                                        align-items:center;
                                        gap:4px;
                                        font-size:12px;
                                    ">
                                        <input
                                            class="ww-search-airport"
                                            type="checkbox"
                                            value="${airport}"
                                            ${
                                                settings
                                                    .airports
                                                    .includes(
                                                        airport
                                                    )
                                                    ? 'checked'
                                                    : ''
                                            }
                                        >

                                        ${airport}
                                    </label>
                                `
                            )
                            .join('')
                    }
                </div>

                <div style="
                    display:grid;
                    grid-template-columns:1fr 1fr;
                    gap:8px;
                    margin-top:12px;
                ">
                    <label style="
                        font-size:11px;
                    ">
                        Maximumbudget

                        <input
                            id="ww-budget"
                            type="number"
                            min="0"
                            step="10"
                            placeholder="Geen limiet"
                            value="${
                                settings.maxBudget ||
                                ''
                            }"
                            style="
                                width:100%;
                                box-sizing:border-box;
                                margin-top:4px;
                                padding:8px;
                                border:0;
                                border-radius:7px;
                            "
                        >
                    </label>

                    <label style="
                        font-size:11px;
                    ">
                        Minimaal verblijf

                        <select
                            id="ww-minstay"
                            style="
                                width:100%;
                                box-sizing:border-box;
                                margin-top:4px;
                                padding:8px;
                                border:0;
                                border-radius:7px;
                            "
                        >
                            <option value="0">
                                Geen minimum
                            </option>

                            <option value="24">
                                24 uur
                            </option>

                            <option value="36">
                                36 uur
                            </option>

                            <option value="48">
                                48 uur
                            </option>

                            <option value="60">
                                60 uur
                            </option>
                        </select>
                    </label>

                    <label style="
                        grid-column:1 / -1;
                        font-size:11px;
                    ">
                        Maandag niet vóór

                        <select
                            id="ww-earliest-return"
                            style="
                                width:100%;
                                box-sizing:border-box;
                                margin-top:4px;
                                padding:8px;
                                border:0;
                                border-radius:7px;
                            "
                        >
                            <option value="">
                                Geen minimumtijd
                            </option>

                            <option value="12:00">
                                12:00
                            </option>

                            <option value="15:00">
                                15:00
                            </option>

                            <option value="17:00">
                                17:00
                            </option>

                            <option value="19:00">
                                19:00
                            </option>
                        </select>
                    </label>
                </div>

                <div style="margin-top:13px;font-size:10px;opacity:.55">EERLIJKE REISVERGELIJKING</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px">
                    <label style="font-size:11px">Uiterlijk thuis
                        <input id="ww-home-deadline" type="time" value="${settings.homeDeadline || CONFIG.defaultHomeDeadline}" style="width:100%;box-sizing:border-box;margin-top:4px;padding:8px;border:0;border-radius:7px">
                    </label>
                    <label style="font-size:11px">Marge na landing
                        <input id="ww-home-margin" type="number" min="0" step="15" value="${settings.homeArrivalMarginMinutes}" style="width:100%;box-sizing:border-box;margin-top:4px;padding:8px;border:0;border-radius:7px">
                    </label>
                    <label style="font-size:11px">Reizigers
                        <input id="ww-travelers" type="number" min="1" max="9" value="${settings.travelers}" style="width:100%;box-sizing:border-box;margin-top:4px;padding:8px;border:0;border-radius:7px">
                    </label>
                    <label style="font-size:11px">Bagage
                        <select id="ww-baggage" style="width:100%;box-sizing:border-box;margin-top:4px;padding:8px;border:0;border-radius:7px">
                            <option value="personal" ${settings.baggage === 'personal' ? 'selected' : ''}>Alleen kleine tas</option>
                            <option value="cabin" ${settings.baggage === 'cabin' ? 'selected' : ''}>Cabinebagage</option>
                            <option value="checked" ${settings.baggage === 'checked' ? 'selected' : ''}>Ruimbagage</option>
                        </select>
                    </label>
                    <label style="font-size:11px">Bagage p.p. retour
                        <input id="ww-baggage-cost" type="number" min="0" step="1" value="${settings.baggageCostPerTraveler || ''}" placeholder="Onbekend" style="width:100%;box-sizing:border-box;margin-top:4px;padding:8px;border:0;border-radius:7px">
                    </label>
                    <label style="font-size:11px">Overige boekingskosten
                        <input id="ww-booking-fees" type="number" min="0" step="1" value="${settings.bookingFees || ''}" style="width:100%;box-sizing:border-box;margin-top:4px;padding:8px;border:0;border-radius:7px">
                    </label>
                    <label style="font-size:11px">Vluchten
                        <select id="ww-max-stops" style="width:100%;box-sizing:border-box;margin-top:4px;padding:8px;border:0;border-radius:7px">
                            <option value="0" ${settings.maxStops === 0 ? 'selected' : ''}>Alleen rechtstreeks</option>
                            <option value="1" ${settings.maxStops === 1 ? 'selected' : ''}>Maximaal 1 overstap</option>
                        </select>
                    </label>
                    <label style="font-size:11px">Transfer bestemming (enkele reis)
                        <input id="ww-destination-transfer" type="number" min="0" step="5" value="${settings.destinationTransferMinutes}" style="width:100%;box-sizing:border-box;margin-top:4px;padding:8px;border:0;border-radius:7px">
                    </label>
                    <label style="grid-column:1/-1;font-size:11px">Voor de terugvlucht op luchthaven
                        <input id="ww-return-buffer" type="number" min="30" step="15" value="${settings.returnAirportBufferMinutes}" style="width:100%;box-sizing:border-box;margin-top:4px;padding:8px;border:0;border-radius:7px">
                    </label>
                </div>

                <div style="margin-top:12px;font-size:10px;opacity:.55">NAAR DE VERTREKLUCHTHAVEN · RETOURKOSTEN EN ENKELE-REISTIJD</div>
                <div style="display:grid;grid-template-columns:auto 1fr 1fr;gap:6px;align-items:center;margin-top:6px">
                    ${CONFIG.airports.map(airport => {
                        const access = airportAccessFor(settings, airport);
                        return `<strong>${airport}</strong>
                            <input class="ww-access-minutes" data-airport="${airport}" type="number" min="0" step="5" value="${access.minutes || ''}" placeholder="minuten" style="width:100%;box-sizing:border-box;padding:7px;border:0;border-radius:7px">
                            <input class="ww-access-cost" data-airport="${airport}" type="number" min="0" step="1" value="${access.cost || ''}" placeholder="€ retour" style="width:100%;box-sizing:border-box;padding:7px;border:0;border-radius:7px">`;
                    }).join('')}
                </div>
                <div style="margin-top:6px;font-size:9px;opacity:.58">
                    De thuiskomstgrens gebruikt landing + enkele-reistijd + marge. Bij 0 minuten is de luchthavenrit nog niet meegerekend.
                </div>
            </details>
        `;
    }


    function applySettingsToForm(
        panel,
        settings
    ) {
        const minStay =
            panel.querySelector(
                '#ww-minstay'
            );

        const earliestReturn =
            panel.querySelector(
                '#ww-earliest-return'
            );

        if (minStay) {
            minStay.value =
                String(
                    settings.minStayHours
                );
        }

        if (earliestReturn) {
            earliestReturn.value =
                settings.earliestReturn;
        }
    }


    function readSettingsFromForm(panel) {
        const current =
            loadSettings();

        const airports =
            [
                ...panel.querySelectorAll(
                    '.ww-search-airport:checked'
                )
            ]
                .map(
                    input =>
                        input.value
                );

        const settings = {
            ...current,

            airports:
                airports.length
                    ? airports
                    : [...CONFIG.airports],

            maxBudget:
                Number(
                    panel
                        .querySelector(
                            '#ww-budget'
                        )
                        ?.value ||
                    0
                ),

            minStayHours:
                Number(
                    panel
                        .querySelector(
                            '#ww-minstay'
                        )
                        ?.value ||
                    0
                ),

            earliestReturn:
                panel
                    .querySelector(
                        '#ww-earliest-return'
                    )
                    ?.value ||
                '',

            homeDeadline:
                panel.querySelector('#ww-home-deadline')?.value ||
                CONFIG.defaultHomeDeadline,

            homeArrivalMarginMinutes:
                Math.max(0, Number(panel.querySelector('#ww-home-margin')?.value) || 0),

            travelers: Math.max(1, Number(panel.querySelector('#ww-travelers')?.value) || 1),
            baggage: panel.querySelector('#ww-baggage')?.value || 'personal',
            baggageCostPerTraveler: Math.max(0, Number(panel.querySelector('#ww-baggage-cost')?.value) || 0),
            bookingFees: Math.max(0, Number(panel.querySelector('#ww-booking-fees')?.value) || 0),
            maxStops: Math.min(1, Math.max(0, Number(panel.querySelector('#ww-max-stops')?.value) || 0)),
            destinationTransferMinutes: Math.max(0, Number(panel.querySelector('#ww-destination-transfer')?.value) || 0),
            returnAirportBufferMinutes: Math.max(30, Number(panel.querySelector('#ww-return-buffer')?.value) || 120),
            airportAccess: Object.fromEntries(CONFIG.airports.map(airport => [airport, {
                minutes: Math.max(0, Number(panel.querySelector(`.ww-access-minutes[data-airport="${airport}"]`)?.value) || 0),
                cost: Math.max(0, Number(panel.querySelector(`.ww-access-cost[data-airport="${airport}"]`)?.value) || 0)
            }]))
        };

        saveSettings(
            settings
        );

        return settings;
    }


    /* ============================================================
       FAVORIETEN STARTSCHERM
       ============================================================ */

    function favoritesHtml() {
        const favorites =
            Object.entries(
                loadFavorites()
            );

        if (
            !favorites.length
        ) {
            return '';
        }

        return `
            <details style="
                margin-top:10px;
                padding:11px;
                border-radius:11px;
                background:rgba(255,255,255,.055);
            ">
                <summary style="
                    cursor:pointer;
                    font-weight:700;
                ">
                    ⭐ Favorieten
                    (${favorites.length})
                </summary>

                <div
                    id="ww-favorites-list"
                    style="
                        margin-top:7px;
                    "
                >
                    ${
                        favorites
                            .map(
                                ([id, favorite]) => `
                                    <div
                                        class="ww-favorite-row"
                                        data-id="${escapeHtml(id)}"
                                        style="
                                            display:flex;
                                            align-items:center;
                                            justify-content:space-between;
                                            gap:8px;
                                            padding:7px 0;
                                            border-bottom:1px solid rgba(255,255,255,.05);
                                        "
                                    >
                                        <div
                                            class="ww-favorite-open"
                                            style="
                                                flex:1;
                                                cursor:pointer;
                                            "
                                        >
                                            <strong>
                                                ${
                                                    escapeHtml(
                                                        favorite.city
                                                    )
                                                }
                                            </strong>

                                            <span style="
                                                margin-left:4px;
                                                font-size:10px;
                                                opacity:.55;
                                            ">
                                                ${
                                                    escapeHtml(
                                                        favorite.country
                                                    )
                                                }
                                            </span>

                                            <div style="
                                                margin-top:2px;
                                                font-size:10px;
                                                opacity:.6;
                                            ">
                                                laatst
                                                ${
                                                    euro(
                                                        favorite.lastPrice
                                                    )
                                                }
                                            </div>
                                        </div>

                                        <button
                                            class="ww-favorite-remove"
                                            data-id="${escapeHtml(id)}"
                                            style="
                                                border:0;
                                                padding:4px 6px;
                                                border-radius:6px;
                                                cursor:pointer;
                                                color:white;
                                                background:rgba(239,68,68,.12);
                                            "
                                        >
                                            ×
                                        </button>
                                    </div>
                                `
                            )
                            .join('')
                    }
                </div>
            </details>
        `;
    }


    /* ============================================================
       STARTSCHERM
       ============================================================ */

    function renderStart() {
        activeScan =
            null;

        const panel =
            getPanel();

        const settings =
            loadSettings();

        const saturday =
            nextSaturday();

        const friday =
            addDays(
                saturday,
                -1
            );

        const monday =
            addDays(
                saturday,
                2
            );

        const monthValue =
            `${friday.getFullYear()}-${
                String(
                    friday.getMonth() + 1
                ).padStart(2, '0')
            }`;

        panel.innerHTML = `
            ${headerHtml(
                'Wanneer kun je weg?'
            )}

            <div style="
                padding:14px;
                border-radius:12px;
                background:rgba(255,255,255,.075);
            ">
                <div style="
                    font-size:10px;
                    opacity:.55;
                ">
                    KOMEND WEEKEND
                </div>

                <div style="
                    margin-top:2px;
                    font-size:20px;
                    font-weight:800;
                ">
                    ${formatDate(friday)}
                    →
                    ${formatDate(monday)}
                </div>

                <div style="
                    margin-top:7px;
                    font-size:12px;
                    opacity:.72;
                ">
                    ${
                        isLastFridayOfMonth(
                            friday
                        )
                            ? '🌅 Lang weekend: donderdag vanaf 21:30, vrijdag de hele dag en zaterdag.'
                            : '🌙 Vrijdagvluchten tellen mee vanaf 21:30; zaterdag blijft een alternatief.'
                    }
                    <br>🏠 Maandag uiterlijk ${escapeHtml(settings.homeDeadline || CONFIG.defaultHomeDeadline)} thuis.
                </div>

                <button
                    id="ww-start"
                    style="
                        width:100%;
                        margin-top:12px;
                        padding:12px;
                        border:0;
                        border-radius:9px;
                        cursor:pointer;
                        font-weight:800;
                        font-size:14px;
                    "
                >
                    ✈ Vind mijn weekend
                </button>
            </div>


            <div style="
                margin-top:10px;
                padding:13px;
                border-radius:11px;
                background:rgba(255,255,255,.055);
            ">
                <strong>📅 Eigen reisperiode</strong>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:8px">
                    <label style="font-size:10px">Heenreis
                        <input id="ww-custom-outbound-date" type="date" value="${toInputDate(friday)}" style="width:100%;box-sizing:border-box;margin-top:4px;padding:8px;border:0;border-radius:7px">
                    </label>
                    <label style="font-size:10px">Vertrek vanaf (optioneel)
                        <input id="ww-custom-outbound-time" type="time" value="" style="width:100%;box-sizing:border-box;margin-top:4px;padding:8px;border:0;border-radius:7px">
                    </label>
                    <label style="font-size:10px">Terugreis
                        <input id="ww-custom-inbound-date" type="date" value="${toInputDate(monday)}" style="width:100%;box-sizing:border-box;margin-top:4px;padding:8px;border:0;border-radius:7px">
                    </label>
                    <label style="font-size:10px">Uiterlijk thuis (optioneel)
                        <input id="ww-custom-home-time" type="time" value="" style="width:100%;box-sizing:border-box;margin-top:4px;padding:8px;border:0;border-radius:7px">
                    </label>
                </div>

                <button
                    id="ww-custom-start"
                    style="
                        width:100%;
                        margin-top:8px;
                        padding:9px;
                        border:0;
                        border-radius:8px;
                        cursor:pointer;
                        font-weight:700;
                    "
                >
                    Zoek deze periode
                </button>
            </div>


            <div style="
                margin-top:10px;
                padding:13px;
                border-radius:11px;
                background:rgba(255,255,255,.055);
            ">
                <strong>
                    🗓 Weekendkalender
                </strong>

                <div style="
                    margin-top:5px;
                    font-size:11px;
                    opacity:.65;
                ">
                    Vergelijk meerdere weekenden
                    met één gezamenlijke zoekopdracht.
                </div>

                <button
                    id="ww-six-weekends"
                    style="
                        width:100%;
                        margin-top:9px;
                        padding:9px;
                        border:0;
                        border-radius:8px;
                        cursor:pointer;
                        font-weight:700;
                    "
                >
                    Bekijk komende 6 weekenden
                </button>

                <div style="
                    display:grid;
                    grid-template-columns:1fr auto;
                    gap:7px;
                    margin-top:7px;
                ">
                    <input
                        id="ww-month"
                        type="month"
                        value="${monthValue}"
                        style="
                            width:100%;
                            box-sizing:border-box;
                            padding:8px;
                            border:0;
                            border-radius:7px;
                        "
                    >

                    <button
                        id="ww-month-start"
                        style="
                            padding:8px 12px;
                            border:0;
                            border-radius:7px;
                            cursor:pointer;
                            font-weight:700;
                        "
                    >
                        Scan
                    </button>
                </div>
            </div>

            ${settingsHtml(settings)}

            ${favoritesHtml()}

            ${closeContent()}
        `;

        setupPanelControls(
            panel
        );

        applySettingsToForm(
            panel,
            settings
        );

        panel
            .querySelector(
                '#ww-start'
            )
            ?.addEventListener(
                'click',
                () => {
                    startSingleScan(
                        saturday,

                        readSettingsFromForm(
                            panel
                        )
                    );
                }
            );

        panel
            .querySelector(
                '#ww-custom-start'
            )
            ?.addEventListener(
                'click',
                () => {
                    const outboundDate = panel.querySelector('#ww-custom-outbound-date')?.value;
                    const inboundDate = panel.querySelector('#ww-custom-inbound-date')?.value;

                    if (!outboundDate || !inboundDate || inboundDate < outboundDate) {
                        return;
                    }

                    const selected = new Date(`${outboundDate}T12:00:00`);
                    const customSettings = readSettingsFromForm(panel);
                    customSettings.customWindow = {
                        active: true,
                        outboundDate,
                        inboundDate,
                        earliestDeparture: panel.querySelector('#ww-custom-outbound-time')?.value || '',
                        homeDeadline: panel.querySelector('#ww-custom-home-time')?.value || ''
                    };

                    startSingleScan(
                        selected,
                        customSettings
                    );
                }
            );

        panel
            .querySelector(
                '#ww-six-weekends'
            )
            ?.addEventListener(
                'click',
                () => {
                    startCalendarScan(
                        upcomingSaturdays(
                            CONFIG
                                .multiWeekendCount
                        ),

                        readSettingsFromForm(
                            panel
                        ),

                        'Komende 6 weekenden'
                    );
                }
            );

        panel
            .querySelector(
                '#ww-month-start'
            )
            ?.addEventListener(
                'click',
                () => {
                    const value =
                        panel
                            .querySelector(
                                '#ww-month'
                            )
                            ?.value;

                    if (!value) {
                        return;
                    }

                    const [
                        year,
                        month
                    ] =
                        value
                            .split('-')
                            .map(
                                Number
                            );

                    startCalendarScan(
                        saturdaysInMonth(
                            year,
                            month - 1
                        ),

                        readSettingsFromForm(
                            panel
                        ),

                        new Intl.DateTimeFormat(
                            'nl-NL',
                            {
                                month:
                                    'long',

                                year:
                                    'numeric'
                            }
                        ).format(
                            new Date(
                                year,
                                month - 1,
                                1
                            )
                        )
                    );
                }
            );

        panel
            .querySelectorAll(
                '.ww-favorite-open'
            )
            .forEach(
                element => {
                    element.addEventListener(
                        'click',
                        () => {
                            const row =
                                element.closest(
                                    '.ww-favorite-row'
                                );

                            const id =
                                row
                                    ?.dataset
                                    ?.id;

                            const favorite =
                                loadFavorites()[
                                    id
                                ];

                            if (
                                favorite?.link
                            ) {
                                openSkyscannerResult(
                                    favorite.link
                                );
                            }
                        }
                    );
                }
            );

        panel
            .querySelectorAll(
                '.ww-favorite-remove'
            )
            .forEach(
                button => {
                    button.addEventListener(
                        'click',
                        event => {
                            event.stopPropagation();

                            const favorites =
                                loadFavorites();

                            delete favorites[
                                button.dataset.id
                            ];

                            saveJson(
                                CONFIG.storage.favorites,
                                favorites
                            );

                            renderStart();
                        }
                    );
                }
            );
    }


    /* ============================================================
       SCAN PROGRESS
       ============================================================ */

    function renderScanShell(
        weekends
    ) {
        const panel =
            getPanel();

        panel.innerHTML = `
            ${headerHtml(
                'Je reisvenster wordt onderzocht'
            )}

            ${
                weekends.length > 1
                    ? `
                        <div style="
                            margin-bottom:10px;
                            padding:8px 10px;
                            border-radius:8px;
                            background:rgba(255,255,255,.06);
                            font-size:11px;
                        ">
                            🗓
                            <strong>
                                ${weekends.length}
                                weekenden
                            </strong>
                            worden tegelijk vergeleken
                        </div>
                    `
                    : `
                        <div style="
                            margin-bottom:10px;
                            font-size:13px;
                            font-weight:700;
                        ">
                            ${
                                formatAvailability(
                                    weekends[0],
                                    activeScan?.settings
                                )
                            }
                        </div>
                    `
            }

            <div style="
                display:flex;
                justify-content:space-between;
                align-items:flex-end;
            ">
                <div>
                    <div
                        id="ww-progress-percent"
                        style="
                            font-size:27px;
                            font-weight:800;
                        "
                    >
                        0%
                    </div>

                    <div style="
                        font-size:10px;
                        opacity:.55;
                    ">
                        VOORTGANG
                    </div>
                </div>

                <div
                    id="ww-progress-time"
                    style="
                        font-size:12px;
                        opacity:.68;
                    "
                >
                    0 sec
                </div>
            </div>

            <div style="
                height:8px;
                margin-top:8px;
                border-radius:999px;
                overflow:hidden;
                background:rgba(255,255,255,.1);
            ">
                <div
                    id="ww-progress-bar"
                    style="
                        width:0%;
                        height:100%;
                        border-radius:999px;
                        background:linear-gradient(
                            90deg,
                            #38bdf8,
                            #60a5fa
                        );
                    "
                ></div>
            </div>

            <div style="
                display:grid;
                grid-template-columns:1fr 1fr 1fr;
                gap:7px;
                margin-top:12px;
            ">
                <div style="
                    padding:9px;
                    border-radius:8px;
                    background:rgba(255,255,255,.06);
                ">
                    <div style="
                        font-size:9px;
                        opacity:.5;
                    ">
                        GEVONDEN
                    </div>

                    <strong
                        id="ww-stat-found"
                    >
                        0
                    </strong>
                </div>

                <div style="
                    padding:9px;
                    border-radius:8px;
                    background:rgba(255,255,255,.06);
                ">
                    <div style="
                        font-size:9px;
                        opacity:.5;
                    ">
                        ROUTES KLAAR
                    </div>

                    <strong
                        id="ww-stat-routes"
                    >
                        0
                    </strong>
                </div>

                <div style="
                    padding:9px;
                    border-radius:8px;
                    background:rgba(255,255,255,.06);
                ">
                    <div style="
                        font-size:9px;
                        opacity:.5;
                    ">
                        RETRIES
                    </div>

                    <strong
                        id="ww-stat-retries"
                    >
                        0
                    </strong>
                </div>
            </div>

            <div style="
                margin-top:10px;
                padding:12px;
                border-radius:9px;
                background:rgba(255,255,255,.07);
            ">
                <strong
                    id="ww-progress-title"
                >
                    Zoeken gestart
                </strong>

                <div
                    id="ww-progress-detail"
                    style="
                        margin-top:5px;
                        font-size:11px;
                        opacity:.7;
                    "
                >
                    De eerste bestemmingen worden verzameld…
                </div>
            </div>

            <div id="ww-progressive-preview" style="display:none;margin-top:10px;padding:10px;border-radius:9px;background:rgba(34,197,94,.10);font-size:10px"></div>

            <button
                id="ww-stop"
                style="
                    width:100%;
                    margin-top:9px;
                    padding:8px;
                    border:0;
                    border-radius:8px;
                    cursor:pointer;
                    color:white;
                    background:rgba(239,68,68,.16);
                "
            >
                Stop zoeken
            </button>

            ${closeContent()}
        `;

        setupPanelControls(
            panel
        );

        panel
            .querySelector(
                '#ww-stop'
            )
            ?.addEventListener(
                'click',
                stopScan
            );
    }


    function setText(
        selector,
        value
    ) {
        const element =
            document.querySelector(
                `#weekend-wegwijzer ${selector}`
            );

        if (element) {
            element.textContent =
                value;
        }
    }


    function updateProgressUi() {
        if (
            !activeScan ||
            activeScan.cancelled
        ) {
            return;
        }

        const stats =
            activeScan.stats;

        let percent = 0;
        let title = '';
        let detail = '';

        if (
            activeScan.phase ===
            'explore'
        ) {
            percent =
                stats.exploreTotal
                    ? (
                        stats.exploreDone /
                        stats.exploreTotal
                    ) *
                    20
                    : 0;

            title =
                'Bestemmingen ontdekken';

            detail =
                `${stats.exploreDone}/${stats.exploreTotal} vertrekzoekopdrachten verwerkt`;

        } else if (
            activeScan.phase ===
            'countries'
        ) {
            const ratio =
                stats.countryTotal
                    ? stats.countryDone /
                    stats.countryTotal
                    : 0;

            percent =
                20 +
                ratio * 25;

            title =
                'Steden verzamelen';

            detail =
                `${stats.countryDone}/${stats.countryTotal} landpagina's verwerkt`;

        } else {
            const routeRatio =
                stats.flightScheduled
                    ? stats.flightDone /
                    stats.flightScheduled
                    : 0;

            percent =
                45 +
                Math.min(
                    1,
                    routeRatio
                ) *
                55;

            title =
                stats.retries > 0
                    ? 'Vluchten en retries controleren'
                    : 'Concrete prijzen controleren';

            detail =
                `${stats.flightDone}/${stats.flightScheduled} routes definitief klaar`;

            if (
                stats.retries > 0
            ) {
                detail +=
                    ` · ${stats.retryRecovered} retry hersteld`;
            }
        }

        percent =
            Math.min(
                99,
                Math.max(
                    0,
                    Math.round(
                        percent
                    )
                )
            );

        setText(
            '#ww-progress-percent',
            `${percent}%`
        );

        setText(
            '#ww-progress-time',
            formatElapsed(
                Date.now() -
                activeScan.started
            )
        );

        setText(
            '#ww-stat-found',
            stats.uniqueFound
        );

        setText(
            '#ww-stat-routes',
            stats.flightDone
        );

        setText(
            '#ww-stat-retries',
            stats.retries
        );

        setText(
            '#ww-progress-title',
            title
        );

        setText(
            '#ww-progress-detail',
            detail
        );

        const bar =
            document.querySelector(
                '#weekend-wegwijzer #ww-progress-bar'
            );

        if (bar) {
            bar.style.width =
                `${percent}%`;
        }
    }


    /* ============================================================
       CONCRETE VLUCHT VERWERKEN
       ============================================================ */

    function processFinalFlightResponse(
        response,
        flightMeta,
        weekendState,
        scenarioState,
        allStates,
        {
            attempts = 1,
            recovered = false
        } = {}
    ) {
        const city =
            flightMeta.city;

        scenarioState
            .completedFlights++;

        activeScan
            .stats
            .flightDone++;

        if (
            response.source ===
            'CACHE'
        ) {
            registerSource(
                response
                    .sourceOriginal
            );

        } else {
            registerSource(
                response.source
            );
        }

        const rawFlights =
            response?.results ||
            [];

        const weekendAllowed =
            rawFlights.filter(
                flight =>
                    isAllowedByWeekend(
                        flight,
                        scenarioState
                            .scenario
                    )
            );

        const enriched =
            weekendAllowed.map(
                flight =>
                    enrichFlight(
                        flight,
                        city,
                        scenarioState
                            .scenario,
                        weekendState.settings
                    )
            );

        const validFlights =
            enriched.filter(
                flight =>
                    passesSearchFilters(
                        flight,
                        weekendState
                            .settings
                    )
            );

        const cheapestRealPrice =
            validFlights.length
                ? Math.min(
                    ...validFlights.map(
                        flight =>
                            flight.price
                    )
                )
                : null;

        let finalStatus =
            'NO_RESULT';

        if (
            response?.source ===
            'TIMEOUT' ||
            response?.source ===
            'PARENT_TIMEOUT'
        ) {
            finalStatus =
                'TIMEOUT';

        } else if (['BOT_CHECK', 'ACCESS_BLOCKED', 'RATE_LIMITED', 'COOKIE_WALL'].includes(response?.source)) {
            finalStatus = response.source;

        } else if (
            response?.source ===
            'ERROR'
        ) {
            finalStatus =
                'ERROR';

        } else if (
            rawFlights.length === 0
        ) {
            finalStatus =
                'NO_FLIGHTS_FOUND';

        } else if (
            weekendAllowed.length === 0
        ) {
            finalStatus =
                'REJECTED_BY_WEEKEND_RULE';

        } else if (
            validFlights.length === 0
        ) {
            finalStatus =
                'REJECTED_BY_SEARCH_FILTERS';

        } else {
            finalStatus =
                'VALID_RESULT';
        }

        updateCityTrace(
            item =>
                item.weekend ===
                    weekendKey(
                        weekendState.saturday
                    ) &&

                item.scenario ===
                    scenarioState
                        .scenario
                        .id &&

                item.airport ===
                    city.airport &&

                normalize(
                    item.city
                ) ===
                    normalize(
                        city.city
                    ),

            {
                routeChecked:
                    true,

                retryCount:
                    Math.max(
                        0,
                        attempts - 1
                    ),

                retryRecovered:
                    recovered,

                source:
                    response?.source ===
                    'CACHE'
                        ? `CACHE/${
                            response
                                .sourceOriginal ||
                            '?'
                        }`
                        : response
                            ?.source ||
                        'UNKNOWN',

                rawFlightCount:
                    rawFlights.length,

                allowedWeekendCount:
                    weekendAllowed.length,

                passedFilterCount:
                    validFlights.length,

                cheapestRealPrice,

                finalStatus
            }
        );

        weekendState
            .flights
            .push(
                ...selectRouteVariants(
                    validFlights
                )
            );

        updateUniqueCount(
            allStates
        );

        updateProgressivePreview(allStates);

        updateProgressUi();
    }


    /* ============================================================
       VLUCHTROUTES + RETRY
       ============================================================ */

    function scheduleBestCities(
        queue,
        weekendState,
        scenarioState,
        allStates
    ) {
        const lateWindow = Boolean(scenarioState.scenario.earliestOutbound);
        const candidates =
            selectBalancedCandidates(
                scenarioState
                    .discoveredCities,

                weekendState
                    .settings
                    .airports,

                lateWindow
                    ? CONFIG.lateCityCandidatesPerAirport
                    : CONFIG.cityCandidatesPerAirport,

                lateWindow
                    ? CONFIG.lateMaxCityCandidateCount
                    : CONFIG.maxCityCandidateCount
            );

        for (
            const candidate
            of candidates
        ) {
            updateCityTrace(
                item =>
                    item.weekend ===
                        weekendKey(
                            weekendState.saturday
                        ) &&

                    item.scenario ===
                        scenarioState
                            .scenario
                            .id &&

                    item.airport ===
                        candidate.airport &&

                    normalize(
                        item.city
                    ) ===
                        normalize(
                            candidate.city
                        ),

                {
                    selected:
                        true,

                    finalStatus:
                        'SELECTED_FOR_ROUTE_CHECK'
                }
            );
        }

        for (
            const city
            of candidates
        ) {
            const key =
                [
                    city.airport,

                    normalize(
                        city.city
                    ),

                    cacheUrl(
                        city.link
                    )
                ].join('|');

            if (
                scenarioState
                    .scheduledCityKeys
                    .has(key)
            ) {
                continue;
            }

            scenarioState
                .scheduledCityKeys
                .add(key);

            scenarioState
                .scheduledFlights++;

            activeScan
                .stats
                .flightScheduled++;

            const flightMeta = {
                city
            };

            queue.add(
                async () => {
                    checkCancelled();

                    const response =
                        await cachedWorkerJob(
                            'flight',

                            city.link,

                            {
                                airport:
                                    city.airport,

                                city:
                                    city.city,

                                outbound:
                                    scenarioState
                                        .scenario
                                        .outbound,

                                inbound:
                                    scenarioState
                                        .scenario
                                        .inbound,

                                maxStops: weekendState.settings.maxStops
                            },

                            activeScan.token,

                            {
                                forceFresh:
                                    activeScan
                                        .forceFreshFlights
                            }
                        );

                    activeScan
                        .stats
                        .flightFirstPassDone++;

                    if (
                        isTimeoutResponse(
                            response
                        ) &&
                        CONFIG.maxFlightAttempts >
                        1
                    ) {
                        activeScan
                            .stats
                            .retries++;

                        updateCityTrace(
                            item =>
                                item.weekend ===
                                    weekendKey(
                                        weekendState.saturday
                                    ) &&

                                item.scenario ===
                                    scenarioState
                                        .scenario
                                        .id &&

                                item.airport ===
                                    city.airport &&

                                normalize(
                                    item.city
                                ) ===
                                    normalize(
                                        city.city
                                    ),

                            {
                                routeChecked:
                                    true,

                                source:
                                    response.source,

                                retryCount:
                                    1,

                                retryRecovered:
                                    false,

                                finalStatus:
                                    'WAITING_FOR_RETRY'
                            }
                        );

                        updateProgressUi();

                        queue.add(
                            async () => {
                                checkCancelled();

                                const delay =
                                    CONFIG.retryDelayMs +
                                    Math.floor(
                                        Math.random() *
                                        CONFIG.retryJitterMs
                                    );

                                await sleep(
                                    delay
                                );

                                checkCancelled();

                                const retryResponse =
                                    await cachedWorkerJob(
                                        'flight',

                                        city.link,

                                        {
                                            airport:
                                                city.airport,

                                            city:
                                                city.city,

                                            outbound:
                                                scenarioState
                                                    .scenario
                                                    .outbound,

                                            inbound:
                                                scenarioState
                                                    .scenario
                                                    .inbound,

                                            maxStops: weekendState.settings.maxStops
                                        },

                                        activeScan.token,

                                        {
                                            forceFresh:
                                                activeScan
                                                    .forceFreshFlights
                                        }
                                    );

                                const recovered =
                                    !isTimeoutResponse(
                                        retryResponse
                                    );

                                if (recovered) {
                                    activeScan
                                        .stats
                                        .retryRecovered++;

                                } else {
                                    activeScan
                                        .stats
                                        .retryFailed++;
                                }

                                processFinalFlightResponse(
                                    retryResponse,

                                    flightMeta,

                                    weekendState,

                                    scenarioState,

                                    allStates,

                                    {
                                        attempts: 2,
                                        recovered
                                    }
                                );

                                return retryResponse;
                            },

                            CONFIG
                                .retryPriorityBase +
                            city.price
                        );

                        return response;
                    }

                    processFinalFlightResponse(
                        response,

                        flightMeta,

                        weekendState,

                        scenarioState,

                        allStates,

                        {
                            attempts: 1,
                            recovered: false
                        }
                    );

                    return response;
                },

                (lateWindow ? 5000 : 100) +
                city.price
            );
        }
    }


    /* ============================================================
       SCAN ENGINE
       ============================================================ */

    async function scanWeekendsEngine(
        weekends,
        settings,
        {
            forceFreshFlights = false
        } = {}
    ) {
        const states =
            weekends.map(
                saturday =>
                    createWeekendState(
                        saturday,
                        settings
                    )
            );

        activeScan.forceFreshFlights =
            forceFreshFlights;


        /* --------------------------------------------------------
           FASE 1: EXPLORE
           -------------------------------------------------------- */

        activeScan.phase =
            'explore';

        activeScan
            .timings
            .exploreStarted =
            Date.now();

        const exploreQueue =
            new PriorityQueue(
                CONFIG.exploreWorkers
            );

        activeScan.queue =
            exploreQueue;

        activeScan
            .stats
            .exploreTotal =
            states.reduce(
                (
                    total,
                    state
                ) =>
                    total +
                    (
                        state
                            .scenarios
                            .length *
                        settings
                            .airports
                            .length
                    ),

                0
            );

        updateProgressUi();

        const explorePromises =
            [];

        for (
            let weekendIndex = 0;
            weekendIndex <
            states.length;
            weekendIndex++
        ) {
            const state =
                states[
                    weekendIndex
                ];

            for (
                const scenario
                of state.scenarios
            ) {
                const scenarioState =
                    state
                        .scenarioStates
                        .get(
                            scenario.id
                        );

                for (
                    const airport
                    of settings.airports
                ) {
                    const url =
                        buildExploreUrl(
                            airport,
                            scenario,
                            settings
                        );

                    explorePromises.push(
                        exploreQueue.add(
                            async () => {
                                checkCancelled();

                                const response =
                                    await cachedWorkerJob(
                                        'explore',

                                        url,

                                        {
                                            airport,
                                            maxStops: settings.maxStops
                                        },

                                        activeScan.token
                                    );

                                scenarioState
                                    .exploreResults
                                    .push(
                                        ...(
                                            response
                                                ?.results ||
                                            []
                                        )
                                    );

                                activeScan
                                    .stats
                                    .exploreDone++;

                                updateProgressUi();

                                return response;
                            },

                            weekendIndex *
                            3
                        )
                    );
                }
            }
        }

        await Promise.all(
            explorePromises
        );

        await exploreQueue.onIdle();

        activeScan
            .timings
            .exploreEnded =
            Date.now();

        checkCancelled();


        /* --------------------------------------------------------
           FASE 2: LANDPAGINA'S
           -------------------------------------------------------- */

        activeScan.phase =
            'countries';

        activeScan
            .timings
            .countryStarted =
            Date.now();

        const countryQueue =
            new PriorityQueue(
                CONFIG.countryWorkers
            );

        activeScan.queue =
            countryQueue;

        const countryJobs =
            [];

        for (
            let weekendIndex = 0;
            weekendIndex <
            states.length;
            weekendIndex++
        ) {
            const state =
                states[
                    weekendIndex
                ];

            for (
                const scenario
                of state.scenarios
            ) {
                const scenarioState =
                    state
                        .scenarioStates
                        .get(
                            scenario.id
                        );

                const lateWindow = Boolean(scenario.earliestOutbound);
                const countries =
                    selectBalancedCandidates(
                        scenarioState
                            .exploreResults,

                        settings.airports,

                        lateWindow
                            ? CONFIG.lateCountryCandidatesPerAirport
                            : CONFIG.countryCandidatesPerAirport,

                        lateWindow
                            ? CONFIG.lateMaxCountryCandidateCount
                            : CONFIG.maxCountryCandidateCount
                    );

                for (
                    const country
                    of scenarioState
                        .exploreResults
                ) {
                    const selected =
                        countries.some(
                            chosen =>
                                chosen.airport ===
                                    country.airport &&

                                normalize(
                                    chosen.country
                                ) ===
                                    normalize(
                                        country.country
                                    )
                        );

                    traceCountry({
                        weekend:
                            weekendKey(
                                state.saturday
                            ),

                        scenario:
                            scenario.id,

                        scenarioLabel:
                            scenario.label,

                        airport:
                            country.airport,

                        country:
                            country.country,

                        indicativePrice:
                            country.price,

                        selected,

                        status:
                            selected
                                ? 'SELECTED'
                                : 'NOT_SELECTED',

                        cityCount:
                            null,

                        workerSource:
                            null
                    });
                }

                scenarioState
                    .countriesTotal =
                    countries.length;

                activeScan
                    .stats
                    .countryTotal +=
                    countries.length;

                for (
                    const country
                    of countries
                ) {
                    countryJobs.push(
                        countryQueue.add(
                            async () => {
                                checkCancelled();

                                const response =
                                    await cachedWorkerJob(
                                        'country',

                                        country.link,

                                        {
                                            airport:
                                                country.airport,

                                            country:
                                                country.country,

                                            maxStops: settings.maxStops
                                        },

                                        activeScan.token
                                    );

                                const cities =
                                    (
                                        response
                                            ?.results ||
                                        []
                                    )
                                        .filter(
                                            city =>
                                                Number.isFinite(
                                                    city.price
                                                )
                                        )
                                        .sort(
                                            (a, b) =>
                                                a.price -
                                                b.price
                                        );

                                const countryTrace =
                                    [
                                        ...activeScan
                                            .trace
                                            .countries
                                    ]
                                        .reverse()
                                        .find(
                                            item =>
                                                item.weekend ===
                                                    weekendKey(
                                                        state.saturday
                                                    ) &&

                                                item.scenario ===
                                                    scenario.id &&

                                                item.airport ===
                                                    country.airport &&

                                                normalize(
                                                    item.country
                                                ) ===
                                                    normalize(
                                                        country.country
                                                    )
                                        );

                                if (
                                    countryTrace
                                ) {
                                    countryTrace
                                        .cityCount =
                                        cities.length;

                                    countryTrace
                                        .workerSource =
                                        response?.source ||
                                        'UNKNOWN';

                                    countryTrace
                                        .status =
                                        cities.length
                                            ? 'CITIES_FOUND'
                                            : 'NO_CITIES';
                                }

                                for (
                                    const city
                                    of cities
                                ) {
                                    traceCity({
                                        weekend:
                                            weekendKey(
                                                state.saturday
                                            ),

                                        scenario:
                                            scenario.id,

                                        scenarioLabel:
                                            scenario.label,

                                        airport:
                                            city.airport,

                                        country:
                                            city.country,

                                        city:
                                            city.city,

                                        indicativePrice:
                                            city.price,

                                        selected:
                                            false,

                                        routeChecked:
                                            false,

                                        source:
                                            null,

                                        retryCount:
                                            0,

                                        retryRecovered:
                                            false,

                                        rawFlightCount:
                                            null,

                                        allowedWeekendCount:
                                            null,

                                        passedFilterCount:
                                            null,

                                        cheapestRealPrice:
                                            null,

                                        finalStatus:
                                            'DISCOVERED'
                                    });

                                    const key =
                                        [
                                            city.airport,

                                            normalize(
                                                city.city
                                            ),

                                            cacheUrl(
                                                city.link
                                            )
                                        ].join('|');

                                    if (
                                        scenarioState
                                            .cityKeys
                                            .has(key)
                                    ) {
                                        continue;
                                    }

                                    scenarioState
                                        .cityKeys
                                        .add(key);

                                    scenarioState
                                        .discoveredCities
                                        .push(
                                            city
                                        );
                                }

                                scenarioState
                                    .countriesCompleted++;

                                activeScan
                                    .stats
                                    .countryDone++;

                                updateProgressUi();

                                return response;
                            },

                            40 +
                            country.price +
                            weekendIndex
                        )
                    );
                }
            }
        }

        updateProgressUi();

        await Promise.all(
            countryJobs
        );

        await countryQueue.onIdle();

        activeScan
            .timings
            .countryEnded =
            Date.now();

        checkCancelled();


        /* --------------------------------------------------------
           FASE 3: VLUCHTEN
           -------------------------------------------------------- */

        activeScan.phase =
            'flights';

        activeScan
            .timings
            .flightStarted =
            Date.now();

        const flightQueue =
            new PriorityQueue(
                CONFIG.flightWorkers
            );

        activeScan.queue =
            flightQueue;

        for (
            const state
            of states
        ) {
            for (
                const scenarioState
                of state
                    .scenarioStates
                    .values()
            ) {
                scheduleBestCities(
                    flightQueue,
                    state,
                    scenarioState,
                    states
                );
            }
        }

        await flightQueue.onIdle();

        activeScan
            .timings
            .flightEnded =
            Date.now();

        checkCancelled();


        /* --------------------------------------------------------
           RESULTATEN
           -------------------------------------------------------- */

        const output = [];

        for (
            const state
            of states
        ) {
            let grouped =
                groupDestinations(
                    state.flights
                );

            grouped =
                addHistoryData(
                    state.saturday,
                    grouped
                );

            saveCurrentPrices(
                state.saturday,
                grouped
            );

            output.push({
                saturday:
                    state.saturday,

                results:
                    grouped
            });
        }

        activeScan.phase = 'complete';
        activeScan.resultSnapshot = output.flatMap(item =>
            item.results.slice(0, CONFIG.topCount).map(result => ({
                weekend: weekendKey(item.saturday),
                city: result.city,
                country: result.country,
                airport: result.airport,
                scenario: result.scenarioId,
                flightPrice: result.price,
                totalPrice: result.totalPrice,
                priceIncomplete: result.priceIncomplete,
                priceVolatile: result.priceVolatile,
                effectiveStayHours: result.effectiveStayHours,
                outboundDeparture: result.outboundDeparture,
                inboundArrival: result.inboundArrival,
                expectedHomeMinutes: result.expectedHomeMinutes
            }))
        );

        return output;
    }


    /* ============================================================
       SCAN CONTROLLER
       ============================================================ */

    function createActiveScan(
        forceFreshFlights,
        settings
    ) {
        return {
            token:
                Date.now() +
                '-' +
                Math.random()
                    .toString(36)
                    .slice(2),

            started:
                Date.now(),

            cancelled:
                false,

            finishEarly:
                false,

            phase:
                'starting',

            queue:
                null,

            forceFreshFlights,

            settings,

            stats:
                emptyStats(),

            timings:
                emptyTimings(),

            trace: {
                countries: [],
                cities: []
            },

            resultSnapshot: []
        };
    }


    async function startSingleScan(
        saturday,
        settings,
        {
            forceFreshFlights = false
        } = {}
    ) {
        activeScan =
            createActiveScan(
                forceFreshFlights,
                settings
            );

        renderScanShell(
            [saturday]
        );

        updateProgressUi();

        try {
            const output =
                await scanWeekendsEngine(
                    [saturday],
                    settings,
                    {
                        forceFreshFlights
                    }
                );

            checkCancelled();

            renderResults(
                output[0].results,

                saturday,

                settings,

                Date.now() -
                activeScan.started
            );

        } catch (error) {
            if (
                error?.message ===
                '__CANCELLED__'
            ) {
                return;
            }

            renderError(
                error
            );
        }
    }


    async function startCalendarScan(
        weekends,
        settings,
        title
    ) {
        activeScan =
            createActiveScan(
                false,
                settings
            );

        renderScanShell(
            weekends
        );

        updateProgressUi();

        try {
            const output =
                await scanWeekendsEngine(
                    weekends,
                    settings
                );

            checkCancelled();

            renderCalendarResults(
                output,
                settings,
                title,

                Date.now() -
                activeScan.started
            );

        } catch (error) {
            if (
                error?.message ===
                '__CANCELLED__'
            ) {
                return;
            }

            renderError(
                error
            );
        }
    }


    function cleanupPendingWorkers() {
        for (const pending of pendingJobs.values()) {
            clearTimeout(pending.timeout);
            pending.iframe.remove();
            pending.resolve({ results: [], source: 'CANCELLED' });
        }
        pendingJobs.clear();
    }

    window.addEventListener('pagehide', cleanupPendingWorkers, { once: true });

    function stopScan() {
        if (
            activeScan
        ) {
            activeScan.cancelled =
                true;

            activeScan.queue
                ?.cancelQueued();
        }

        cleanupPendingWorkers();

        renderStart();
    }


    function checkCancelled() {
        if (
            activeScan?.cancelled
        ) {
            throw new Error(
                '__CANCELLED__'
            );
        }
    }


    /* ============================================================
       RESULT TOOLBAR
       ============================================================ */

    function resultToolbarHtml(
        settings
    ) {
        return `
            <div style="
                display:grid;
                grid-template-columns:1fr auto;
                gap:7px;
                margin-top:10px;
            ">
                <select
                    id="ww-sort"
                    style="
                        width:100%;
                        padding:8px;
                        border:0;
                        border-radius:7px;
                    "
                >
                    <option value="price">
                        💶 Goedkoopste
                    </option>

                    <option value="stay">
                        ⏱ Langste verblijf
                    </option>

                    <option value="deal">
                        ⭐ Beste deal
                    </option>
                </select>

                <label style="
                    display:flex;
                    align-items:center;
                    gap:5px;
                    padding:0 8px;
                    border-radius:7px;
                    background:rgba(255,255,255,.06);
                    font-size:11px;
                ">
                    <input
                        id="ww-compact"
                        type="checkbox"
                        ${
                            settings.compactMode
                                ? 'checked'
                                : ''
                        }
                    >

                    Compact
                </label>
            </div>
        `;
    }


      function resultFiltersHtml() {
    return `
        <div style="
            margin-top:8px;
            padding:9px;
            border-radius:9px;
            background:rgba(255,255,255,.045);
        ">
            <div style="
                display:flex;
                align-items:center;
                justify-content:space-between;
                gap:8px;
            ">
                <span style="
                    font-size:10px;
                    opacity:.55;
                    font-weight:700;
                ">
                    FILTER RESULTATEN
                </span>

                <button
                    id="ww-clear-filters"
                    style="
                        display:none;
                        border:0;
                        cursor:pointer;
                        color:white;
                        background:transparent;
                        opacity:.65;
                        font-size:10px;
                    "
                >
                    Wissen
                </button>
            </div>

            <div style="
                display:flex;
                flex-wrap:wrap;
                gap:5px;
                margin-top:7px;
            ">
                <button
                    class="ww-filter-chip"
                    data-filter="under100"
                >
                    💶 Onder €100
                </button>

                <button
                    class="ww-filter-chip"
                    data-filter="over48"
                >
                    ⏱ 48+ uur
                </button>

                <button
                    class="ww-filter-chip"
                    data-weekend="fri-mon"
                >
                    🌅 Vr → ma
                </button>

                <button
                    class="ww-filter-chip"
                    data-weekend="sat-mon"
                >
                    🧳 Za → ma
                </button>

                <button
                    class="ww-filter-chip"
                    data-airport="AMS"
                >
                    AMS
                </button>

                <button
                    class="ww-filter-chip"
                    data-airport="EIN"
                >
                    EIN
                </button>

                <button
                    class="ww-filter-chip"
                    data-airport="RTM"
                >
                    RTM
                </button>

                <button
                    class="ww-filter-chip"
                    data-airport="GRQ"
                >
                    GRQ
                </button>
            </div>

            <div
                id="ww-filter-summary"
                style="
                    display:none;
                    margin-top:7px;
                    font-size:10px;
                    opacity:.6;
                "
            ></div>
        </div>
    `;
}

   function updateFilterStyles(
    panel,
    filters
) {
    panel
        .querySelectorAll(
            '.ww-filter-chip'
        )
        .forEach(
            chip => {
                const filter =
                    chip.dataset
                        .filter;

                const airport =
                    chip.dataset
                        .airport;

                const weekend =
                    chip.dataset
                        .weekend;


                let active =
                    false;


                if (filter) {
                    active =
                        Boolean(
                            filters[
                                filter
                            ]
                        );
                }


                if (airport) {
                    active =
                        filters
                            .airports
                            .includes(
                                airport
                            );
                }


                if (weekend) {
                    active =
                        filters
                            .weekendTypes
                            .includes(
                                weekend
                            );
                }


                chip.style.cssText = `
                    border:1px solid ${
                        active
                            ? 'rgba(255,255,255,.26)'
                            : 'rgba(255,255,255,.06)'
                    };

                    padding:5px 7px;

                    border-radius:999px;

                    cursor:pointer;

                    color:white;

                    font-size:10px;

                    background:${
                        active
                            ? 'rgba(255,255,255,.18)'
                            : 'rgba(255,255,255,.065)'
                    };

                    font-weight:${
                        active
                            ? '700'
                            : '400'
                    };
                `;
            }
        );


    const clear =
        panel.querySelector(
            '#ww-clear-filters'
        );


    if (clear) {
        clear.style.display =
            filtersActive(
                filters
            )
                ? 'block'
                : 'none';
    }
}


    function bindResultFilters(
    panel,
    filters,
    redraw
) {
    updateFilterStyles(
        panel,
        filters
    );


    panel
        .querySelectorAll(
            '.ww-filter-chip'
        )
        .forEach(
            chip => {
                chip.addEventListener(
                    'click',
                    () => {
                        const filter =
                            chip.dataset
                                .filter;

                        const airport =
                            chip.dataset
                                .airport;

                        const weekend =
                            chip.dataset
                                .weekend;


                        /*
                         * GEWONE FILTERS
                         */
                        if (filter) {
                            filters[
                                filter
                            ] =
                                !filters[
                                    filter
                                ];
                        }


                        /*
                         * WEEKENDTYPE
                         *
                         * Beide mogen tegelijk actief zijn.
                         */
                        if (weekend) {
                            if (
                                filters
                                    .weekendTypes
                                    .includes(
                                        weekend
                                    )
                            ) {
                                filters.weekendTypes =
                                    filters
                                        .weekendTypes
                                        .filter(
                                            value =>
                                                value !==
                                                weekend
                                        );

                            } else {
                                filters
                                    .weekendTypes
                                    .push(
                                        weekend
                                    );
                            }
                        }


                        /*
                         * LUCHTHAVENS
                         */
                        if (airport) {
                            if (
                                filters
                                    .airports
                                    .includes(
                                        airport
                                    )
                            ) {
                                filters.airports =
                                    filters
                                        .airports
                                        .filter(
                                            value =>
                                                value !==
                                                airport
                                        );

                            } else {
                                filters
                                    .airports
                                    .push(
                                        airport
                                    );
                            }
                        }


                        updateFilterStyles(
                            panel,
                            filters
                        );


                        redraw();
                    }
                );
            }
        );


    panel
        .querySelector(
            '#ww-clear-filters'
        )
        ?.addEventListener(
            'click',
            () => {
                filters.under100 =
                    false;

                filters.over48 =
                    false;

                filters.weekendTypes =
                    [];

                filters.airports =
                    [];


                updateFilterStyles(
                    panel,
                    filters
                );


                redraw();
            }
        );
}

    /* ============================================================
       RESULTAATKAART
       ============================================================ */

    function createResultCard(
        result,
        index,
        compact
    ) {
        const card =
            document.createElement(
                'div'
            );

        card.style.cssText = `
            position:relative;
            padding:${
                compact
                    ? '9px'
                    : '13px'
            };
            margin-bottom:8px;
            border:1px solid rgba(255,255,255,.055);
            border-radius:11px;
            cursor:pointer;
            background:rgba(255,255,255,.075);
            transition:.15s ease;
        `;

        const longWeekend =
            ['thu-mon', 'fri-mon'].includes(result.scenarioId);

        const filteredVariantNotice =
            result.filteredVariant
                ? `
                    <div style="
                        margin-top:3px;
                        font-size:9px;
                        opacity:.55;
                    ">
                        Beste optie binnen actieve filters
                    </div>
                `
                : '';

        const recommendationHtml =
            result
                .recommendationExtra >
            0
                ? `
                    <div style="
                        margin-top:6px;
                        padding:5px 7px;
                        border-radius:6px;
                        background:rgba(34,197,94,.12);
                        font-size:10px;
                    ">
                        ⭐
                        ${euro(
                            result
                                .recommendationExtra
                        )}
                        extra geeft

                        <strong>
                            ${
                                result
                                    .extraHours
                            } uur
                        </strong>

                        extra tijd op bestemming
                    </div>
                `
                : '';

        card.innerHTML = `
            <div style="
                display:flex;
                justify-content:space-between;
                gap:8px;
            ">
                <div style="
                    min-width:0;
                ">
                    <div style="
                        display:flex;
                        gap:6px;
                        align-items:center;
                    ">
                        <span style="
                            font-size:10px;
                            opacity:.45;
                        ">
                            #${index + 1}
                        </span>

                        <strong style="
                            font-size:${
                                compact
                                    ? '15px'
                                    : '18px'
                            };
                        ">
                            ${
                                escapeHtml(
                                    result.city
                                )
                            }
                        </strong>

                        <button
                            class="ww-favorite"
                            title="Favoriet"
                            style="
                                border:0;
                                padding:0;
                                cursor:pointer;
                                color:white;
                                background:transparent;
                                font-size:16px;
                            "
                        >
                            ${
                                isFavorite(
                                    result
                                )
                                    ? '★'
                                    : '☆'
                            }
                        </button>
                    </div>

                    <div style="
                        font-size:10px;
                        opacity:.52;
                    ">
                        ${
                            escapeHtml(
                                result.country
                            )
                        }
                    </div>

                    ${filteredVariantNotice}
                </div>

                <div style="
                    text-align:right;
                    white-space:nowrap;
                ">
                    <strong style="
                        font-size:${
                            compact
                                ? '16px'
                                : '20px'
                        };
                    ">
                        ${
                            euro(
                                result.floorTotalPrice ?? result.floorPrice
                            )
                        }
                    </strong>

                    <div style="font-size:9px;opacity:.58">
                        geschat totaal · ${result.travelers || 1} reiziger${(result.travelers || 1) === 1 ? '' : 's'}
                        ${result.priceIncomplete ? ' · bagage onbekend' : ''}
                    </div>

                    ${
                        (result.totalPrice ?? result.price) >
                        (result.floorTotalPrice ?? result.floorPrice)
                            ? `
                                <div style="
                                    font-size:9px;
                                    opacity:.5;
                                ">
                                    aanrader
                                    ${
                                        euro(
                                            result.totalPrice ?? result.price
                                        )
                                    }
                                </div>
                            `
                            : ''
                    }
                </div>
            </div>

            <div style="
                display:flex;
                flex-wrap:wrap;
                gap:5px;
                margin-top:6px;
            ">
                <span style="
                    padding:3px 6px;
                    border-radius:5px;
                    background:rgba(255,255,255,.07);
                    font-size:10px;
                ">
                    ✈
                    ${
                        escapeHtml(
                            result.airport
                        )
                    }
                </span>

                ${
                    result.scenarioId === 'custom'
                        ? `<span style="padding:3px 6px;border-radius:5px;background:rgba(139,92,246,.15);font-size:10px;font-weight:700">📅 Eigen periode</span>`
                        : longWeekend
                        ? `
                            <span style="
                                padding:3px 6px;
                                border-radius:5px;
                                background:rgba(56,189,248,.14);
                                border:1px solid rgba(56,189,248,.13);
                                font-size:10px;
                                font-weight:700;
                            ">
                                🌅 Lang weekend
                            </span>
                        `
                        : `
                            <span style="
                                padding:3px 6px;
                                border-radius:5px;
                                background:rgba(255,255,255,.07);
                                font-size:10px;
                            ">
                                Za → ma
                            </span>
                        `
                }

                <span style="
                    padding:3px 6px;
                    border-radius:5px;
                    background:rgba(255,255,255,.07);
                    font-size:10px;
                ">
                    ⏱
                    ${
                        formatHours(
                            result.effectiveStayHours ?? result.stayHours
                        )
                    }
                </span>

                <span
                    title="Relatieve score binnen deze scan"
                    style="
                        padding:3px 6px;
                        border-radius:5px;
                        background:rgba(255,255,255,.07);
                        font-size:10px;
                    "
                >
                    ⭐
                    ${
                        escapeHtml(
                            result.dealLabel
                        )
                    }
                </span>

                <span title="Landing plus ingestelde reistijd naar huis en marge" style="padding:3px 6px;border-radius:5px;background:rgba(255,255,255,.07);font-size:10px">
                    🏠 circa ${minutesToClock(result.expectedHomeMinutes)} thuis
                </span>

                ${
                    priceChangeHtml(
                        result
                    )
                }
                ${result.priceVolatile ? `
                    <span title="De concrete vluchtprijs wijkt sterk af van de eerdere indicatie" style="padding:3px 6px;border-radius:5px;background:rgba(245,158,11,.18);font-size:10px;font-weight:700">
                        ⚠ prijs sterk gewijzigd
                    </span>
                ` : ''}
            </div>

            <div style="
                display:flex;
                flex-wrap:wrap;
                gap:5px;
                margin-top:6px;
            ">
                ${
                    timingBadgesHtml(
                        result
                    )
                }
                ${(result.recommendationTags || []).map(tag => `<span style="padding:3px 6px;border-radius:5px;background:rgba(34,197,94,.15);font-size:10px;font-weight:700">${escapeHtml(tag)}</span>`).join('')}
            </div>

            ${
                compact
                    ? ''
                    : `
                        <div style="
                            margin-top:7px;
                            font-size:11px;
                        ">
                            🛫
                            <strong>
                                ${
                                    escapeHtml(
                                        result
                                            .outboundDeparture
                                    )
                                }
                            </strong>
                            →
                            ${
                                escapeHtml(
                                    result
                                        .outboundArrival
                                )
                            }

                            &nbsp;&nbsp;

                            🛬
                            <strong>
                                ${
                                    escapeHtml(
                                        result
                                            .inboundDeparture
                                    )
                                }
                            </strong>
                            →
                            ${
                                escapeHtml(
                                    result
                                        .inboundArrival
                                )
                            }
                        </div>

                        ${recommendationHtml}
                    `
            }

            <button
                class="ww-details-button"
                style="
                    width:100%;
                    margin-top:7px;
                    padding:6px;
                    border:0;
                    border-radius:6px;
                    cursor:pointer;
                    text-align:left;
                    color:white;
                    background:rgba(255,255,255,.06);
                    font-size:10px;
                "
            >
                ▸ Tijden & alternatieven
            </button>

            <div
                class="ww-details"
                style="
                    display:none;
                "
            ></div>
        `;

        card.addEventListener(
            'mouseenter',
            () => {
                card.style.background =
                    'rgba(255,255,255,.11)';
            }
        );

        card.addEventListener(
            'mouseleave',
            () => {
                card.style.background =
                    'rgba(255,255,255,.075)';
            }
        );

        card.addEventListener(
            'click',
            event => {
                if (
                    event.target.closest(
                        'button'
                    ) ||
                    event.target.closest(
                        '.ww-details'
                    )
                ) {
                    return;
                }

                openSkyscannerResult(
                    result.link
                );
            }
        );

        const favoriteButton =
            card.querySelector(
                '.ww-favorite'
            );

        favoriteButton
            ?.addEventListener(
                'click',
                event => {
                    event.stopPropagation();

                    favoriteButton
                        .textContent =
                        toggleFavorite(
                            result
                        )
                            ? '★'
                            : '☆';
                }
            );

        const details =
            card.querySelector(
                '.ww-details'
            );

        details.innerHTML = `
            <div style="
                margin-top:6px;
                padding:9px;
                border-radius:7px;
                background:rgba(255,255,255,.045);
                font-size:10px;
            ">
                <strong>
                    Aanbevolen vlucht
                </strong>

                <div style="
                    margin-top:5px;
                ">
                    Heen:

                    <strong>
                        ${
                            escapeHtml(
                                result.outboundDeparture
                            )
                        }
                    </strong>

                    ${
                        escapeHtml(
                            result.outboundFrom
                        )
                    }

                    →

                    <strong>
                        ${
                            escapeHtml(
                                result.outboundArrival
                            )
                        }
                    </strong>

                    ${
                        escapeHtml(
                            result.outboundTo
                        )
                    }
                </div>

                <div style="
                    margin-top:2px;
                ">
                    Terug:

                    <strong>
                        ${
                            escapeHtml(
                                result.inboundDeparture
                            )
                        }
                    </strong>

                    ${
                        escapeHtml(
                            result.inboundFrom
                        )
                    }

                    →

                    <strong>
                        ${
                            escapeHtml(
                                result.inboundArrival
                            )
                        }
                    </strong>

                    ${
                        escapeHtml(
                            result.inboundTo
                        )
                    }
                </div>

                <div style="
                    margin-top:4px;
                    opacity:.65;
                ">
                    ${
                        escapeHtml(
                            result.outboundAirline
                        )
                    }

                    ·

                    ${
                        formatHours(
                            result.effectiveStayHours ?? result.stayHours
                        )
                    }

                    · vlucht ${euro(result.price)}
                    ${result.accessCost ? ` · luchthavenreis ${euro(result.accessCost)}` : ''}
                    ${result.accessMinutes ? ` · ${result.accessMinutes} min naar luchthaven` : ''}
                    · ${Math.max(result.outboundStops || 0, result.inboundStops || 0)} overstap(pen)
                </div>

                <button
                    class="ww-open-result"
                    style="
                        width:100%;
                        margin-top:7px;
                        padding:7px;
                        border:0;
                        border-radius:6px;
                        cursor:pointer;
                        font-weight:700;
                    "
                >
                    Open op Skyscanner ↗
                </button>
            </div>
        `;

        details
            .querySelector(
                '.ww-open-result'
            )
            ?.addEventListener(
                'click',
                event => {
                    event.stopPropagation();

                    openSkyscannerResult(
                        result.link
                    );
                }
            );

        if (
            result
                .alternatives
                ?.length
        ) {
            const title =
                document.createElement(
                    'div'
                );

            title.textContent =
                'ANDERE GOEDE OPTIES';

            title.style.cssText = `
                margin-top:7px;
                font-size:9px;
                opacity:.5;
            `;

            details.appendChild(
                title
            );

            result
                .alternatives
                .slice(
                    0,
                    6
                )
                .forEach(
                    alternative => {
                        const item =
                            document
                                .createElement(
                                    'div'
                                );

                        item.style.cssText = `
                            margin-top:4px;
                            padding:7px;
                            border-radius:6px;
                            cursor:pointer;
                            background:rgba(255,255,255,.04);
                            font-size:10px;
                        `;

                        item.innerHTML = `
                            <strong>
                                ${
                                    euro(
                                        alternative.price
                                    )
                                }
                            </strong>

                            ·

                            ${
                                formatHours(
                                    alternative.stayHours
                                )
                            }

                            ·

                            ${
                                escapeHtml(
                                    alternative.airport
                                )
                            }

                            ·

                            ${
                                alternative.scenarioId ===
                                'fri-mon'
                                    ? 'Vr → ma'
                                    : 'Za → ma'
                            }

                            <br>

                            heen
                            ${
                                escapeHtml(
                                    alternative
                                        .outboundDeparture
                                )
                            }

                            · terug
                            ${
                                escapeHtml(
                                    alternative
                                        .inboundDeparture
                                )
                            }
                        `;

                        item.addEventListener(
                            'click',
                            event => {
                                event.stopPropagation();

                                openSkyscannerResult(
                                    alternative.link
                                );
                            }
                        );

                        details.appendChild(
                            item
                        );
                    }
                );
        }

        const detailsButton =
            card.querySelector(
                '.ww-details-button'
            );

        let open =
            false;

        detailsButton
            ?.addEventListener(
                'click',
                event => {
                    event.stopPropagation();

                    open =
                        !open;

                    details.style.display =
                        open
                            ? 'block'
                            : 'none';

                    detailsButton
                        .textContent =
                        open
                            ? '▾ Verberg details'
                            : '▸ Tijden & alternatieven';
                }
            );

        return card;
    }


    /* ============================================================
       DIAGNOSE
       ============================================================ */

    function diagnosticSnapshot() {
        return {
            product: 'Weekend Wegwijzer',
            version: '4.0.2',
            generatedAt: new Date().toISOString(),
            page: { origin: location.origin, path: location.pathname },
            settings: activeScan?.settings || loadSettings(),
            scan: activeScan ? {
                phase: activeScan.phase,
                cancelled: activeScan.cancelled,
                finishedEarly: activeScan.finishEarly,
                stats: activeScan.stats,
                timings: activeScan.timings,
                trace: activeScan.trace,
                results: activeScan.resultSnapshot
            } : null
        };
    }

    function downloadDiagnostics() {
        const blob = new Blob(
            [JSON.stringify(diagnosticSnapshot(), null, 2)],
            { type: 'application/json' }
        );
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `Weekend-Wegwijzer-diagnose-${Date.now()}.json`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function diagnosisHtml() {
        const stats =
            activeScan?.stats;

        const trace =
            activeScan?.trace;

        const timings =
            activeScan?.timings;

        if (
            !stats ||
            !trace
        ) {
            return '';
        }

        const exploreMs =
            timings
                ? elapsedBetween(
                    timings.exploreStarted,
                    timings.exploreEnded
                )
                : 0;

        const countryMs =
            timings
                ? elapsedBetween(
                    timings.countryStarted,
                    timings.countryEnded
                )
                : 0;

        const flightMs =
            timings
                ? elapsedBetween(
                    timings.flightStarted,
                    timings.flightEnded
                )
                : 0;

        const firstResultMs = timings?.firstResultAt
            ? timings.firstResultAt - activeScan.started
            : 0;

        return `
            <details
                id="ww-diagnosis"
                style="
                    margin-top:10px;
                    padding:9px;
                    border-radius:8px;
                    background:rgba(255,255,255,.04);
                "
            >
                <summary style="
                    cursor:pointer;
                    font-size:10px;
                    opacity:.8;
                    font-weight:700;
                ">
                    🔎 Diagnose
                </summary>

                <div style="
                    margin-top:8px;
                    font-size:10px;
                    line-height:1.7;
                    opacity:.75;
                ">
                    <strong>
                        Snelheidsmeting
                    </strong>

                    <br>

                    Explore:
                    ${
                        exploreMs
                            ? formatElapsed(
                                exploreMs
                            )
                            : '—'
                    }

                    · Landen:
                    ${
                        countryMs
                            ? formatElapsed(
                                countryMs
                            )
                            : '—'
                    }

                    · Vluchten:
                    ${
                        flightMs
                            ? formatElapsed(
                                flightMs
                            )
                            : '—'
                    }

                    · Eerste resultaat:
                    ${firstResultMs ? formatElapsed(firstResultMs) : '—'}

                    <br><br>

                    Verkenning:
                    ${stats.exploreDone}/${stats.exploreTotal}

                    <br>

                    Landpagina's:
                    ${stats.countryDone}/${stats.countryTotal}

                    <br>

                    Vluchtroutes:
                    ${stats.flightDone}/${stats.flightScheduled}

                    <br>

                    JSON:
                    ${stats.json}

                    · DOM:
                    ${stats.dom}

                    <br>

                    Geen resultaat:
                    ${stats.noResult}

                    <br>

                    Definitieve time-outs:
                    ${stats.timeout}

                    · fouten:
                    ${stats.error}

                    <br>

                    Direct geladen:
                    ${stats.cacheHits}

                    <br>

                    Retries:
                    ${stats.retries}

                    · hersteld:
                    ${stats.retryRecovered}

                    · opnieuw mislukt:
                    ${stats.retryFailed}

                    <br>

                    Landrecords:
                    ${trace.countries.length}

                    · stadrecords:
                    ${trace.cities.length}
                </div>

                <button
                    id="ww-download-diagnosis"
                    type="button"
                    style="width:100%;margin-top:10px;padding:8px;border:0;border-radius:7px;cursor:pointer"
                >
                    Diagnose downloaden
                </button>

                <div style="
                    margin-top:10px;
                    padding-top:10px;
                    border-top:1px solid rgba(255,255,255,.07);
                ">
                    <input
                        id="ww-trace-search"
                        type="text"
                        placeholder="Zoek land of stad, bv. Ibiza of Polen"
                        style="
                            width:100%;
                            box-sizing:border-box;
                            padding:8px;
                            border:0;
                            border-radius:7px;
                        "
                    >

                    <div
                        id="ww-trace-output"
                        style="
                            margin-top:8px;
                        "
                    >
                        <div style="
                            font-size:10px;
                            opacity:.55;
                        ">
                            Typ een land of stad om precies
                            te zien waar die kandidaat in
                            de scan terechtkwam.
                        </div>
                    </div>
                </div>
            </details>
        `;
    }


    function statusHuman(status) {
        const map = {
            SELECTED:
                'Land geselecteerd',

            NOT_SELECTED:
                'Land niet geselecteerd',

            CITIES_FOUND:
                'Steden gevonden',

            NO_CITIES:
                'Geen steden gevonden',

            DISCOVERED:
                'Stad ontdekt',

            SELECTED_FOR_ROUTE_CHECK:
                'Geselecteerd voor vluchtcheck',

            WAITING_FOR_RETRY:
                'Wacht op tweede poging',

            VALID_RESULT:
                'Geldige vlucht gevonden',

            NO_FLIGHTS_FOUND:
                'Geen directe retour gevonden',

            REJECTED_BY_WEEKEND_RULE:
                'Afgevallen door beschikbaarheidsvenster',

            REJECTED_BY_SEARCH_FILTERS:
                'Afgevallen door zoekfilters',

            TIMEOUT:
                'Time-out',

            ERROR:
                'Technische fout',

            BOT_CHECK:
                'Skyscanner vraagt menselijke controle',

            ACCESS_BLOCKED:
                'Toegang tijdelijk geblokkeerd',

            RATE_LIMITED:
                'Te veel verzoeken; later opnieuw proberen',

            COOKIE_WALL:
                'Cookiekeuze blokkeert de zoekpagina',

            NO_RESULT:
                'Geen resultaat'
        };

        return (
            map[status] ||
            status ||
            'Onbekend'
        );
    }


    function bindDiagnosisSearch(panel) {
        panel.querySelector('#ww-download-diagnosis')
            ?.addEventListener('click', downloadDiagnostics);

        const input =
            panel.querySelector(
                '#ww-trace-search'
            );

        const output =
            panel.querySelector(
                '#ww-trace-output'
            );

        if (
            !input ||
            !output ||
            !activeScan?.trace
        ) {
            return;
        }

        function render() {
            const query =
                normalize(
                    input.value
                );

            if (
                query.length < 2
            ) {
                output.innerHTML = `
                    <div style="
                        font-size:10px;
                        opacity:.55;
                    ">
                        Typ minimaal 2 letters.
                    </div>
                `;

                return;
            }

            const countryMatches =
                activeScan
                    .trace
                    .countries
                    .filter(
                        item =>
                            normalize(
                                item.country
                            ).includes(
                                query
                            )
                    );

            const cityMatches =
                activeScan
                    .trace
                    .cities
                    .filter(
                        item =>
                            normalize(
                                item.city
                            ).includes(
                                query
                            ) ||

                            normalize(
                                item.country
                            ).includes(
                                query
                            )
                    );

            if (
                !countryMatches.length &&
                !cityMatches.length
            ) {
                output.innerHTML = `
                    <div style="
                        padding:8px;
                        border-radius:7px;
                        background:rgba(245,158,11,.12);
                        font-size:10px;
                    ">
                        Geen spoor gevonden voor
                        <strong>
                            ${
                                escapeHtml(
                                    input.value
                                )
                            }
                        </strong>.
                    </div>
                `;

                return;
            }

            const countryHtml =
                countryMatches
                    .sort(
                        (a, b) =>
                            a.indicativePrice -
                            b.indicativePrice
                    )
                    .map(
                        item => `
                            <div style="
                                margin-top:5px;
                                padding:7px;
                                border-radius:7px;
                                background:rgba(255,255,255,.05);
                                font-size:10px;
                            ">
                                <strong>
                                    🌍
                                    ${
                                        escapeHtml(
                                            item.country
                                        )
                                    }
                                </strong>

                                ·
                                ${
                                    escapeHtml(
                                        item.airport
                                    )
                                }

                                ·
                                ${
                                    escapeHtml(
                                        item.scenarioLabel
                                    )
                                }

                                <br>

                                indicatief:
                                ${
                                    euro(
                                        item.indicativePrice
                                    )
                                }

                                ·

                                ${
                                    item.selected
                                        ? '✅ geselecteerd'
                                        : '❌ niet geselecteerd'
                                }

                                ${
                                    Number.isFinite(
                                        item.cityCount
                                    )
                                        ? `
                                            ·
                                            ${item.cityCount}
                                            steden
                                        `
                                        : ''
                                }

                                ${
                                    item.workerSource
                                        ? `
                                            ·
                                            ${
                                                escapeHtml(
                                                    item.workerSource
                                                )
                                            }
                                        `
                                        : ''
                                }

                                <br>

                                status:
                                <strong>
                                    ${
                                        escapeHtml(
                                            statusHuman(
                                                item.status
                                            )
                                        )
                                    }
                                </strong>
                            </div>
                        `
                    )
                    .join('');

            const cityHtml =
                cityMatches
                    .sort(
                        (a, b) =>
                            a.indicativePrice -
                            b.indicativePrice
                    )
                    .map(
                        item => `
                            <div style="
                                margin-top:5px;
                                padding:7px;
                                border-radius:7px;
                                background:rgba(255,255,255,.05);
                                font-size:10px;
                            ">
                                <strong>
                                    📍
                                    ${
                                        escapeHtml(
                                            item.city
                                        )
                                    }
                                </strong>

                                ·
                                ${
                                    escapeHtml(
                                        item.country
                                    )
                                }

                                ·
                                ${
                                    escapeHtml(
                                        item.airport
                                    )
                                }

                                <br>

                                ${
                                    escapeHtml(
                                        item.scenarioLabel
                                    )
                                }

                                · indicatief
                                ${
                                    euro(
                                        item.indicativePrice
                                    )
                                }

                                <br>

                                ${
                                    item.selected
                                        ? '✅ geselecteerd'
                                        : '❌ niet geselecteerd'
                                }

                                ·

                                ${
                                    item.routeChecked
                                        ? '✅ route gecontroleerd'
                                        : '⏳ geen concrete check'
                                }

                                ${
                                    item.source
                                        ? `
                                            ·
                                            ${
                                                escapeHtml(
                                                    item.source
                                                )
                                            }
                                        `
                                        : ''
                                }

                                ${
                                    Number.isFinite(
                                        item.retryCount
                                    ) &&
                                    item.retryCount > 0
                                        ? `
                                            · 🔄
                                            ${item.retryCount}
                                            retry

                                            ${
                                                item.finalStatus ===
                                                'WAITING_FOR_RETRY'
                                                    ? '· wacht'
                                                    : item.retryRecovered
                                                        ? '· ✅ hersteld'
                                                        : '· ❌ opnieuw time-out'
                                            }
                                        `
                                        : ''
                                }

                                ${
                                    Number.isFinite(
                                        item.rawFlightCount
                                    )
                                        ? `
                                            <br>

                                            directe varianten:
                                            ${
                                                item.rawFlightCount
                                            }

                                            · binnen beschikbaarheidsvenster:
                                            ${
                                                item.allowedWeekendCount
                                            }

                                            · na filters:
                                            ${
                                                item.passedFilterCount
                                            }
                                        `
                                        : ''
                                }

                                ${
                                    Number.isFinite(
                                        item.cheapestRealPrice
                                    )
                                        ? `
                                            <br>

                                            echte laagste prijs:
                                            <strong>
                                                ${
                                                    euro(
                                                        item.cheapestRealPrice
                                                    )
                                                }
                                            </strong>
                                        `
                                        : ''
                                }

                                <br>

                                status:
                                <strong>
                                    ${
                                        escapeHtml(
                                            statusHuman(
                                                item.finalStatus
                                            )
                                        )
                                    }
                                </strong>
                            </div>
                        `
                    )
                    .join('');

            output.innerHTML = `
                ${countryHtml}

                ${
                    countryMatches.length &&
                    cityMatches.length
                        ? `
                            <div style="
                                height:1px;
                                margin:8px 0;
                                background:rgba(255,255,255,.08);
                            "></div>
                        `
                        : ''
                }

                ${cityHtml}
            `;
        }

        input.addEventListener(
            'input',
            render
        );
    }


    /* ============================================================
       RESULTATEN
       ============================================================ */

    function renderResults(
        grouped,
        saturday,
        settings,
        elapsed
    ) {
        const panel =
            getPanel();

        const filters =
            createResultFilters();

        panel.innerHTML = `
            ${headerHtml(
                'Je beste reisopties'
            )}

            <div style="
                font-size:17px;
                font-weight:800;
            ">
                ${
                    formatAvailability(
                        saturday,
                        settings
                    )
                }
            </div>

            <div style="
                margin-top:3px;
                font-size:11px;
                opacity:.6;
            ">
                ${grouped.length}
                bestemmingen

                ·

                ${formatElapsed(elapsed)}

                ${
                    activeScan
                        ?.stats
                        ?.cacheHits
                        ? `
                            · ⚡
                            ${
                                activeScan
                                    .stats
                                    .cacheHits
                            }
                            direct geladen
                        `
                        : ''
                }
            </div>

            ${
                resultToolbarHtml(
                    settings
                )
            }

            ${
                resultFiltersHtml()
            }

            <div
                id="ww-results"
            ></div>

            <button id="ww-more-results" style="display:none;width:100%;margin-top:7px;padding:8px;border:0;border-radius:7px;cursor:pointer;font-weight:700">
                Meer resultaten
            </button>

            <div style="
                display:grid;
                grid-template-columns:1fr 1fr 1fr;
                gap:6px;
                margin-top:11px;
            ">
                <button
                    id="ww-again"
                    style="
                        padding:8px 5px;
                        border:0;
                        border-radius:7px;
                        cursor:pointer;
                        font-weight:700;
                        font-size:11px;
                    "
                >
                    ⚡ Snel opnieuw
                </button>

                <button
                    id="ww-fresh"
                    style="
                        padding:8px 5px;
                        border:0;
                        border-radius:7px;
                        cursor:pointer;
                        font-weight:700;
                        font-size:11px;
                    "
                >
                    ↻ Verse prijzen
                </button>

                <button
                    id="ww-home"
                    style="
                        padding:8px 5px;
                        border:0;
                        border-radius:7px;
                        cursor:pointer;
                        color:white;
                        background:rgba(255,255,255,.08);
                        font-size:11px;
                    "
                >
                    🏠 Start
                </button>
            </div>

            ${diagnosisHtml()}

            ${closeContent()}
        `;

        setupPanelControls(
            panel
        );

        bindDiagnosisSearch(
            panel
        );

        const sort =
            panel.querySelector(
                '#ww-sort'
            );

        sort.value =
            settings.sortMode;

        let visibleCount = CONFIG.initialResultCount;

        function draw() {
            const container =
                panel.querySelector(
                    '#ww-results'
                );

            container.innerHTML =
                '';

            let filtered =
                applyResultFilters(
                    grouped,
                    filters
                );

            /*
             * Belangrijk:
             * eerst filtervariant kiezen,
             * daarna opnieuw score/rangschikking berekenen.
             */
            let sorted =
                addRecommendationTags(sortDestinations(
                    filtered,
                    settings.sortMode
                ));

            const summary =
                panel.querySelector(
                    '#ww-filter-summary'
                );

            if (summary) {
                if (
                    filtersActive(
                        filters
                    )
                ) {
                    summary.style.display =
                        'block';

                    summary.textContent =
                        `${sorted.length} van ${grouped.length} bestemmingen hebben een passende vlucht`;

                } else {
                    summary.style.display =
                        'none';
                }
            }

            const visible =
                sorted.slice(
                    0,
                    visibleCount
                );

            const moreButton = panel.querySelector('#ww-more-results');
            if (moreButton) {
                moreButton.style.display = sorted.length > visibleCount ? 'block' : 'none';
                moreButton.textContent = `Meer resultaten (${sorted.length - visibleCount})`;
            }

            if (
                !visible.length
            ) {
                container.innerHTML = `
                    <div style="
                        padding:12px;
                        border-radius:8px;
                        background:rgba(245,158,11,.14);
                    ">
                        Geen gevonden bestemmingen
                        hebben een vlucht die aan deze filters voldoet.
                    </div>
                `;

                return;
            }

            visible.forEach(
                (
                    result,
                    index
                ) => {
                    container.appendChild(
                        createResultCard(
                            result,
                            index,
                            settings
                                .compactMode
                        )
                    );
                }
            );
        }

        bindResultFilters(
            panel,
            filters,
            draw
        );

        panel.querySelector('#ww-more-results')?.addEventListener('click', () => {
            visibleCount += CONFIG.progressiveResultStep;
            draw();
        });

        sort.addEventListener(
            'change',
            () => {
                settings.sortMode =
                    sort.value;

                saveSettings(
                    settings
                );

                draw();
            }
        );

        panel
            .querySelector(
                '#ww-compact'
            )
            ?.addEventListener(
                'change',
                event => {
                    settings.compactMode =
                        event.target.checked;

                    saveSettings(
                        settings
                    );

                    draw();
                }
            );

        panel
            .querySelector(
                '#ww-again'
            )
            ?.addEventListener(
                'click',
                () => {
                    startSingleScan(
                        saturday,
                        settings
                    );
                }
            );

        panel
            .querySelector(
                '#ww-fresh'
            )
            ?.addEventListener(
                'click',
                () => {
                    startSingleScan(
                        saturday,
                        settings,
                        {
                            forceFreshFlights:
                                true
                        }
                    );
                }
            );

        panel
            .querySelector(
                '#ww-home'
            )
            ?.addEventListener(
                'click',
                renderStart
            );

        draw();
    }


    /* ============================================================
       KALENDER
       ============================================================ */

    function findCalendarWinners(
        calendar
    ) {
        const all =
            calendar.flatMap(
                weekend =>
                    sortDestinations(
                        weekend.results,
                        'price'
                    )
                        .map(
                            result => ({
                                saturday:
                                    weekend.saturday,

                                result
                            })
                        )
            );

        if (!all.length) {
            return null;
        }

        const cheapest =
            [...all]
                .sort(
                    (a, b) =>
                        (a.result.floorTotalPrice ?? a.result.floorPrice) -
                        (b.result.floorTotalPrice ?? b.result.floorPrice)
                )[0];

        const longest =
            [...all]
                .sort(
                    (a, b) =>
                        (b.result.effectiveStayHours ?? b.result.stayHours) -
                        (a.result.effectiveStayHours ?? a.result.stayHours)
                )[0];

        const bestDeal =
            [...all]
                .sort(
                    (a, b) =>
                        b.result.rawDealValue -
                        a.result.rawDealValue
                )[0];

        return {
            cheapest,
            longest,
            bestDeal
        };
    }


    function renderCalendarResults(
        calendar,
        settings,
        title,
        elapsed
    ) {
        const panel =
            getPanel();

        const filters =
            createResultFilters();

        const winners =
            findCalendarWinners(
                calendar
            );

        panel.innerHTML = `
            ${headerHtml(
                'Weekendkalender'
            )}

            <div style="
                font-size:18px;
                font-weight:800;
                text-transform:capitalize;
            ">
                ${escapeHtml(title)}
            </div>

            <div style="
                margin-top:3px;
                font-size:11px;
                opacity:.6;
            ">
                ${calendar.length}
                weekenden vergeleken

                ·

                ${formatElapsed(elapsed)}
            </div>

            ${
                winners
                    ? `
                        <div style="
                            display:grid;
                            grid-template-columns:1fr;
                            gap:6px;
                            margin-top:10px;
                        ">
                            <div style="
                                padding:9px;
                                border-radius:8px;
                                background:rgba(34,197,94,.11);
                                font-size:11px;
                            ">
                                💶
                                <strong>
                                    Goedkoopst:
                                </strong>

                                ${
                                    escapeHtml(
                                        winners
                                            .cheapest
                                            .result
                                            .city
                                    )
                                }

                                ·

                                ${
                                    euro(
                                        winners
                                            .cheapest
                                            .result
                                            .floorPrice
                                    )
                                }
                            </div>

                            <div style="
                                padding:9px;
                                border-radius:8px;
                                background:rgba(56,189,248,.10);
                                font-size:11px;
                            ">
                                ⏱
                                <strong>
                                    Meeste tijd:
                                </strong>

                                ${
                                    escapeHtml(
                                        winners
                                            .longest
                                            .result
                                            .city
                                    )
                                }

                                ·

                                ${
                                    formatHours(
                                        winners
                                            .longest
                                            .result
                                            .stayHours
                                    )
                                }
                            </div>
                        </div>
                    `
                    : ''
            }

            ${
                resultToolbarHtml(
                    settings
                )
            }

            ${
                resultFiltersHtml()
            }

            <div
                id="ww-calendar-results"
            ></div>

            <button
                id="ww-calendar-home"
                style="
                    width:100%;
                    margin-top:10px;
                    padding:9px;
                    border:0;
                    border-radius:7px;
                    cursor:pointer;
                    font-weight:700;
                "
            >
                ← Terug naar start
            </button>

            ${diagnosisHtml()}

            ${closeContent()}
        `;

        setupPanelControls(
            panel
        );

        bindDiagnosisSearch(
            panel
        );

        const sort =
            panel.querySelector(
                '#ww-sort'
            );

        sort.value =
            settings.sortMode;

        function draw() {
            const container =
                panel.querySelector(
                    '#ww-calendar-results'
                );

            container.innerHTML =
                '';

            let totalOriginal =
                0;

            let totalVisible =
                0;

            for (
                const weekend
                of calendar
            ) {
                totalOriginal +=
                    weekend.results.length;

                let filtered =
                    applyResultFilters(
                        weekend.results,
                        filters
                    );

                let sorted =
                    sortDestinations(
                        filtered,
                        settings.sortMode
                    );

                totalVisible +=
                    sorted.length;

                const section =
                    document.createElement(
                        'div'
                    );

                section.style.cssText = `
                    margin-top:9px;
                    padding:11px;
                    border-radius:10px;
                    background:rgba(255,255,255,.055);
                `;

                const friday =
                    addDays(
                        weekend.saturday,
                        -1
                    );

                section.innerHTML = `
                    <div style="
                        display:flex;
                        justify-content:space-between;
                        gap:8px;
                    ">
                        <div>
                            <strong>
                                ${
                                    formatWeekend(
                                        weekend.saturday
                                    )
                                }
                            </strong>

                            ${
                                isLastFridayOfMonth(
                                    friday
                                )
                                    ? `
                                        <div style="
                                            margin-top:2px;
                                            font-size:10px;
                                            opacity:.7;
                                        ">
                                            🌅 Vrije vrijdag
                                        </div>
                                    `
                                    : ''
                            }
                        </div>

                        ${
                            sorted[0]
                                ? `
                                    <strong>
                                        vanaf
                                        ${
                                            euro(
                                                sorted[0]
                                                    .floorPrice
                                            )
                                        }
                                    </strong>
                                `
                                : ''
                        }
                    </div>

                    <div
                        class="ww-calendar-cards"
                        style="
                            margin-top:8px;
                        "
                    ></div>
                `;

                const holder =
                    section.querySelector(
                        '.ww-calendar-cards'
                    );

                if (
                    !sorted.length
                ) {
                    holder.innerHTML = `
                        <div style="
                            font-size:11px;
                            opacity:.55;
                        ">
                            Geen passende bestemming
                            binnen de huidige filters.
                        </div>
                    `;

                } else {
                    sorted
                        .slice(
                            0,
                            3
                        )
                        .forEach(
                            (
                                result,
                                index
                            ) => {
                                holder.appendChild(
                                    createResultCard(
                                        result,
                                        index,
                                        true
                                    )
                                );
                            }
                        );
                }

                container.appendChild(
                    section
                );
            }

            const summary =
                panel.querySelector(
                    '#ww-filter-summary'
                );

            if (summary) {
                if (
                    filtersActive(
                        filters
                    )
                ) {
                    summary.style.display =
                        'block';

                    summary.textContent =
                        `${totalVisible} van ${totalOriginal} bestemmingen hebben een passende vlucht`;

                } else {
                    summary.style.display =
                        'none';
                }
            }
        }

        bindResultFilters(
            panel,
            filters,
            draw
        );

        sort.addEventListener(
            'change',
            () => {
                settings.sortMode =
                    sort.value;

                saveSettings(
                    settings
                );

                draw();
            }
        );

        panel
            .querySelector(
                '#ww-compact'
            )
            ?.addEventListener(
                'change',
                event => {
                    settings.compactMode =
                        event.target.checked;

                    saveSettings(
                        settings
                    );

                    draw();
                }
            );

        panel
            .querySelector(
                '#ww-calendar-home'
            )
            ?.addEventListener(
                'click',
                renderStart
            );

        draw();
    }


    /* ============================================================
       ERROR
       ============================================================ */

    function renderError(error) {
        const panel =
            getPanel();

        panel.innerHTML = `
            ${headerHtml(
                'De zoekopdracht stopte'
            )}

            <div style="
                padding:12px;
                border-radius:8px;
                background:rgba(239,68,68,.14);
            ">
                <strong>
                    Er ging iets mis.
                </strong>

                <div style="
                    margin-top:6px;
                    font-size:11px;
                    opacity:.75;
                ">
                    ${
                        escapeHtml(
                            error?.message ||
                            String(error)
                        )
                    }
                </div>
            </div>

            ${diagnosisHtml()}

            <button
                id="ww-error-home"
                style="
                    width:100%;
                    margin-top:9px;
                    padding:9px;
                    border:0;
                    border-radius:7px;
                    cursor:pointer;
                "
            >
                Terug naar start
            </button>

            ${closeContent()}
        `;

        setupPanelControls(
            panel
        );

        bindDiagnosisSearch(
            panel
        );

        panel
            .querySelector(
                '#ww-error-home'
            )
            ?.addEventListener(
                'click',
                renderStart
            );
    }


    /* ============================================================
       START
       ============================================================ */

    async function main() {
        if (
            shouldHideInterface()
        ) {
            return;
        }

        if (
            document.readyState ===
            'loading'
        ) {
            await new Promise(
                resolve =>
                    document
                        .addEventListener(
                            'DOMContentLoaded',
                            resolve,
                            {
                                once: true
                            }
                        )
            );
        }

        renderStart();
    }

    if (globalThis.__WW_TEST_MODE__) {
        globalThis.__WW_TEST_EXPORTS__ = {
            timeToMinutes,
            calculateStayHours,
            isEuropeanCountry,
            selectBalancedCandidates,
            trimCache,
            effectiveWorkerLimit,
            airportAccessFor,
            effectiveStayHours,
            priceModel,
            createScenarios,
            expectedHomeArrivalMinutes,
            passesSearchFilters,
            readCities,
            compactJsonFlights,
            parseDescriptor,
            classifyPageState,
            cacheUrl
        };
        return;
    }

    main();

})();
