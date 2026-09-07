// Validates an IANA timezone string using the Intl API.
// Throws for unknown zones, so we catch and return false.
function isValidTimezone(tz) {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

module.exports = { isValidTimezone };