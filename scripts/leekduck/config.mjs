export const LEEKDUCK_EVENTS_URL = "https://leekduck.com/events/";
export const HORIZON_DAYS = 21;
export const USER_AGENT = "PokemonToolsetEventImporter/0.2 (personal local tool)";
export const REQUEST_TIMEOUT_MS = 20_000;

// Pokémon GO event times are displayed by LeekDuck as "Local Time". This
// personal tool is built for Malaysia, so parsing must be deterministic and
// must not change when Node runs under UTC versus macOS Asia/Kuala_Lumpur.
export const EVENT_TIMEZONE_OFFSET = "+08:00";
