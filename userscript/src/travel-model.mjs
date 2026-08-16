export function airportAccessFor(settings, airport) {
  const access = settings?.airportAccess?.[airport] || {};
  return {
    minutes: Math.max(0, Number(access.minutes) || 0),
    cost: Math.max(0, Number(access.cost) || 0)
  };
}

export function effectiveStayHours(stayHours, settings) {
  const transferMinutes = Math.max(0, Number(settings?.destinationTransferMinutes) || 0);
  const bufferMinutes = Math.max(0, Number(settings?.returnAirportBufferMinutes) || 0);
  return Math.max(0, Math.round((stayHours - ((transferMinutes * 2 + bufferMinutes) / 60)) * 10) / 10);
}

export function priceModel(flightPrice, airport, settings) {
  const travelers = Math.max(1, Math.round(Number(settings?.travelers) || 1));
  const access = airportAccessFor(settings, airport);
  const baggageCost = Math.max(0, Number(settings?.baggageCostPerTraveler) || 0);
  const bookingFees = Math.max(0, Number(settings?.bookingFees) || 0);
  const baggageKnown = settings?.baggage === 'personal' || baggageCost > 0;
  return {
    travelers,
    access,
    baggageKnown,
    total: Math.round((flightPrice * travelers + access.cost + baggageCost * travelers + bookingFees) * 100) / 100,
    incomplete: !baggageKnown
  };
}
