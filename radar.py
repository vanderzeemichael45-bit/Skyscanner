from __future__ import annotations

import argparse
import json
import re
import sys
import time
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

from playwright.sync_api import Page, TimeoutError as PlaywrightTimeoutError, sync_playwright


AIRPORTS = ["AMS", "EIN", "RTM", "GRQ"]
CANDIDATE_PRICE = 250
MAX_COUNTRY_CANDIDATES = 5
MAX_CITY_CANDIDATES = 6
MAX_DEAL_PRICE = 150
FRIDAY_EARLIEST_DEPARTURE = "21:00"

NAVIGATION_PAUSE_MS = 850
FAST_POLL_MS = 400
FAST_STABLE_CHECKS = 3
FAST_MAX_SETTLE_MS = 4000
VERIFY_STABLE_CHECKS = 5
VERIFY_MAX_SETTLE_MS = 7000
PAGE_TIMEOUT_MS = 60_000

BASE = "https://www.skyscanner.nl"
RESULTS_DIR = Path("results")


@dataclass
class Scenario:
    id: str
    label: str
    outbound: date
    inbound: date
    friday_departure: bool
    friday_free: bool


@dataclass
class CountryResult:
    airport: str
    destination: str
    price: float
    direct: bool
    link: str


@dataclass
class CityResult:
    airport: str
    city: str
    price: float
    direct: bool
    link: str
    country: str = "?"


def normalize(value: str | None) -> str:
    return re.sub(r"\s+", " ", value or "").strip().lower()


def parse_price(value: str | None) -> float | None:
    if not value:
        return None
    match = re.search(r"€\s*([\d.,]+)", value)
    if not match:
        return None
    number = match.group(1).replace(".", "").replace(",", ".")
    try:
        return float(number)
    except ValueError:
        return None


def time_to_minutes(value: str | None) -> int | None:
    if not value or not re.fullmatch(r"\d{1,2}:\d{2}", value):
        return None
    hour, minute = map(int, value.split(":"))
    return hour * 60 + minute


def next_saturday(today: date | None = None) -> date:
    today = today or date.today()
    # Monday=0 ... Saturday=5 ... Sunday=6
    delta = (5 - today.weekday()) % 7
    if delta == 0:
        delta = 7
    return today + timedelta(days=delta)


def saturday_for_selected_weekend(selected: date) -> date:
    # Friday=4, Saturday=5, Sunday=6, Monday=0
    wd = selected.weekday()
    if wd == 4:
        return selected + timedelta(days=1)
    if wd == 5:
        return selected
    if wd == 6:
        return selected - timedelta(days=1)
    if wd == 0:
        return selected - timedelta(days=2)
    return next_saturday(selected)


def is_last_friday_of_month(day: date) -> bool:
    return day.weekday() == 4 and (day + timedelta(days=7)).month != day.month


def scenarios_for(saturday: date) -> list[Scenario]:
    friday = saturday - timedelta(days=1)
    sunday = saturday + timedelta(days=1)
    monday = saturday + timedelta(days=2)
    friday_free = is_last_friday_of_month(friday)
    return [
        Scenario("fri-mon", "Vrijdag → maandag", friday, monday, True, friday_free),
        Scenario("fri-sun", "Vrijdag → zondag", friday, sunday, True, friday_free),
        Scenario("sat-mon", "Zaterdag → maandag", saturday, monday, False, friday_free),
    ]


def sky_date(day: date) -> str:
    return day.strftime("%y%m%d")


def build_explore_url(airport: str, outbound: date, inbound: date) -> str:
    params = urlencode(
        {
            "adultsv2": "1",
            "cabinclass": "economy",
            "childrenv2": "",
            "ref": "home",
            "rtn": "1",
            "outboundaltsenabled": "false",
            "inboundaltsenabled": "false",
            "stops": "direct",
        }
    )
    return (
        f"{BASE}/transport/vluchten-van/{airport.lower()}/"
        f"{sky_date(outbound)}/{sky_date(inbound)}/?{params}"
    )


def goto(page: Page, url: str) -> None:
    print(f"→ {url}")
    page.goto(url, wait_until="domcontentloaded", timeout=PAGE_TIMEOUT_MS)
    page.wait_for_timeout(NAVIGATION_PAUSE_MS)


def page_has_no_results(page: Page) -> bool:
    try:
        text = normalize(page.locator("body").inner_text(timeout=3000))
    except PlaywrightTimeoutError:
        return False
    return any(
        phrase in text
        for phrase in (
            "geen vluchten die overeenkomen met je filters",
            "sorry, er zijn geen vluchten",
            "geen resultaten",
        )
    )


def wait_for_country_cards(page: Page, airport: str) -> list[CountryResult] | None:
    deadline = time.monotonic() + 25
    while time.monotonic() < deadline:
        raw = page.locator('[data-testid="place-card"]').evaluate_all(
            """
            (cards) => cards.map(card => ({
                destination: card.querySelector('h2')?.innerText?.trim() || '',
                text: card.innerText || '',
                link: card.href || card.querySelector('a[href]')?.href || ''
            }))
            """
        )
        results: list[CountryResult] = []
        for item in raw:
            price = parse_price(item.get("text"))
            if item.get("destination") and price is not None and item.get("link"):
                results.append(
                    CountryResult(
                        airport=airport,
                        destination=item["destination"],
                        price=price,
                        direct=bool(re.search(r"\bdirect\b", item.get("text", ""), re.I)),
                        link=item["link"],
                    )
                )
        if results:
            return results
        if page_has_no_results(page):
            return []
        page.wait_for_timeout(500)
    return None


def read_cities(page: Page, airport: str) -> list[CityResult]:
    raw = page.locator('a[data-testid="flights-link"]').evaluate_all(
        """
        (links) => links.map(link => {
            const container = link.closest('[data-testid="description-container"]');
            return {
                city: container?.querySelector('h2')?.innerText?.trim() || '',
                aria: link.getAttribute('aria-label') || '',
                text: link.innerText || '',
                link: link.href || ''
            };
        })
        """
    )
    results: list[CityResult] = []
    for item in raw:
        price = parse_price(item.get("aria") or item.get("text"))
        city = item.get("city") or ""
        link = item.get("link") or ""
        if city and price is not None and link:
            text = f"{item.get('aria', '')} {item.get('text', '')}"
            results.append(
                CityResult(
                    airport=airport,
                    city=city,
                    price=price,
                    direct=bool(re.search(r"rechtstreeks|direct", text, re.I)),
                    link=link,
                )
            )
    return results


def wait_for_cities(page: Page, airport: str) -> list[CityResult] | None:
    deadline = time.monotonic() + 25
    while time.monotonic() < deadline:
        results = read_cities(page, airport)
        if results:
            return results
        if page_has_no_results(page):
            return []
        page.wait_for_timeout(500)
    return None


def read_flights(page: Page) -> list[dict[str, Any]]:
    raw = page.locator('[class*="FlightsTicketA11yDescriptor"]').evaluate_all(
        """
        (nodes) => nodes.map(node => ({
            text: (node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim(),
            link: node.closest('a[href]')?.href ||
                  node.closest('[data-testid="ticket"]')?.closest('a[href]')?.href ||
                  location.href
        }))
        """
    )

    results: list[dict[str, Any]] = []
    route_re = re.compile(
        r"Vertrekt uit (.+?) om (\d{1,2}:\d{2}), komt aan in (.+?) om (\d{1,2}:\d{2})\.",
        re.I,
    )

    for item in raw:
        text = item.get("text", "")
        price_match = re.search(r"Totale kosten\s*€\s*([\d.,]+)", text, re.I)
        if not price_match:
            continue
        price = parse_price(f"€ {price_match.group(1)}")
        routes = route_re.findall(text)
        if price is None or len(routes) < 2:
            continue

        outbound_airline = re.search(r"Heenvlucht met (.+?)\.", text, re.I)
        inbound_airline = re.search(r"Retourvlucht met (.+?)\.", text, re.I)
        direct_count = len(re.findall(r"Rechtstreekse vlucht", text, re.I))

        out = routes[0]
        back = routes[1]
        results.append(
            {
                "price": price,
                "outboundAirline": outbound_airline.group(1).strip() if outbound_airline else "?",
                "inboundAirline": inbound_airline.group(1).strip() if inbound_airline else "?",
                "outboundFrom": out[0].strip(),
                "outboundDeparture": out[1],
                "outboundTo": out[2].strip(),
                "outboundArrival": out[3],
                "inboundFrom": back[0].strip(),
                "inboundDeparture": back[1],
                "inboundTo": back[2].strip(),
                "inboundArrival": back[3],
                "direct": direct_count >= 2,
                "link": item.get("link") or page.url,
            }
        )
    return results


def flight_signature(flights: list[dict[str, Any]]) -> str:
    slim = [
        (
            f.get("price"),
            f.get("outboundDeparture"),
            f.get("outboundArrival"),
            f.get("inboundDeparture"),
            f.get("inboundArrival"),
            f.get("outboundFrom"),
            f.get("outboundTo"),
        )
        for f in flights
    ]
    return json.dumps(sorted(slim, key=str), ensure_ascii=False)


def settle_flights(
    page: Page,
    initial: list[dict[str, Any]],
    *,
    stable_checks: int,
    max_settle_ms: int,
) -> list[dict[str, Any]]:
    latest = initial
    last_signature = flight_signature(initial)
    stable = 0
    deadline = time.monotonic() + max_settle_ms / 1000

    while time.monotonic() < deadline:
        page.wait_for_timeout(FAST_POLL_MS)
        current = read_flights(page)
        if not current:
            continue
        latest = current
        signature = flight_signature(current)
        if signature == last_signature:
            stable += 1
            if stable >= stable_checks:
                return latest
        else:
            last_signature = signature
            stable = 0
    return latest


def wait_for_flights(page: Page, verify: bool = False) -> list[dict[str, Any]] | None:
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        flights = read_flights(page)
        if flights:
            return settle_flights(
                page,
                flights,
                stable_checks=VERIFY_STABLE_CHECKS if verify else FAST_STABLE_CHECKS,
                max_settle_ms=VERIFY_MAX_SETTLE_MS if verify else FAST_MAX_SETTLE_MS,
            )
        if page_has_no_results(page):
            return []
        page.wait_for_timeout(500)
    return None


def price_score(price: float) -> int:
    if price < 50: return 40
    if price < 65: return 39
    if price < 75: return 37
    if price <= 90: return 35
    if price <= 100: return 33
    if price <= 115: return 30
    if price <= 130: return 27
    if price <= 150: return 23
    if price <= 175: return 17
    if price <= 200: return 11
    if price <= 225: return 7
    return 4


def stay_score(hours: float) -> int:
    if hours >= 68: return 30
    if hours >= 62: return 29
    if hours >= 56: return 27
    if hours >= 50: return 25
    if hours >= 44: return 22
    if hours >= 38: return 19
    if hours >= 32: return 16
    if hours >= 26: return 13
    if hours >= 20: return 9
    return 5


def outbound_score(flight: dict[str, Any], scenario: Scenario) -> int:
    minutes = time_to_minutes(flight.get("outboundDeparture"))
    if minutes is None:
        return 0
    if scenario.friday_departure and scenario.friday_free:
        if minutes < 10 * 60: return 10
        if minutes < 14 * 60: return 9
        if minutes < 18 * 60: return 8
        if minutes < 21 * 60: return 7
        return 6
    if scenario.friday_departure:
        if minutes < 21 * 60: return 0
        if minutes < 22 * 60: return 10
        if minutes < 23 * 60: return 9
        return 8
    if minutes < 9 * 60: return 10
    if minutes < 11 * 60: return 9
    if minutes < 14 * 60: return 8
    if minutes < 17 * 60: return 6
    if minutes < 20 * 60: return 4
    return 3


def return_score(flight: dict[str, Any]) -> int:
    minutes = time_to_minutes(flight.get("inboundDeparture"))
    if minutes is None: return 0
    if minutes >= 20 * 60: return 10
    if minutes >= 18 * 60: return 9
    if minutes >= 16 * 60: return 8
    if minutes >= 14 * 60: return 7
    if minutes >= 12 * 60: return 6
    if minutes >= 10 * 60: return 5
    if minutes >= 8 * 60: return 3
    return 1


def stay_hours(flight: dict[str, Any], scenario: Scenario) -> float:
    arrival_minutes = time_to_minutes(flight.get("outboundArrival"))
    return_minutes = time_to_minutes(flight.get("inboundDeparture"))
    if arrival_minutes is None or return_minutes is None:
        return 0.0
    arrival = datetime.combine(scenario.outbound, datetime.min.time()) + timedelta(minutes=arrival_minutes)
    departure = datetime.combine(scenario.inbound, datetime.min.time()) + timedelta(minutes=return_minutes)
    return max(0.0, round((departure - arrival).total_seconds() / 3600, 1))


def is_allowed(flight: dict[str, Any], scenario: Scenario) -> bool:
    if scenario.friday_departure and not scenario.friday_free:
        departure = time_to_minutes(flight.get("outboundDeparture"))
        minimum = time_to_minutes(FRIDAY_EARLIEST_DEPARTURE)
        return departure is not None and minimum is not None and departure >= minimum
    return True


def enrich_flight(
    flight: dict[str, Any],
    *,
    city: CityResult,
    scenario: Scenario,
    verified: bool = False,
    before_price: float | None = None,
) -> dict[str, Any]:
    hours = stay_hours(flight, scenario)
    parts = {
        "price": price_score(float(flight["price"])),
        "stay": stay_score(hours),
        "outbound": outbound_score(flight, scenario),
        "return": return_score(flight),
        "direct": 10 if flight.get("direct") else 3,
    }
    result = dict(flight)
    result.update(
        {
            "airport": city.airport,
            "city": city.city,
            "country": city.country,
            "scenarioId": scenario.id,
            "scenarioLabel": scenario.label,
            "searchLink": city.link,
            "fridayFree": scenario.friday_free,
            "stayHours": hours,
            "scoreParts": parts,
            "score": min(100, sum(parts.values())),
            "verified": verified,
        }
    )
    if before_price is not None:
        result["priceBeforeVerification"] = before_price
    return result


def variant_key(flight: dict[str, Any]) -> tuple:
    return (
        -int(flight.get("score", 0)),
        float(flight.get("price", 999999)),
        -float(flight.get("stayHours", 0)),
        -int(time_to_minutes(flight.get("inboundDeparture")) or 0),
    )


def best_per_destination(flights: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for flight in flights:
        key = normalize(flight.get("city") or flight.get("outboundTo"))
        grouped.setdefault(key, []).append(flight)

    results: list[dict[str, Any]] = []
    for variants in grouped.values():
        variants = sorted(variants, key=variant_key)
        best = dict(variants[0])
        best["alternativeCount"] = max(0, len(variants) - 1)
        best["alternatives"] = variants[1:]
        results.append(best)
    return sorted(results, key=variant_key)


def scan_scenario(page: Page, scenario: Scenario) -> list[dict[str, Any]]:
    print(f"\n=== {scenario.label}: {scenario.outbound} → {scenario.inbound} ===")
    airport_results: list[CountryResult] = []

    for airport in AIRPORTS:
        goto(page, build_explore_url(airport, scenario.outbound, scenario.inbound))
        results = wait_for_country_cards(page, airport)
        if results is None:
            print(f"! {airport}: landenpagina niet stabiel geladen")
            continue
        print(f"  {airport}: {len(results)} landen")
        airport_results.extend(results)

    country_queue = sorted(
        [r for r in airport_results if r.price <= CANDIDATE_PRICE],
        key=lambda r: r.price,
    )[:MAX_COUNTRY_CANDIDATES]

    city_results: list[CityResult] = []
    for idx, country in enumerate(country_queue, start=1):
        print(f"  Land {idx}/{len(country_queue)}: {country.airport} → {country.destination} (€{country.price:g})")
        goto(page, country.link)
        cities = wait_for_cities(page, country.airport)
        if cities is None:
            print("    ! steden niet geladen")
            continue
        for city in cities:
            city.country = country.destination
        city_results.extend(cities)

    unique_links: set[str] = set()
    city_queue: list[CityResult] = []
    for city in sorted(
        [c for c in city_results if c.price <= CANDIDATE_PRICE],
        key=lambda c: c.price,
    ):
        if city.link in unique_links:
            continue
        unique_links.add(city.link)
        city_queue.append(city)
        if len(city_queue) >= MAX_CITY_CANDIDATES:
            break

    scenario_flights: list[dict[str, Any]] = []
    for idx, city in enumerate(city_queue, start=1):
        print(f"  Stad {idx}/{len(city_queue)}: {city.airport} → {city.city} (vanaf €{city.price:g})")
        goto(page, city.link)
        flights = wait_for_flights(page, verify=False)
        if flights is None:
            print("    ! concrete vluchten niet geladen")
            continue
        allowed = [f for f in flights if is_allowed(f, scenario)]
        enriched = [enrich_flight(f, city=city, scenario=scenario) for f in allowed]
        if enriched:
            best = sorted(enriched, key=variant_key)[0]
            scenario_flights.append(best)
            print(
                f"    ✓ €{best['price']:g} | score {best['score']}/100 | "
                f"{best['stayHours']} uur"
            )
        else:
            print("    - geen haalbare vlucht na vrijdagfilter")

    return scenario_flights


def verify_top(page: Page, all_flights: list[dict[str, Any]], scenarios: list[Scenario]) -> None:
    unique = best_per_destination(all_flights)[:3]
    scenario_map = {s.id: s for s in scenarios}

    for idx, target in enumerate(unique, start=1):
        search_link = target.get("searchLink")
        scenario = scenario_map.get(target.get("scenarioId"))
        if not search_link or not scenario:
            continue
        print(f"\nVerificatie {idx}/{len(unique)}: {target.get('city')} (€{target.get('price'):g})")
        goto(page, search_link)
        flights = wait_for_flights(page, verify=True)
        if not flights:
            continue

        city = CityResult(
            airport=target.get("airport", "?"),
            city=target.get("city", "?"),
            price=float(target.get("price", 0)),
            direct=bool(target.get("direct")),
            link=search_link,
            country=target.get("country", "?"),
        )
        allowed = [f for f in flights if is_allowed(f, scenario)]
        enriched = [
            enrich_flight(
                f,
                city=city,
                scenario=scenario,
                verified=True,
                before_price=float(target.get("price", 0)),
            )
            for f in allowed
        ]
        if not enriched:
            continue
        verified = sorted(enriched, key=variant_key)[0]

        candidates = [
            i
            for i, old in enumerate(all_flights)
            if normalize(old.get("city")) == normalize(target.get("city"))
            and old.get("airport") == target.get("airport")
            and old.get("scenarioId") == target.get("scenarioId")
        ]
        if candidates:
            all_flights[candidates[0]] = verified
        else:
            all_flights.append(verified)

        if verified["price"] != target["price"]:
            print(f"    prijs aangepast: €{target['price']:g} → €{verified['price']:g}")
        else:
            print("    prijs stabiel")


def write_results(saturday: date, scenarios: list[Scenario], all_flights: list[dict[str, Any]]) -> Path:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    unique = best_per_destination(all_flights)
    payload = {
        "generatedAt": datetime.now().astimezone().isoformat(),
        "weekendSaturday": saturday.isoformat(),
        "scenarios": [
            {
                "id": s.id,
                "label": s.label,
                "outbound": s.outbound.isoformat(),
                "inbound": s.inbound.isoformat(),
                "fridayFree": s.friday_free,
            }
            for s in scenarios
        ],
        "summary": {
            "flightVariants": len(all_flights),
            "uniqueDestinations": len(unique),
            "dealsUnder150": sum(1 for f in unique if float(f.get("price", 999999)) <= MAX_DEAL_PRICE),
        },
        "bestDestinations": unique,
    }
    path = RESULTS_DIR / "latest.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def print_summary(all_flights: list[dict[str, Any]]) -> None:
    unique = best_per_destination(all_flights)
    print("\n================ RESULTAAT ================")
    for index, flight in enumerate(unique[:10], start=1):
        verified = " ✓" if flight.get("verified") else ""
        print(
            f"{index:>2}. {flight.get('city','?'):<20} "
            f"€{float(flight.get('price',0)):>6g} | "
            f"score {flight.get('score',0):>3}/100 | "
            f"{flight.get('stayHours',0):>5} uur | "
            f"{flight.get('scenarioLabel','?')} | {flight.get('airport','?')}{verified}"
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Last-Minute Weekend Radar")
    parser.add_argument(
        "--date",
        help="Een datum in het gewenste weekend, bijvoorbeeld 2026-08-22. Leeg = komend weekend.",
    )
    parser.add_argument(
        "--headed",
        action="store_true",
        help="Open een zichtbaar browservenster (handig lokaal voor debuggen).",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.date:
        try:
            selected = date.fromisoformat(args.date)
        except ValueError:
            print("Ongeldige --date. Gebruik YYYY-MM-DD.", file=sys.stderr)
            return 2
        saturday = saturday_for_selected_weekend(selected)
    else:
        saturday = next_saturday()

    scenarios = scenarios_for(saturday)
    print(f"Weekend: {saturday - timedelta(days=1)} t/m {saturday + timedelta(days=2)}")
    print(f"Vrijdag vrij-regel: {'JA' if scenarios[0].friday_free else 'NEE; vertrek ≥ 21:00'}")

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=not args.headed)
            context = browser.new_context(
                locale="nl-NL",
                timezone_id="Europe/Amsterdam",
                viewport={"width": 1440, "height": 1100},
            )
            page = context.new_page()
            page.set_default_timeout(15_000)

            all_flights: list[dict[str, Any]] = []
            for scenario in scenarios:
                all_flights.extend(scan_scenario(page, scenario))

            verify_top(page, all_flights, scenarios)
            path = write_results(saturday, scenarios, all_flights)
            print_summary(all_flights)
            print(f"\nJSON opgeslagen: {path}")

            context.close()
            browser.close()
        return 0

    except Exception as exc:
        print(f"\nFOUT: {type(exc).__name__}: {exc}", file=sys.stderr)
        try:
            # The workflow also uploads the results folder, so leave a small diagnostic file.
            (RESULTS_DIR / "error.txt").write_text(
                f"{datetime.now().astimezone().isoformat()}\n{type(exc).__name__}: {exc}\n",
                encoding="utf-8",
            )
        except Exception:
            pass
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
